import "dotenv/config";
import { afterAll, describe, expect, it } from "vitest";
import {
  closeDb,
  createAsset,
  deleteAsset,
  getAsset,
  getDb,
  listAssets,
  setTranscript,
  updateAssetStatus,
} from "@parvaordo/core";

const HOLY_SPIRIT = "11111111-1111-1111-1111-111111111111";
const ST_PETER = "33333333-3333-3333-3333-333333333333"; // different diocese

async function userId(email: string): Promise<string> {
  const { rows } = await getDb(HOLY_SPIRIT).query<{ id: string }>("SELECT id FROM users WHERE email = $1", [email]);
  return rows[0]!.id;
}

afterAll(async () => {
  await closeDb();
});

describe("asset lifecycle", () => {
  it("creates a video asset pending transcription; reads it back", async () => {
    const id = await createAsset({
      parishId: HOLY_SPIRIT,
      createdBy: await userId("admin@parvaordo.test"),
      kind: "video",
      title: "Intro Clip",
      mimeType: "video/mp4",
    });
    const a = await getAsset(HOLY_SPIRIT, id);
    expect(a?.kind).toBe("video");
    expect(a?.scope).toBe("parish");
    expect(a?.status).toBe("created");
    expect(a?.transcriptionStatus).toBe("pending"); // video wants a transcript
    await deleteAsset(HOLY_SPIRIT, id);
    expect(await getAsset(HOLY_SPIRIT, id)).toBeNull();
  });

  it("an image asset does not request transcription", async () => {
    const id = await createAsset({
      parishId: HOLY_SPIRIT,
      createdBy: await userId("admin@parvaordo.test"),
      kind: "image",
      title: "Parish Photo",
    });
    expect((await getAsset(HOLY_SPIRIT, id))?.transcriptionStatus).toBe("none");
    await deleteAsset(HOLY_SPIRIT, id);
  });

  it("advances transcode status and attaches playback metadata", async () => {
    const id = await createAsset({
      parishId: HOLY_SPIRIT,
      createdBy: await userId("admin@parvaordo.test"),
      kind: "video",
      title: "Transcode Me",
    });
    await updateAssetStatus({
      parishId: HOLY_SPIRIT,
      id,
      status: "ready",
      playbackUrl: "https://cdn.example/abc/playlist.m3u8",
      durationMs: 90_000,
    });
    const a = await getAsset(HOLY_SPIRIT, id);
    expect(a?.status).toBe("ready");
    expect(a?.playbackUrl).toContain("playlist.m3u8");
    expect(a?.durationMs).toBe(90_000);
    await deleteAsset(HOLY_SPIRIT, id);
  });

  it("stores a transcript (text + word timings) and marks it completed", async () => {
    const id = await createAsset({
      parishId: HOLY_SPIRIT,
      createdBy: await userId("admin@parvaordo.test"),
      kind: "video",
      title: "Talk",
    });
    await setTranscript({
      parishId: HOLY_SPIRIT,
      id,
      text: "hello world",
      words: [
        { word: "hello", start: 0, end: 0.4 },
        { word: "world", start: 0.4, end: 0.9 },
      ],
    });
    const a = await getAsset(HOLY_SPIRIT, id);
    expect(a?.transcriptionStatus).toBe("completed");
    expect(a?.transcriptText).toBe("hello world");
    expect(a?.transcriptJson).toHaveLength(2);
    expect(a?.transcriptJson?.[1]?.word).toBe("world");
    await deleteAsset(HOLY_SPIRIT, id);
  });

  it("filters by kind", async () => {
    const by = await userId("admin@parvaordo.test");
    const v = await createAsset({ parishId: HOLY_SPIRIT, createdBy: by, kind: "video", title: "V" });
    const p = await createAsset({ parishId: HOLY_SPIRIT, createdBy: by, kind: "pdf", title: "P" });
    const videos = await listAssets(HOLY_SPIRIT, { kind: "video" });
    expect(videos.every((a) => a.kind === "video")).toBe(true);
    expect(videos.map((a) => a.id)).toContain(v);
    expect(videos.map((a) => a.id)).not.toContain(p);
    await deleteAsset(HOLY_SPIRIT, v);
    await deleteAsset(HOLY_SPIRIT, p);
  });

  it("RLS hides one parish's asset from another (different diocese)", async () => {
    const id = await createAsset({
      parishId: HOLY_SPIRIT,
      createdBy: await userId("admin@parvaordo.test"),
      kind: "video",
      title: "Private",
    });
    expect(await getAsset(ST_PETER, id)).toBeNull();
    await deleteAsset(HOLY_SPIRIT, id);
  });
});
