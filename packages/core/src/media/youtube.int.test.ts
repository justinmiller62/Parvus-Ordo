import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, deleteAsset, getAsset, getDb, ingestYouTubeAsset } from "@parvaordo/core";

const HOLY_SPIRIT = "11111111-1111-1111-1111-111111111111";
const ST_MONICA = "22222222-2222-2222-2222-222222222222";

let adminId: string;
const made: string[] = [];

beforeAll(async () => {
  const { rows } = await getDb(HOLY_SPIRIT).query<{ id: string }>(
    "SELECT id FROM users WHERE email = 'admin@parvaordo.test'",
  );
  adminId = rows[0]!.id;
});

afterAll(async () => {
  for (const id of made) await deleteAsset(HOLY_SPIRIT, id).catch(() => {});
  await closeDb();
});

const withCaptions = async () => ({
  text: "Real Presence",
  words: [{ word: "Real Presence", start: 0, end: 1.5 }],
});

describe("ingestYouTubeAsset (integration)", () => {
  it("creates an external youtube video asset and imports its captions into the transcript", async () => {
    const assetId = await ingestYouTubeAsset(
      { parishId: HOLY_SPIRIT, createdBy: adminId, input: "https://youtu.be/abc12345678", title: "  Eucharist 101  " },
      { fetchCaptions: withCaptions },
    );
    made.push(assetId);

    const a = await getAsset(HOLY_SPIRIT, assetId);
    expect(a).not.toBeNull();
    expect(a!.kind).toBe("video"); // a video asset — downstream stays source-agnostic
    expect(a!.provider).toBe("youtube"); // ...distinguished only by provider
    expect(a!.providerAssetId).toBe("abc12345678");
    expect(a!.playbackUrl).toBe("https://www.youtube.com/watch?v=abc12345678");
    expect(a!.status).toBe("ready"); // nothing to upload/process
    expect(a!.title).toBe("Eucharist 101"); // trimmed
    expect(a!.transcriptionStatus).toBe("completed");
    expect(a!.transcriptText).toBe("Real Presence");
    expect(a!.transcriptJson).toEqual([{ word: "Real Presence", start: 0, end: 1.5 }]);
  });

  it("still creates the asset but marks transcription failed when no captions are available", async () => {
    const assetId = await ingestYouTubeAsset(
      { parishId: HOLY_SPIRIT, createdBy: adminId, input: "dQw4w9WgXcQ" },
      { fetchCaptions: async () => null },
    );
    made.push(assetId);

    const a = await getAsset(HOLY_SPIRIT, assetId);
    expect(a!.status).toBe("ready");
    expect(a!.providerAssetId).toBe("dQw4w9WgXcQ");
    expect(a!.title).toBe("YouTube video dQw4w9WgXcQ"); // default title
    expect(a!.transcriptionStatus).toBe("failed");
    expect(a!.transcriptJson).toBeNull();
  });

  it("marks transcription failed (not the whole ingest) when caption fetch throws", async () => {
    const assetId = await ingestYouTubeAsset(
      { parishId: HOLY_SPIRIT, createdBy: adminId, input: "https://www.youtube.com/watch?v=abc12345678" },
      {
        fetchCaptions: async () => {
          throw new Error("not_https");
        },
      },
    );
    made.push(assetId);
    const a = await getAsset(HOLY_SPIRIT, assetId);
    expect(a!.status).toBe("ready");
    expect(a!.transcriptionStatus).toBe("failed");
  });

  it("rejects an input with no valid video id", async () => {
    await expect(
      ingestYouTubeAsset({ parishId: HOLY_SPIRIT, createdBy: adminId, input: "https://vimeo.com/123" }),
    ).rejects.toThrow(/invalid youtube/i);
  });

  it("scopes the asset to its parish — another parish cannot read it (RLS)", async () => {
    const assetId = await ingestYouTubeAsset(
      { parishId: HOLY_SPIRIT, createdBy: adminId, input: "https://youtu.be/abc12345678" },
      { fetchCaptions: withCaptions },
    );
    made.push(assetId);
    expect(await getAsset(HOLY_SPIRIT, assetId)).not.toBeNull();
    expect(await getAsset(ST_MONICA, assetId)).toBeNull(); // cross-tenant isolation
  });
});
