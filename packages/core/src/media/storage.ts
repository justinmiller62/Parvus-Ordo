// StorageProvider — the boundary between our app and the video host/CDN.
// Locally (or with MEDIA_STUB=1) this resolves to a stub; in prod, Bunny Stream.
// Swapping providers is confined to getStorage() (CLAUDE.md §5).

import { createHash } from "node:crypto";
import type { AssetStatus } from "./assets";

/** Where/how the browser uploads the raw video bytes. */
export type UploadTarget =
  | { kind: "stub"; url: string } // dev: PUT bytes (or just no-op) here
  | {
      // Bunny resumable (TUS) upload — the library key never reaches the browser;
      // only a short-lived signature does.
      kind: "tus";
      endpoint: string;
      libraryId: string;
      videoId: string;
      signature: string;
      expires: number;
    };

export interface VideoUpload {
  providerAssetId: string;
  target: UploadTarget;
  playbackUrl: string | null;
  posterUrl: string | null;
}

export interface VideoStatus {
  status: AssetStatus;
  /** Transcode progress 0–100. */
  progress: number;
  durationMs: number | null;
}

export interface StorageProvider {
  readonly name: string;
  /** Reserve a remote video object and return an upload target. */
  createUpload(opts: { title: string }): Promise<VideoUpload>;
  /** Server-side upload of already-buffered bytes (e.g. a finished Parvus Studio
   * recording the server holds in full), as opposed to a browser TUS stream.
   * Returns the provider asset id + an embeddable playback URL. */
  uploadBytes(
    opts: { title: string },
    bytes: ArrayBuffer | Uint8Array,
  ): Promise<{ providerAssetId: string; playbackUrl: string }>;
  /** Poll the host for transcode progress / completion. */
  videoStatus(providerAssetId: string): Promise<VideoStatus>;
  playbackUrl(providerAssetId: string): string;
  posterUrl(providerAssetId: string): string;
  delete(providerAssetId: string): Promise<void>;
}

// ─── Stub (local dev / tests) ────────────────────────────────────────────────

const SAMPLE_HLS =
  process.env.SAMPLE_HLS_URL ??
  "https://devstreaming-cdn.apple.com/videos/streaming/examples/img_bipbop_adv_example_ts/master.m3u8";

class StubStorage implements StorageProvider {
  readonly name = "stub";
  async createUpload(): Promise<VideoUpload> {
    const id = `stub-${Date.now().toString(36)}`;
    return {
      providerAssetId: id,
      target: { kind: "stub", url: `/api/dev/upload/${id}` },
      playbackUrl: SAMPLE_HLS,
      posterUrl: "",
    };
  }
  async uploadBytes(): Promise<{ providerAssetId: string; playbackUrl: string }> {
    // No network: "store" the bytes by handing back a sample playback URL so the
    // recording flow completes offline / under MEDIA_STUB.
    return { providerAssetId: `stub-${Date.now().toString(36)}`, playbackUrl: SAMPLE_HLS };
  }
  async videoStatus(): Promise<VideoStatus> {
    // Stub "transcodes" instantly so the upload flow can complete offline.
    return { status: "ready", progress: 100, durationMs: null };
  }
  playbackUrl(): string {
    return SAMPLE_HLS;
  }
  posterUrl(): string {
    return "";
  }
  async delete(): Promise<void> {}
}

// ─── Bunny Stream (prod) ─────────────────────────────────────────────────────

/**
 * Map Bunny's numeric video status + encode progress to our lifecycle. Pure so it
 * can be unit-tested without the network. Bunny codes: 0 Created, 1 Uploaded,
 * 2 Processing, 3 Transcoding, 4 Finished, 5 Error, 6 UploadFailed.
 */
export function mapBunnyStatus(code: number, encodeProgress: number, lengthSec: number | null): VideoStatus {
  const durationMs = lengthSec && lengthSec > 0 ? Math.round(lengthSec * 1000) : null;
  if (code >= 5) return { status: "failed", progress: encodeProgress ?? 0, durationMs };
  if (code === 4) return { status: "ready", progress: 100, durationMs };
  if (code <= 1) return { status: "uploading", progress: 0, durationMs };
  return { status: "processing", progress: encodeProgress ?? 0, durationMs };
}

class BunnyStorage implements StorageProvider {
  readonly name = "bunny";
  constructor(
    private readonly libraryId: string,
    private readonly apiKey: string,
    private readonly cdnHostname: string,
  ) {}

  private get base(): string {
    return `https://video.bunnycdn.com/library/${this.libraryId}/videos`;
  }

  async createUpload(opts: { title: string }): Promise<VideoUpload> {
    const res = await fetch(this.base, {
      method: "POST",
      headers: { AccessKey: this.apiKey, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ title: opts.title }),
    });
    if (!res.ok) throw new Error(`Bunny createVideo failed: ${res.status} ${await res.text()}`);
    const { guid } = (await res.json()) as { guid: string };

    // TUS auth: SHA256(libraryId + apiKey + expires + videoId). Valid for one hour.
    const expires = Math.floor(Date.now() / 1000) + 3600;
    const signature = createHash("sha256").update(`${this.libraryId}${this.apiKey}${expires}${guid}`).digest("hex");
    return {
      providerAssetId: guid,
      target: {
        kind: "tus",
        endpoint: "https://video.bunnycdn.com/tusupload",
        libraryId: this.libraryId,
        videoId: guid,
        signature,
        expires,
      },
      playbackUrl: this.playbackUrl(guid),
      posterUrl: this.posterUrl(guid),
    };
  }

  async uploadBytes(
    opts: { title: string },
    bytes: ArrayBuffer | Uint8Array,
  ): Promise<{ providerAssetId: string; playbackUrl: string }> {
    const create = await fetch(this.base, {
      method: "POST",
      headers: { AccessKey: this.apiKey, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ title: opts.title }),
    });
    if (!create.ok) throw new Error(`Bunny createVideo failed: ${create.status} ${await create.text()}`);
    const { guid } = (await create.json()) as { guid: string };

    const put = await fetch(`${this.base}/${guid}`, {
      method: "PUT",
      headers: { AccessKey: this.apiKey },
      // Cast bridges two tsconfigs: core (lib ES2022, no DOM `BodyInit`) and apps/web
      // (DOM lib). `ArrayBuffer` is a valid fetch body in both; fetch accepts the
      // Uint8Array at runtime regardless.
      body: bytes as ArrayBuffer,
    });
    if (!put.ok) throw new Error(`Bunny uploadBytes failed: ${put.status}`);
    return { providerAssetId: guid, playbackUrl: this.embedUrl(guid) };
  }

  /** Bunny's hosted iframe player — for direct `<iframe>` embed of a finished
   * recording, distinct from the raw HLS playlist (playbackUrl) the OCIA media
   * pipeline plays itself. */
  private embedUrl(guid: string): string {
    return `https://iframe.mediadelivery.net/embed/${this.libraryId}/${guid}`;
  }

  async videoStatus(guid: string): Promise<VideoStatus> {
    const res = await fetch(`${this.base}/${guid}`, {
      headers: { AccessKey: this.apiKey, Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`Bunny videoStatus failed: ${res.status}`);
    const v = (await res.json()) as { status: number; encodeProgress: number; length: number };
    return mapBunnyStatus(v.status, v.encodeProgress, v.length);
  }

  playbackUrl(guid: string): string {
    return `https://${this.cdnHostname}/${guid}/playlist.m3u8`;
  }
  posterUrl(guid: string): string {
    return `https://${this.cdnHostname}/${guid}/thumbnail.jpg`;
  }
  async delete(guid: string): Promise<void> {
    await fetch(`${this.base}/${guid}`, { method: "DELETE", headers: { AccessKey: this.apiKey } });
  }
}

let cached: StorageProvider | undefined;

/** Active storage provider: stub when MEDIA_STUB=1 or unconfigured, else Bunny. */
export function getStorage(): StorageProvider {
  if (cached) return cached;
  const libraryId = process.env.BUNNY_STREAM_LIBRARY_ID;
  const apiKey = process.env.BUNNY_STREAM_LIBRARY_KEY;
  const cdn = process.env.BUNNY_STREAM_CDN_HOSTNAME;
  const stub = process.env.MEDIA_STUB === "1";
  cached = !stub && libraryId && apiKey && cdn ? new BunnyStorage(libraryId, apiKey, cdn) : new StubStorage();
  return cached;
}
