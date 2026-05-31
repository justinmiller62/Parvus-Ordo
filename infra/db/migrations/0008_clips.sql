-- 0008_clips — physical clip assets (revises Architecture §9).
--
-- A lesson video item plays a PHYSICAL clip cut from a source video, so the native
-- iOS/Android player only ever sees the clip's duration (it can't scrub into the
-- rest of the source). A clip is just another row in `assets`:
--   source_asset_id  -> the full video it was cut from (NULL for sources)
--   clip_start_ms / clip_end_ms -> the window cut from the source
-- It has its own provider video (Bunny) + its own transcode `status` (the green/gray
-- "processing → ready" indicator). Cuts are produced by the ClipProcessor
-- (packages/core/src/media/clips.ts): a frame-accurate ffmpeg seek + re-upload to
-- Bunny, run in a Cloudflare Container in prod; a stub locally.
--
-- Deleting a source cascades to its clips (cleanup). Changing a lesson item's trim
-- points creates a new clip and deletes the old one.

ALTER TABLE assets
  ADD COLUMN source_asset_id uuid REFERENCES assets(id) ON DELETE CASCADE,
  ADD COLUMN clip_start_ms   int,
  ADD COLUMN clip_end_ms     int;

CREATE INDEX assets_source_asset_id_idx ON assets(source_asset_id);
