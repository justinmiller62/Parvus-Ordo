import "dotenv/config";
import { afterAll, describe, expect, it } from "vitest";
import {
  addLessonItem,
  closeDb,
  createAsset,
  createLesson,
  deleteAsset,
  deleteLesson,
  getAsset,
  getCompletedItemsForVersion,
  getDb,
  getItemMaxReached,
  getLessonForEdit,
  isVideoItemWatched,
  markVideoProgress,
  removeClip,
  requestClip,
} from "@parvaordo/core";

const HOLY_SPIRIT = "11111111-1111-1111-1111-111111111111";

async function userId(email: string): Promise<string> {
  const { rows } = await getDb(HOLY_SPIRIT).query<{ id: string }>("SELECT id FROM users WHERE email = $1", [email]);
  return rows[0]!.id;
}

afterAll(async () => {
  await closeDb();
});

describe("clips (stub processor)", () => {
  it("requestClip creates a ready clip asset linked to its source; removeClip deletes it", async () => {
    const by = await userId("admin@parvaordo.test");
    const source = await createAsset({
      parishId: HOLY_SPIRIT,
      createdBy: by,
      kind: "video",
      title: "Source",
      playbackUrl: "https://cdn.example/src/playlist.m3u8",
      status: "ready",
    });
    const clipId = await requestClip({ parishId: HOLY_SPIRIT, createdBy: by, sourceAssetId: source, startMs: 1000, endMs: 5000 });
    const clip = await getAsset(HOLY_SPIRIT, clipId);
    expect(clip?.sourceAssetId).toBe(source);
    expect(clip?.clipStartMs).toBe(1000);
    expect(clip?.clipEndMs).toBe(5000);
    expect(clip?.status).toBe("ready"); // the stub processor completes instantly
    expect(clip?.transcriptionStatus).toBe("none"); // a clip never transcribes itself

    await removeClip(HOLY_SPIRIT, clipId);
    expect(await getAsset(HOLY_SPIRIT, clipId)).toBeNull();
    await deleteAsset(HOLY_SPIRIT, source);
  });

  it("removeClip refuses to delete a non-clip (source) asset", async () => {
    const by = await userId("admin@parvaordo.test");
    const source = await createAsset({ parishId: HOLY_SPIRIT, createdBy: by, kind: "video", title: "NotAClip" });
    await removeClip(HOLY_SPIRIT, source); // no-op: source_asset_id is null
    expect(await getAsset(HOLY_SPIRIT, source)).not.toBeNull();
    await deleteAsset(HOLY_SPIRIT, source);
  });

  it("deleting a source cascades to its clips", async () => {
    const by = await userId("admin@parvaordo.test");
    const source = await createAsset({ parishId: HOLY_SPIRIT, createdBy: by, kind: "video", title: "Cascade", status: "ready" });
    const clipId = await requestClip({ parishId: HOLY_SPIRIT, createdBy: by, sourceAssetId: source, startMs: 0, endMs: 2000 });
    await deleteAsset(HOLY_SPIRIT, source);
    expect(await getAsset(HOLY_SPIRIT, clipId)).toBeNull(); // FK ON DELETE CASCADE
  });
});

describe("video watch progress", () => {
  it("persists the furthest point (grows only) and server-derives sticky completion", async () => {
    const by = await userId("admin@parvaordo.test");
    const student = await userId("student@parvaordo.test");
    const lessonId = await createLesson({ parishId: HOLY_SPIRIT, createdBy: by, title: "Progress Test" });
    const versionId = (await getLessonForEdit(HOLY_SPIRIT, lessonId))!.selected.versionId;
    // A 10s clip window: completion is derived from reaching within 5s of the end.
    const itemId = await addLessonItem({
      parishId: HOLY_SPIRIT,
      versionId,
      kind: "video",
      content: { start_ms: 0, end_ms: 10_000 },
    });

    await markVideoProgress({ parishId: HOLY_SPIRIT, studentId: student, itemId, maxReachedMs: 4000 });
    expect(await getItemMaxReached(HOLY_SPIRIT, student, itemId)).toBe(4000);
    // 4s of a 10s clip is short of the watch threshold → server keeps it incomplete.
    expect((await getCompletedItemsForVersion(HOLY_SPIRIT, student, versionId)).has(itemId)).toBe(false);

    // a smaller report does not move it backwards
    await markVideoProgress({ parishId: HOLY_SPIRIT, studentId: student, itemId, maxReachedMs: 1000 });
    expect(await getItemMaxReached(HOLY_SPIRIT, student, itemId)).toBe(4000);

    // reaching within tolerance of the end completes it; completion sticks; max grows
    await markVideoProgress({ parishId: HOLY_SPIRIT, studentId: student, itemId, maxReachedMs: 8000 });
    expect(await getItemMaxReached(HOLY_SPIRIT, student, itemId)).toBe(8000);
    expect((await getCompletedItemsForVersion(HOLY_SPIRIT, student, versionId)).has(itemId)).toBe(true);

    await deleteLesson(HOLY_SPIRIT, lessonId);
  });

  it("isVideoItemWatched gates completion: an unwatched video is refused, a watched one accepted", async () => {
    const by = await userId("admin@parvaordo.test");
    const student = await userId("student@parvaordo.test");
    const lessonId = await createLesson({ parishId: HOLY_SPIRIT, createdBy: by, title: "Gate Test" });
    const versionId = (await getLessonForEdit(HOLY_SPIRIT, lessonId))!.selected.versionId;
    const itemId = await addLessonItem({
      parishId: HOLY_SPIRIT,
      versionId,
      kind: "video",
      content: { start_ms: 0, end_ms: 30_000 },
    });

    // No progress yet — a direct advanceAction POST would hit this and be refused.
    expect(await isVideoItemWatched({ parishId: HOLY_SPIRIT, studentId: student, itemId })).toBe(false);

    // Partway through (10s of 30s) is still not "watched".
    await markVideoProgress({ parishId: HOLY_SPIRIT, studentId: student, itemId, maxReachedMs: 10_000 });
    expect(await isVideoItemWatched({ parishId: HOLY_SPIRIT, studentId: student, itemId })).toBe(false);

    // Reaching within tolerance of the end clears the gate.
    await markVideoProgress({ parishId: HOLY_SPIRIT, studentId: student, itemId, maxReachedMs: 30_000 });
    expect(await isVideoItemWatched({ parishId: HOLY_SPIRIT, studentId: student, itemId })).toBe(true);

    await deleteLesson(HOLY_SPIRIT, lessonId);
  });
});
