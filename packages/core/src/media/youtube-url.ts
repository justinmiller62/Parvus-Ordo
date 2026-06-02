// Pure YouTube URL/id helpers — NO server imports (no DB, no fetch), so this module is
// safe to bundle into a Client Component (imported via "@parvaordo/core/youtube-url").
// `youtube.ts` re-exports these for the server/ingest side and its tests.

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

/**
 * Privacy-enhanced embed URL for a (already-validated) 11-char video id. Used by the
 * teacher picker's preview iframe and as the canonical embed origin. `youtube-nocookie`
 * defers cookies until playback; `rel=0` keeps "related videos" to the same channel.
 * Returns null for anything that isn't a valid id, so a caller can't be coerced into
 * embedding an arbitrary URL.
 */
export function youTubeEmbedUrl(videoId: string): string | null {
  if (!YT_ID.test(videoId)) return null;
  return `https://www.youtube-nocookie.com/embed/${videoId}?rel=0&modestbranding=1`;
}
