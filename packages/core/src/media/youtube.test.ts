import { describe, expect, it } from "vitest";
import {
  extractYouTubeId,
  fetchYouTubeCaptions,
  fetchYouTubeMedia,
  parseTimedTextXml,
  parseYouTubeLengthSeconds,
  youTubeEmbedUrl,
} from "./youtube";

describe("extractYouTubeId", () => {
  it("accepts a bare 11-char id", () => {
    expect(extractYouTubeId("dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(extractYouTubeId("  dQw4w9WgXcQ  ")).toBe("dQw4w9WgXcQ");
  });

  it("parses watch / youtu.be / embed / shorts URLs", () => {
    expect(extractYouTubeId("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(extractYouTubeId("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s")).toBe("dQw4w9WgXcQ");
    expect(extractYouTubeId("https://youtu.be/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(extractYouTubeId("https://www.youtube.com/embed/dQw4w9WgXcQ?rel=0")).toBe("dQw4w9WgXcQ");
    expect(extractYouTubeId("https://www.youtube.com/shorts/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(extractYouTubeId("https://m.youtube.com/watch?v=dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
  });

  it("rejects invalid input and non-youtube hosts", () => {
    expect(extractYouTubeId("")).toBeNull();
    expect(extractYouTubeId("not a url")).toBeNull();
    expect(extractYouTubeId("https://vimeo.com/watch?v=dQw4w9WgXcQ")).toBeNull();
    expect(extractYouTubeId("https://www.youtube.com/watch?v=short")).toBeNull();
    expect(extractYouTubeId("https://evil.com/youtube.com/watch?v=dQw4w9WgXcQ")).toBeNull();
  });
});

describe("parseTimedTextXml", () => {
  it("parses the classic <text start dur> format into per-segment words (seconds)", () => {
    const xml =
      '<?xml version="1.0"?><transcript>' +
      '<text start="0" dur="1.5">Hello there</text>' +
      '<text start="1.5" dur="2">General Kenobi</text>' +
      "</transcript>";
    expect(parseTimedTextXml(xml)).toEqual([
      { word: "Hello there", start: 0, end: 1.5 },
      { word: "General Kenobi", start: 1.5, end: 3.5 },
    ]);
  });

  it("parses the srv3 <p t d> format (milliseconds → seconds)", () => {
    const xml = '<timedtext><body><p t="0" d="1200">Welcome</p><p t="1200" d="800">back</p></body></timedtext>';
    expect(parseTimedTextXml(xml)).toEqual([
      { word: "Welcome", start: 0, end: 1.2 },
      { word: "back", start: 1.2, end: 2 },
    ]);
  });

  it("decodes HTML entities, strips inner tags, and drops empty cues", () => {
    const xml =
      '<transcript><text start="0" dur="1">Faith &amp; <b>Reason</b></text>' +
      '<text start="1" dur="1">  </text>' +
      '<text start="2" dur="1">It&#39;s here</text></transcript>';
    expect(parseTimedTextXml(xml)).toEqual([
      { word: "Faith & Reason", start: 0, end: 1 },
      { word: "It's here", start: 2, end: 3 },
    ]);
  });

  it("returns [] for a track with no cues", () => {
    expect(parseTimedTextXml("<transcript></transcript>")).toEqual([]);
  });
});

describe("fetchYouTubeCaptions (SSRF-safe fetch, injected IO)", () => {
  const lookup = async () => ["142.250.72.14"]; // a public IP so the private-IP guard passes

  // Mock fetchFeed's underlying fetch: serve a watch page with a timedtext baseUrl, then
  // the caption track XML, keyed by URL.
  const fetchImpl = (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes("/watch")) {
      return new Response(
        'window.ytInitcaptions={"captionTracks":[{"baseUrl":"https://www.youtube.com/api/timedtext?v=abc12345678\\u0026lang=en","name":"English"}]}',
        { status: 200, headers: { "content-type": "text/html" } },
      );
    }
    if (url.includes("/api/timedtext")) {
      return new Response('<transcript><text start="0" dur="1.5">Real Presence</text></transcript>', {
        status: 200,
        headers: { "content-type": "text/xml" },
      });
    }
    return new Response("not found", { status: 404 });
  }) as unknown as typeof fetch;

  it("scrapes the watch page for the track URL, fetches it, and parses captions", async () => {
    const result = await fetchYouTubeCaptions("abc12345678", { fetchImpl, lookup });
    expect(result).not.toBeNull();
    expect(result!.words).toEqual([{ word: "Real Presence", start: 0, end: 1.5 }]);
    expect(result!.text).toBe("Real Presence");
  });

  it("returns null when the watch page exposes no caption track", async () => {
    const noCaptions = (async () =>
      new Response("<html>no captions here</html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      })) as unknown as typeof fetch;
    expect(await fetchYouTubeCaptions("abc12345678", { fetchImpl: noCaptions, lookup })).toBeNull();
  });
});

describe("youTubeEmbedUrl", () => {
  it("builds a privacy-enhanced embed URL for a valid id", () => {
    expect(youTubeEmbedUrl("dQw4w9WgXcQ")).toBe(
      "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0&modestbranding=1",
    );
  });

  it("returns null for anything that isn't a bare 11-char id (no arbitrary embeds)", () => {
    expect(youTubeEmbedUrl("")).toBeNull();
    expect(youTubeEmbedUrl("short")).toBeNull();
    expect(youTubeEmbedUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBeNull();
    expect(youTubeEmbedUrl("../../evil")).toBeNull();
  });
});

describe("parseYouTubeLengthSeconds", () => {
  it("extracts lengthSeconds (videoDetails) into ms", () => {
    expect(parseYouTubeLengthSeconds('..."lengthSeconds":"212","keywords"...')).toBe(212_000);
  });

  it("returns null when absent, zero, or implausibly long", () => {
    expect(parseYouTubeLengthSeconds("<html>no details</html>")).toBeNull();
    expect(parseYouTubeLengthSeconds('"lengthSeconds":"0"')).toBeNull();
    expect(parseYouTubeLengthSeconds('"lengthSeconds":"999999999"')).toBeNull(); // > 24h
  });
});

describe("fetchYouTubeMedia (single watch-page fetch → captions + duration)", () => {
  const lookup = async () => ["142.250.72.14"];
  const fetchImpl = (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes("/watch")) {
      return new Response(
        '"lengthSeconds":"212",window.ytInitcaptions={"captionTracks":[{"baseUrl":"https://www.youtube.com/api/timedtext?v=abc12345678\\u0026lang=en"}]}',
        { status: 200, headers: { "content-type": "text/html" } },
      );
    }
    if (url.includes("/api/timedtext")) {
      return new Response('<transcript><text start="0" dur="1.5">Real Presence</text></transcript>', {
        status: 200,
        headers: { "content-type": "text/xml" },
      });
    }
    return new Response("not found", { status: 404 });
  }) as unknown as typeof fetch;

  it("returns both the parsed captions and the duration in one pass", async () => {
    const media = await fetchYouTubeMedia("abc12345678", { fetchImpl, lookup });
    expect(media.durationMs).toBe(212_000);
    expect(media.captions?.words).toEqual([{ word: "Real Presence", start: 0, end: 1.5 }]);
  });

  it("still returns the duration when no caption track is present", async () => {
    const noCaptions = (async () =>
      new Response('"lengthSeconds":"90"', {
        status: 200,
        headers: { "content-type": "text/html" },
      })) as unknown as typeof fetch;
    const media = await fetchYouTubeMedia("abc12345678", { fetchImpl: noCaptions, lookup });
    expect(media.durationMs).toBe(90_000);
    expect(media.captions).toBeNull();
  });
});
