-- 0033_apologetics — Apologetics module: objection → reply → citations, ported from the
-- "To Whom Shall We Go" corpus. Same three-layer architecture as the dictionary (0019) and
-- prayers (0020):
--   apologetics_topics     — GLOBAL objections (no parish_id); everyone reads approved rows;
--                            writes only by the owner/seed (no app policy).
--   apologetics_citations   — GLOBAL citations belonging to a topic (Scripture, Fathers,
--                            Councils, Catechism). Ordered within their topic.
--   apologetics_overrides   — per-parish field overrides of a global topic (wide columns).
-- Parish tables use the standard getDb(parishId) → app.parish_id RLS pattern; role gating
-- is enforced in the entry points, as elsewhere.

CREATE TABLE apologetics_topics (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Stable anchor slug ("john6", "relics"); also the deep-link fragment.
  slug          text NOT NULL UNIQUE,
  -- Short nav label ("John 6", "Relics") — distinct from the full objection text.
  label         text NOT NULL,
  -- The objection as someone actually says it ("The Eucharist is only a symbol.").
  objection     text NOT NULL,
  -- One-line answer. NULL where the topic instead opens with `lead` (the summary card).
  reply         text,
  -- Long-form opener used by the summary topic in place of a reply.
  lead          text,
  -- Invitation-first question to hand back to the other person. Optional.
  ask           text,
  display_order integer NOT NULL DEFAULT 0,
  status        text NOT NULL DEFAULT 'approved',
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX apologetics_topics_order_idx ON apologetics_topics(display_order, slug);
CREATE INDEX apologetics_topics_status_idx ON apologetics_topics(status);
ALTER TABLE apologetics_topics ENABLE ROW LEVEL SECURITY;
-- Global: anyone may read approved topics; no app write policy (owner/seed only).
CREATE POLICY apologetics_topics_read ON apologetics_topics FOR SELECT USING (status = 'approved');

CREATE TABLE apologetics_citations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  topic_id      uuid NOT NULL REFERENCES apologetics_topics(id) ON DELETE CASCADE,
  -- Source label as displayed ("John 6:53", "St. Cyprian, On the Unity of the Church 6").
  ref           text NOT NULL,
  -- Provenance badge ("Father · c. 251", "Council · 1547", "Catechism"). NULL = Scripture,
  -- which needs no badge because the ref already reads as a book/chapter/verse.
  source_kind   text,
  -- Douay-Rheims numbering where it differs from most modern Bibles ("DR 6:54").
  alt_ref       text,
  -- NULLABLE on purpose: some citations point at a whole chapter (e.g. "Hebrews 11") and
  -- carry only a `why` gloss rather than a quotation.
  quote         text,
  -- Short gloss on why this citation answers the objection.
  why           text,
  display_order integer NOT NULL DEFAULT 0
);
CREATE INDEX apologetics_citations_topic_idx ON apologetics_citations(topic_id, display_order);
ALTER TABLE apologetics_citations ENABLE ROW LEVEL SECURITY;
-- Global, mirroring the topics policy: readable when the parent topic is approved.
CREATE POLICY apologetics_citations_read ON apologetics_citations FOR SELECT USING (
  EXISTS (SELECT 1 FROM apologetics_topics t WHERE t.id = topic_id AND t.status = 'approved')
);

CREATE TABLE apologetics_overrides (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parish_id          uuid NOT NULL REFERENCES parishes(id) ON DELETE CASCADE,
  topic_id           uuid NOT NULL REFERENCES apologetics_topics(id) ON DELETE CASCADE,
  override_reply     text,
  override_ask       text,
  override_notes     text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (parish_id, topic_id)
);
CREATE INDEX apologetics_overrides_parish_idx ON apologetics_overrides(parish_id);
ALTER TABLE apologetics_overrides ENABLE ROW LEVEL SECURITY;
CREATE POLICY apologetics_overrides_isolation ON apologetics_overrides FOR ALL
  USING (parish_id = current_setting('app.parish_id', true)::uuid)
  WITH CHECK (parish_id = current_setting('app.parish_id', true)::uuid);
