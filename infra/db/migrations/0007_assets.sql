-- 0007_assets — general media/asset manager (Slice 5).
--
-- A single `assets` table backs ALL media kinds (video/image/audio/pdf), not just
-- video — the "video section" in Narthex is really an asset manager. It follows the
-- same THREE-TIER scope cascade as lessons (global ∪ diocese ∪ own-parish read;
-- parish-only write) so a parish can pull from a shared library yet keep its own
-- uploads private. Parish-created assets STAY in the parish.
--
-- A video lesson item references an asset by id and carries an optional clip range:
--   lesson_items.content (kind='video') = { "asset_id": uuid, "start_ms": int, "end_ms": int }
-- Clips are enforced CLIENT-SIDE (seek-gating in the player, Architecture §9) — we do
-- NOT cut server-side clip assets the way Narthex did with Mux.
--
-- Lifecycle is split into two independent state machines so the upload UI can show a
-- multi-stage progress bar (Upload → Transcode → Transcribe → Ready):
--   status               — the host/transcode pipeline (Bunny Stream, real later)
--   transcription_status — the transcript pipeline (Groq Whisper, real later)
-- Both are driven through the StorageProvider / TranscriptionProvider abstractions in
-- packages/core/src/media; locally they resolve to stubs (no external calls).

CREATE TYPE asset_kind AS ENUM ('video', 'image', 'audio', 'pdf');
-- transcode/host pipeline
CREATE TYPE asset_status AS ENUM ('created', 'uploading', 'processing', 'ready', 'failed');
-- transcript pipeline ('none' = not applicable, e.g. an image)
CREATE TYPE transcription_status AS ENUM ('none', 'pending', 'processing', 'completed', 'failed');

CREATE TABLE assets (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope                content_scope NOT NULL DEFAULT 'parish',
  diocese_id           uuid REFERENCES dioceses(id) ON DELETE CASCADE,  -- set iff scope='diocese'
  parish_id            uuid REFERENCES parishes(id) ON DELETE CASCADE,  -- set iff scope='parish'
  created_by           uuid REFERENCES users(id) ON DELETE SET NULL,    -- NULL for system content
  kind                 asset_kind NOT NULL,
  title                text NOT NULL,

  -- where the bytes live. provider='stub' locally; 'bunny'/'r2' in prod.
  provider             text NOT NULL DEFAULT 'stub',
  provider_asset_id    text,                 -- Bunny video GUID / R2 object key
  playback_url         text,                 -- resolved HLS manifest (video) or file URL
  poster_url           text,                 -- thumbnail (video)

  -- transcode/host lifecycle
  status               asset_status NOT NULL DEFAULT 'created',
  duration_ms          int,
  size_bytes           bigint,
  mime_type            text,
  error                text,                 -- last transcode failure message

  -- transcript lifecycle (video/audio only)
  transcription_status transcription_status NOT NULL DEFAULT 'none',
  transcript_text      text,
  transcript_json      jsonb,                -- [{ "word": str, "start": float, "end": float }, ...]
  transcription_error  text,

  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT assets_scope_owner_chk CHECK (
    (scope = 'global'  AND diocese_id IS NULL     AND parish_id IS NULL) OR
    (scope = 'diocese' AND diocese_id IS NOT NULL AND parish_id IS NULL) OR
    (scope = 'parish'  AND parish_id  IS NOT NULL AND diocese_id IS NULL)
  )
);
CREATE INDEX assets_parish_id_idx ON assets(parish_id);
CREATE INDEX assets_diocese_id_idx ON assets(diocese_id);
CREATE INDEX assets_scope_idx ON assets(scope);
CREATE INDEX assets_kind_idx ON assets(kind);
CREATE TRIGGER assets_set_updated_at BEFORE UPDATE ON assets
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─── RLS: three-tier read; parish-only write (mirrors lessons exactly) ───────
ALTER TABLE assets ENABLE ROW LEVEL SECURITY;

CREATE POLICY assets_read ON assets FOR SELECT USING (
  scope = 'global'
  OR (scope = 'diocese' AND diocese_id = (SELECT p.diocese_id FROM parishes p WHERE p.id = current_setting('app.parish_id', true)::uuid))
  OR (scope = 'parish'  AND parish_id  = current_setting('app.parish_id', true)::uuid)
);
CREATE POLICY assets_insert ON assets FOR INSERT
  WITH CHECK (scope = 'parish' AND parish_id = current_setting('app.parish_id', true)::uuid);
CREATE POLICY assets_update ON assets FOR UPDATE
  USING (scope = 'parish' AND parish_id = current_setting('app.parish_id', true)::uuid)
  WITH CHECK (scope = 'parish' AND parish_id = current_setting('app.parish_id', true)::uuid);
CREATE POLICY assets_delete ON assets FOR DELETE
  USING (scope = 'parish' AND parish_id = current_setting('app.parish_id', true)::uuid);
