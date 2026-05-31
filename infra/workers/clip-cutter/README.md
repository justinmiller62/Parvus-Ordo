# clip-cutter

Out-of-band video clip service (Architecture §5 / §9). A **pure transform**: cut a
frame-accurate `[start,end]` window from a source video, host it on Bunny, and call
back so `packages/core` flips the clip asset to `ready`. **Zero business logic** —
all orchestration (dedup, lifecycle, cleanup, RLS) stays in core. It lives in the
monorepo (one CI, no contract drift); extract to its own repo only if a real trigger
appears (separate cadence/ownership, reuse by another product).

## Contract
`POST /cut` (from core's `HttpClipProcessor`):
```json
{ "clipAssetId": "...", "parishId": "...", "sourceProviderAssetId": "<bunny guid>",
  "startMs": 1000, "endMs": 5000, "callbackUrl": "https://app/api/ocia/clips/<id>/ready" }
```
Responds `202` immediately; cuts + uploads + callbacks asynchronously. The callback
posts `{ parishId, providerAssetId, playbackUrl, posterUrl, durationMs }` (or
`{ parishId, error }`) with header `x-clip-secret`.

## Env
`BUNNY_STREAM_LIBRARY_ID`, `BUNNY_STREAM_LIBRARY_KEY`, `BUNNY_STREAM_CDN_HOSTNAME`,
`CLIP_CALLBACK_SECRET`, `PORT`.

## Wiring (prod)
Set on the **app**: `CLIP_CUTTER_URL=https://<this-service>/cut`, `APP_URL=https://<app>`,
`CLIP_CALLBACK_SECRET=<shared>`. Then `getClipProcessor()` uses `HttpClipProcessor`
instead of the stub. Locally (and in CI) the stub runs — no container needed.

## Notes / deploy TODOs
- ffmpeg input is the source's **Bunny MP4 fallback** (`play_720p.mp4`) — ensure
  `EnableMP4Fallback` is on for the library (it is). If Bunny playback is
  referrer/token-gated, add the required headers to the ffmpeg input or fetch via
  the Bunny API first.
- Frame-accurate by design: `-ss` before `-i` **with re-encode** (libx264/aac), not
  `-c copy` (which is keyframe-bound). Clips are short, so re-encode is cheap; Bunny
  re-encodes to HLS on ingest regardless.
- Build/deploy: `docker build -t clip-cutter .` → push to Cloudflare Containers,
  bind via a Worker/Queue, set env. (Not wired to CI yet.)
