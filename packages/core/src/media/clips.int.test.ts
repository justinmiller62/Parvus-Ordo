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
    const clipId = await requestClip({
      parishId: HOLY_SPIRIT,
      createdBy: by,
      sourceAssetId: source,
      startMs: 1000,
      endMs: 5000,
    });
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
    const source = await createAsset({
      parishId: HOLY_SPIRIT,
      createdBy: by,
      kind: "video",
      title: "Cascade",
      status: "ready",
    });
    const clipId = await requestClip({
      parishId: HOLY_SPIRIT,
      createdBy: by,
      sourceAssetId: source,
      startMs: 0,
      endMs: 2000,
    });
    await deleteAsset(HOLY_SPIRIT, source);
    expect(await getAsset(HOLY_SPIRIT, clipId)).toBeNull(); // FK ON DELETE CASCADE
  });
});

describe("video watch progress", () => {
  it("persists the furthest point (grows only) and sticky completion", async () => {
    const by = await userId("admin@parvaordo.test");
    const student = await userId("student@parvaordo.test");
    const lessonId = await createLesson({ parishId: HOLY_SPIRIT, createdBy: by, title: "Progress Test" });
    const versionId = (await getLessonForEdit(HOLY_SPIRIT, lessonId))!.selected.versionId;
    const itemId = await addLessonItem({ parishId: HOLY_SPIRIT, versionId, kind: "video", content: {} });

    await markVideoProgress({ parishId: HOLY_SPIRIT, studentId: student, itemId, maxReachedMs: 4000 });
    expect(await getItemMaxReached(HOLY_SPIRIT, student, itemId)).toBe(4000);

    // a smaller report does not move it backwards
    await markVideoProgress({ parishId: HOLY_SPIRIT, studentId: student, itemId, maxReachedMs: 1000 });
    expect(await getItemMaxReached(HOLY_SPIRIT, student, itemId)).toBe(4000);

    // completion sticks; max still grows
    await markVideoProgress({ parishId: HOLY_SPIRIT, studentId: student, itemId, maxReachedMs: 8000, completed: true });
    expect(await getItemMaxReached(HOLY_SPIRIT, student, itemId)).toBe(8000);
    expect((await getCompletedItemsForVersion(HOLY_SPIRIT, student, versionId)).has(itemId)).toBe(true);

    await deleteLesson(HOLY_SPIRIT, lessonId);
  });
});

describe("video completion is earned, not client-trusted", () => {
  // A 30s clip: long enough that the player's 5s end-grace still leaves a real
  // "you must reach the end" band a forged report has to land inside.
  const CLIP_MS = 30_000;

  // A video lesson item wired to a real (stub) clip whose duration_ms is known, so
  // markVideoProgress has a trusted upper bound to validate client reports against.
  async function videoItemOnClip(): Promise<{
    lessonId: string;
    versionId: string;
    itemId: string;
    sourceId: string;
  }> {
    const by = await userId("admin@parvaordo.test");
    const sourceId = await createAsset({
      parishId: HOLY_SPIRIT,
      createdBy: by,
      kind: "video",
      title: "Earned Source",
      playbackUrl: "https://cdn.example/earned/playlist.m3u8",
      status: "ready",
    });
    // Stub processor sets the clip's duration_ms to endMs - startMs synchronously.
    const clipId = await requestClip({
      parishId: HOLY_SPIRIT,
      createdBy: by,
      sourceAssetId: sourceId,
      startMs: 0,
      endMs: CLIP_MS,
    });
    const lessonId = await createLesson({ parishId: HOLY_SPIRIT, createdBy: by, title: "Earned Lesson" });
    const versionId = (await getLessonForEdit(HOLY_SPIRIT, lessonId))!.selected.versionId;
    const itemId = await addLessonItem({
      parishId: HOLY_SPIRIT,
      versionId,
      kind: "video",
      content: { asset_id: sourceId, clip_asset_id: clipId, start_ms: 0, end_ms: CLIP_MS },
    });
    return { lessonId, versionId, itemId, sourceId };
  }

  it("rejects an over-large forged maxReachedMs: no completion, stored max clamped to the clip", async () => {
    const student = await userId("student@parvaordo.test");
    const { lessonId, versionId, itemId, sourceId } = await videoItemOnClip();

    // Client claims it watched 5,000,000ms of a 30,000ms clip and is "done".
    await markVideoProgress({
      parishId: HOLY_SPIRIT,
      studentId: student,
      itemId,
      maxReachedMs: 5_000_000,
      completed: true,
    });

    expect((await getCompletedItemsForVersion(HOLY_SPIRIT, student, versionId)).has(itemId)).toBe(false);
    expect(await getItemMaxReached(HOLY_SPIRIT, student, itemId)).toBe(CLIP_MS); // clamped, not 5,000,000

    await deleteLesson(HOLY_SPIRIT, lessonId);
    await deleteAsset(HOLY_SPIRIT, sourceId); // cascades the clip
  });

  it("rejects completion claimed from the middle of the clip (honest progress still recorded)", async () => {
    const student = await userId("student@parvaordo.test");
    const { lessonId, versionId, itemId, sourceId } = await videoItemOnClip();

    await markVideoProgress({
      parishId: HOLY_SPIRIT,
      studentId: student,
      itemId,
      maxReachedMs: 1_000,
      completed: true,
    });

    expect((await getCompletedItemsForVersion(HOLY_SPIRIT, student, versionId)).has(itemId)).toBe(false);
    expect(await getItemMaxReached(HOLY_SPIRIT, student, itemId)).toBe(1_000);

    await deleteLesson(HOLY_SPIRIT, lessonId);
    await deleteAsset(HOLY_SPIRIT, sourceId);
  });

  it("honors completion when the student actually reaches the clip end", async () => {
    const student = await userId("student@parvaordo.test");
    const { lessonId, versionId, itemId, sourceId } = await videoItemOnClip();

    // Within the player's 5s end-grace of a 30s clip — a real finish.
    await markVideoProgress({
      parishId: HOLY_SPIRIT,
      studentId: student,
      itemId,
      maxReachedMs: CLIP_MS - 1_000,
      completed: true,
    });

    expect((await getCompletedItemsForVersion(HOLY_SPIRIT, student, versionId)).has(itemId)).toBe(true);
    expect(await getItemMaxReached(HOLY_SPIRIT, student, itemId)).toBe(CLIP_MS - 1_000);

    await deleteLesson(HOLY_SPIRIT, lessonId);
    await deleteAsset(HOLY_SPIRIT, sourceId);
  });
});
