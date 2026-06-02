// YouTube ingest — an EXTERNAL video asset (no Bunny upload) plus caption import.
//
// Design: a YouTube video is modeled as an ordinary `kind: "video"` asset with
// `provider: "youtube"` (provider is free-text — no asset_kind enum change, so NO
// migration), `provider_asset_id` = the 11-char video id, `playback_url` = the canonical
// watch URL, `status: "ready"` (nothing to process). Captions are imported into the SAME
// `transcript_json` shape (TranscriptWord[]) the Bunny/Groq path produces, so transcript
// display / segmentation / watch-gating stay source-agnostic downstream. This keeps every
// `kind = 'video'` reader (picker, player, lesson video item) working unchanged.
//
// Outbound calls to youtube.com reuse the hardened SSRF-safe fetchFeed from the iCal feed
// proxy (HTTPS-only, host allowlist, per-redirect-hop private-IP block, size/time caps) —
// captions are best-effort (a fetch/parse failure leaves the asset created with
// transcription_status='failed', retryable), matching the Narthex YouTube add.

import { fetchFeed } from "../calendar/ical";
import { createAsset, setTranscript, setTranscriptionStatus, type TranscriptWord } from "./assets";

/** youtube.com covers www.youtube.com and m.youtube.com (suffix match in the allowlist). */
const YOUTUBE_ALLOWED_HOSTS = "youtube.com";
const WATCH_PAGE_MAX_BYTES = 6 * 1024 * 1024; // watch HTML can be a few MB; cap defensively
const TIMEDTEXT_MAX_BYTES = 2 * 1024 * 1024;

/** Injectable IO so the fetch+parse path is unit-testable without hitting YouTube. */
export interface YouTubeFetchDeps {
  fetchImpl?: typeof fetch;
  lookup?: (hostname: string) => Promise<string[]>;
}

const YT_ID = /^[A-Za-z0-9_-]{11}$/;

/**
 * Extract the 11-char video id from a watch / youtu.be / embed / shorts URL or a bare id.
 * Returns null for anything that doesn't yield a valid id (the caller decides how to fail).
 */
export function extractYouTubeId(input: string): string | null {
  const s = input.trim();
  if (YT_ID.test(s)) return s;
  let url: URL;
  try {
    url = new URL(s);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^www\.|^m\./, "");
  let candidate: string | null = null;
  if (host === "youtu.be") {
    candidate = url.pathname.slice(1).split("/")[0] ?? null;
  } else if (host === "youtube.com") {
    if (url.pathname === "/watch") candidate = url.searchParams.get("v");
    else {
      const m = url.pathname.match(/^\/(?:embed|shorts|v)\/([^/]+)/);
      candidate = m ? m[1]! : null;
    }
  }
  return candidate && YT_ID.test(candidate) ? candidate : null;
}

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
};

function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&(?:amp|lt|gt|quot|#39|apos);/g, (m) => ENTITIES[m] ?? m);
}

const round3 = (n: number): number => Math.round(n * 1000) / 1000;

/**
 * Parse a YouTube timedtext caption track into TranscriptWord[]. Handles the classic
 * format (`<text start="s" dur="s">`) and srv3 (`<p t="ms" d="ms">`). Each caption SEGMENT
 * becomes one entry (the `word` field holds the whole phrase — the documented YouTube shape;
 * the Bunny/Groq path is true per-word). Empty/whitespace cues are dropped; times in seconds.
 */
export function parseTimedTextXml(xml: string): TranscriptWord[] {
  const words: TranscriptWord[] = [];

  const classic = /<text\s+start="([\d.]+)"\s+dur="([\d.]+)"[^>]*>([\s\S]*?)<\/text>/g;
  for (let m: RegExpExecArray | null; (m = classic.exec(xml)); ) {
    const start = Number(m[1]);
    const dur = Number(m[2]);
    const text = decodeEntities(m[3]!.replace(/<[^>]+>/g, ""))
      .replace(/\s+/g, " ")
      .trim();
    if (text && Number.isFinite(start))
      words.push({ word: text, start: round3(start), end: round3(start + (dur || 0)) });
  }
  if (words.length > 0) return words;

  const srv3 = /<p\s+t="(\d+)"\s+d="(\d+)"[^>]*>([\s\S]*?)<\/p>/g;
  for (let m: RegExpExecArray | null; (m = srv3.exec(xml)); ) {
    const startMs = Number(m[1]);
    const durMs = Number(m[2]);
    const text = decodeEntities(m[3]!.replace(/<[^>]+>/g, ""))
      .replace(/\s+/g, " ")
      .trim();
    if (text && Number.isFinite(startMs))
      words.push({ word: text, start: round3(startMs / 1000), end: round3((startMs + (durMs || 0)) / 1000) });
  }
  return words;
}

/**
 * Fetch + parse a YouTube video's captions, SSRF-safe. Scrapes the watch page for the
 * timedtext track URL, then fetches + parses it. Returns null when no caption track exists
 * or it parses empty. Network/SSRF errors from fetchFeed propagate (the caller treats them
 * as a failed import). NOTE: this is the best-effort watch-page-scrape path; an InnerTube
 * fallback for caption-restricted videos is a documented hardening follow-up.
 */
export async function fetchYouTubeCaptions(
  videoId: string,
  deps: YouTubeFetchDeps = {},
): Promise<{ text: string; words: TranscriptWord[] } | null> {
  const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const html = await fetchFeed(watchUrl, {
    allowedHosts: YOUTUBE_ALLOWED_HOSTS,
    maxBytes: WATCH_PAGE_MAX_BYTES,
    fetchImpl: deps.fetchImpl,
    lookup: deps.lookup,
  });

  // The player response embeds caption tracks as JSON-escaped baseUrls.
  const m = html.match(/"baseUrl":"(https:\/\/www\.youtube\.com\/api\/timedtext[^"]+)"/);
  if (!m) return null;
  const trackUrl = m[1]!.replace(/\\u0026/g, "&").replace(/\\\//g, "/");

  const xml = await fetchFeed(trackUrl, {
    allowedHosts: YOUTUBE_ALLOWED_HOSTS,
    maxBytes: TIMEDTEXT_MAX_BYTES,
    fetchImpl: deps.fetchImpl,
    lookup: deps.lookup,
  });
  const words = parseTimedTextXml(xml);
  if (words.length === 0) return null;
  return { text: words.map((w) => w.word).join("\n"), words };
}

export interface IngestYouTubeOptions {
  parishId: string;
  createdBy: string;
  /** A YouTube URL (watch/youtu.be/embed/shorts) or a bare 11-char id. */
  input: string;
  title?: string;
}

/** Injectable caption fetcher so ingest is integration-testable without YouTube. */
export interface IngestYouTubeDeps extends YouTubeFetchDeps {
  fetchCaptions?: (
    videoId: string,
    deps: YouTubeFetchDeps,
  ) => Promise<{ text: string; words: TranscriptWord[] } | null>;
}

/**
 * Ingest a YouTube video as an external `provider: "youtube"` video asset and import its
 * captions into the transcript. The asset is always created (status 'ready'); captions are
 * best-effort — when absent or the fetch fails, transcription_status is set to 'failed'
 * (retryable) rather than failing the ingest. Throws only when the input has no valid id.
 * Returns the new asset id.
 */
export async function ingestYouTubeAsset(opts: IngestYouTubeOptions, deps: IngestYouTubeDeps = {}): Promise<string> {
  const videoId = extractYouTubeId(opts.input);
  if (!videoId) throw new Error("Invalid YouTube URL or video id");

  const assetId = await createAsset({
    parishId: opts.parishId,
    createdBy: opts.createdBy,
    kind: "video",
    title: opts.title?.trim() || `YouTube video ${videoId}`,
    provider: "youtube",
    providerAssetId: videoId,
    playbackUrl: `https://www.youtube.com/watch?v=${videoId}`,
    status: "ready",
  });

  const fetchCaptions = deps.fetchCaptions ?? fetchYouTubeCaptions;
  try {
    const captions = await fetchCaptions(videoId, { fetchImpl: deps.fetchImpl, lookup: deps.lookup });
    if (captions) {
      await setTranscript({ parishId: opts.parishId, id: assetId, text: captions.text, words: captions.words });
    } else {
      await setTranscriptionStatus({
        parishId: opts.parishId,
        id: assetId,
        status: "failed",
        error: "No captions available for this video",
      });
    }
  } catch (err) {
    await setTranscriptionStatus({
      parishId: opts.parishId,
      id: assetId,
      status: "failed",
      error: err instanceof Error ? err.message : "Caption import failed",
    });
  }

  return assetId;
}
