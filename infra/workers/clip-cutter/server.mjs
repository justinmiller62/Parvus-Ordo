// clip-cutter — out-of-band video clip service (Architecture §5 / §9).
//
// A PURE transform with ZERO business logic: given a source video + a [start,end]
// window, cut a frame-accurate physical clip, host it on Bunny, wait for Bunny to
// transcode it, then call back so packages/core flips the clip asset to "ready".
// All orchestration (which clip, dedup, cleanup, RLS) stays in core.
//
// Runs as a container (Cloudflare Containers in prod; docker-compose locally),
// reached over HTTP by core's HttpClipProcessor.
//
// Env: BUNNY_STREAM_LIBRARY_ID, BUNNY_STREAM_LIBRARY_KEY, BUNNY_STREAM_CDN_HOSTNAME,
//      CLIP_CALLBACK_SECRET, PORT (default 8080).

import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const LIB = process.env.BUNNY_STREAM_LIBRARY_ID;
const KEY = process.env.BUNNY_STREAM_LIBRARY_KEY;
const CDN = process.env.BUNNY_STREAM_CDN_HOSTNAME;
const SECRET = process.env.CLIP_CALLBACK_SECRET;
const PORT = Number(process.env.PORT ?? 8080);
const BUNNY = `https://video.bunnycdn.com/library/${LIB}/videos`;
const REFERER = `https://${CDN}/`; // Bunny CDN blocks no-referer requests

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Frame-accurate cut by re-encoding (NOT -c copy, which is keyframe-bound). Reads
// the source HLS directly (robust vs. guessing an MP4 rendition name) with a referer.
function ffmpegCut(srcUrl, startSec, durSec, outPath) {
  return new Promise((resolve, reject) => {
    const args = [
      "-y",
      "-referer", REFERER,
      "-ss", String(startSec),
      "-i", srcUrl,
      ...(durSec != null ? ["-t", String(durSec)] : []),
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
      "-c:a", "aac",
      "-movflags", "+faststart",
      outPath,
    ];
    const p = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    p.stderr.on("data", (d) => (err += d.toString()));
    p.on("error", reject);
    p.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}: ${err.slice(-800)}`))));
  });
}

async function bunnyCreate(title) {
  const res = await fetch(BUNNY, {
    method: "POST",
    headers: { AccessKey: KEY, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ title }),
  });
  if (!res.ok) throw new Error(`bunny create failed: ${res.status}`);
  return (await res.json()).guid;
}

async function bunnyUpload(guid, bytes) {
  const res = await fetch(`${BUNNY}/${guid}`, { method: "PUT", headers: { AccessKey: KEY, "Content-Type": "video/mp4" }, body: bytes });
  if (!res.ok) throw new Error(`bunny upload failed: ${res.status}`);
}

// Wait until Bunny finishes transcoding the clip (status 4) so its HLS actually
// exists before we report the clip ready. Bunny: 4=Finished, 5=Error, 6=UploadFailed.
async function bunnyWaitReady(guid, timeoutMs = 240_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const res = await fetch(`${BUNNY}/${guid}`, { headers: { AccessKey: KEY, Accept: "application/json" } });
    if (res.ok) {
      const v = await res.json();
      if (v.status === 5 || v.status === 6) throw new Error(`bunny transcode failed (status ${v.status})`);
      if (v.status >= 4) return v;
    }
    if (Date.now() > deadline) throw new Error("bunny transcode timeout");
    await sleep(4000);
  }
}

async function callback(url, body, tries = 4) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(SECRET ? { "x-clip-secret": SECRET } : {}) },
        body: JSON.stringify(body),
      });
      if (res.ok) return;
    } catch {
      /* retry */
    }
    await sleep(1000 * (i + 1));
  }
  console.error("callback failed after retries:", url);
}

async function processJob(job) {
  const { clipAssetId, parishId, sourceProviderAssetId, startMs, endMs, callbackUrl } = job;
  const dir = await mkdtemp(join(tmpdir(), "clip-"));
  const out = join(dir, "clip.mp4");
  try {
    const startSec = (startMs ?? 0) / 1000;
    const durSec = endMs != null ? (endMs - (startMs ?? 0)) / 1000 : null;
    const srcUrl = `https://${CDN}/${sourceProviderAssetId}/playlist.m3u8`;
    await ffmpegCut(srcUrl, startSec, durSec, out);
    const guid = await bunnyCreate(`clip-${clipAssetId}`);
    await bunnyUpload(guid, await readFile(out));
    await bunnyWaitReady(guid);
    await callback(callbackUrl, {
      parishId,
      providerAssetId: guid,
      playbackUrl: `https://${CDN}/${guid}/playlist.m3u8`,
      posterUrl: `https://${CDN}/${guid}/thumbnail.jpg`,
      durationMs: durSec != null ? Math.round(durSec * 1000) : null,
    });
    console.log(`clip ${clipAssetId} ready → ${guid}`);
  } catch (e) {
    console.error(`clip ${clipAssetId} failed:`, e?.message);
    await callback(callbackUrl, { parishId, error: e instanceof Error ? e.message : "clip failed" });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

createServer((req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200).end("ok");
    return;
  }
  if (req.method !== "POST" || req.url !== "/cut") {
    res.writeHead(404).end();
    return;
  }
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    let job;
    try {
      job = JSON.parse(raw);
    } catch {
      res.writeHead(400).end("bad json");
      return;
    }
    res.writeHead(202).end("accepted"); // cut + callback happen in the background
    void processJob(job);
  });
}).listen(PORT, () => console.log(`clip-cutter listening on :${PORT}`));
