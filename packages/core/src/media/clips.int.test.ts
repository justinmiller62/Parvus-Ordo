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
import { VIDEO_WATCH_FIRST_SAVE_BUDGET_MS } from "@parvaordo/shared";

const HOLY_SPIRIT = "11111111-1111-1111-1111-111111111111";

async function userId(email: string): Promise<string> {
  const { rows } = await getDb(HOLY_SPIRIT).query<{ id: string }>("SELECT id FROM users WHERE email = $1", [email]);
  return rows[0]!.id;
}

/**
 * Simulate real watch time passing by backdating the progress row's `updated_at`, so the
 * NEXT markVideoProgress paces the report against that much wall-clock (pacedMaxReachedMs).
 * Lets these tests drive the legitimate "watched over real time" path without sleeping.
 */
async function elapseWatchSeconds(student: string, itemId: string, seconds: number): Promise<void> {
  await getDb(HOLY_SPIRIT).query(
    "UPDATE lesson_item_progress SET updated_at = now() - make_interval(secs => $1) WHERE student_id = $2 AND item_id = $3",
    [seconds, student, itemId],
  );
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
  it("persists the furthest point (paced + grows only); completion stays false when the clip length is unknown", async () => {
    const by = await userId("admin@parvaordo.test");
    const student = await userId("student@parvaordo.test");
    const lessonId = await createLesson({ parishId: HOLY_SPIRIT, createdBy: by, title: "Progress Test" });
    const versionId = (await getLessonForEdit(HOLY_SPIRIT, lessonId))!.selected.versionId;
    // content:{} has no resolvable clip length, so the completion gate fails closed.
    const itemId = await addLessonItem({ parishId: HOLY_SPIRIT, versionId, kind: "video", content: {} });

    // First save (no prior row) lands within the first-save budget.
    await markVideoProgress({ parishId: HOLY_SPIRIT, studentId: student, itemId, maxReachedMs: 4000 });
    expect(await getItemMaxReached(HOLY_SPIRIT, student, itemId)).toBe(4000);

    // a smaller report does not move it backwards
    await markVideoProgress({ parishId: HOLY_SPIRIT, studentId: student, itemId, maxReachedMs: 1000 });
    expect(await getItemMaxReached(HOLY_SPIRIT, student, itemId)).toBe(4000);

    // an immediate huge jump is paced away — a rapid save advances at most by the (tiny)
    // real elapsed × rate, nowhere near the 10,000,000 requested. No rapid walk-up.
    await markVideoProgress({ parishId: HOLY_SPIRIT, studentId: student, itemId, maxReachedMs: 10_000_000 });
    const afterJump = await getItemMaxReached(HOLY_SPIRIT, student, itemId);
    expect(afterJump).toBeGreaterThanOrEqual(4000); // never shrinks
    expect(afterJump).toBeLessThan(6000); // ...but barely moved (real round-trip is a few ms)

    // once real watch time has elapsed the furthest point grows, but completion never flips
    // for an unknown length
    await elapseWatchSeconds(student, itemId, 30);
    await markVideoProgress({ parishId: HOLY_SPIRIT, studentId: student, itemId, maxReachedMs: 8000 });
    expect(await getItemMaxReached(HOLY_SPIRIT, student, itemId)).toBe(8000);
    expect((await getCompletedItemsForVersion(HOLY_SPIRIT, student, versionId)).has(itemId)).toBe(false);

    await deleteLesson(HOLY_SPIRIT, lessonId);
  });
});

describe("video completion is earned, not client-trusted", () => {
  // A 30s clip: long enough that the player's 5s end-grace still leaves a real
  // "you must reach the end" band a forged report has to land inside.
  const CLIP_MS = 30_000;

  // A video lesson item wired to a real (stub) clip whose duration_ms is known, so
  // markVideoProgress has a trusted upper bound to validate client reports against.
  async function videoItemOnClip(clipMs: number = CLIP_MS): Promise<{
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
      endMs: clipMs,
    });
    const lessonId = await createLesson({ parishId: HOLY_SPIRIT, createdBy: by, title: "Earned Lesson" });
    const versionId = (await getLessonForEdit(HOLY_SPIRIT, lessonId))!.selected.versionId;
    const itemId = await addLessonItem({
      parishId: HOLY_SPIRIT,
      versionId,
      kind: "video",
      content: { asset_id: sourceId, clip_asset_id: clipId, start_ms: 0, end_ms: clipMs },
    });
    return { lessonId, versionId, itemId, sourceId };
  }

  it("paces a single forged save — it can't jump a long clip to the end or self-complete (po-4dyo)", async () => {
    const student = await userId("student@parvaordo.test");
    const { lessonId, versionId, itemId, sourceId } = await videoItemOnClip();

    // Client claims it instantly watched to 5,000,000ms of a 30,000ms clip, in ONE save.
    await markVideoProgress({ parishId: HOLY_SPIRIT, studentId: student, itemId, maxReachedMs: 5_000_000 });

    // With no prior watch history the first save is paced to the fixed budget — well under
    // the clip — so the stored point is neither the forged value, the clip end, nor enough
    // to satisfy completion. The one-shot forge that motivated po-4dyo no longer works.
    expect(await getItemMaxReached(HOLY_SPIRIT, student, itemId)).toBe(VIDEO_WATCH_FIRST_SAVE_BUDGET_MS);
    expect((await getCompletedItemsForVersion(HOLY_SPIRIT, student, versionId)).has(itemId)).toBe(false);
    expect(await isVideoItemWatched({ parishId: HOLY_SPIRIT, studentId: student, itemId })).toBe(false);

    // An immediate second forge can't climb to the end either: a rapid save advances at most
    // by the (tiny) real elapsed × rate, so the point stays near the budget and far below the
    // 25s end-grace — no rapid walk-up.
    await markVideoProgress({ parishId: HOLY_SPIRIT, studentId: student, itemId, maxReachedMs: 5_000_000 });
    const afterSecondForge = await getItemMaxReached(HOLY_SPIRIT, student, itemId);
    expect(afterSecondForge).toBeGreaterThanOrEqual(VIDEO_WATCH_FIRST_SAVE_BUDGET_MS); // never shrinks
    expect(afterSecondForge).toBeLessThan(VIDEO_WATCH_FIRST_SAVE_BUDGET_MS + 2_000); // barely moved
    expect((await getCompletedItemsForVersion(HOLY_SPIRIT, student, versionId)).has(itemId)).toBe(false);

    await deleteLesson(HOLY_SPIRIT, lessonId);
    await deleteAsset(HOLY_SPIRIT, sourceId); // cascades the clip
  });

  it("leaves an honest mid-clip furthest point incomplete (progress still recorded)", async () => {
    const student = await userId("student@parvaordo.test");
    const { lessonId, versionId, itemId, sourceId } = await videoItemOnClip();

    await markVideoProgress({ parishId: HOLY_SPIRIT, studentId: student, itemId, maxReachedMs: 1_000 });

    expect((await getCompletedItemsForVersion(HOLY_SPIRIT, student, versionId)).has(itemId)).toBe(false);
    expect(await getItemMaxReached(HOLY_SPIRIT, student, itemId)).toBe(1_000);

    await deleteLesson(HOLY_SPIRIT, lessonId);
    await deleteAsset(HOLY_SPIRIT, sourceId);
  });

  it("honors completion when the student reaches the clip end over real watch time", async () => {
    const student = await userId("student@parvaordo.test");
    const { lessonId, versionId, itemId, sourceId } = await videoItemOnClip();

    // An honest paced watch: an opening mid-clip save, then real time elapses before the
    // furthest point reaches the end-grace.
    await markVideoProgress({ parishId: HOLY_SPIRIT, studentId: student, itemId, maxReachedMs: 1_000 });
    expect((await getCompletedItemsForVersion(HOLY_SPIRIT, student, versionId)).has(itemId)).toBe(false);

    await elapseWatchSeconds(student, itemId, 20); // ~20s of real watching of the 30s clip
    // Within the player's 5s end-grace of a 30s clip — a real finish.
    await markVideoProgress({ parishId: HOLY_SPIRIT, studentId: student, itemId, maxReachedMs: CLIP_MS - 1_000 });

    expect((await getCompletedItemsForVersion(HOLY_SPIRIT, student, versionId)).has(itemId)).toBe(true);
    expect(await getItemMaxReached(HOLY_SPIRIT, student, itemId)).toBe(CLIP_MS - 1_000);

    await deleteLesson(HOLY_SPIRIT, lessonId);
    await deleteAsset(HOLY_SPIRIT, sourceId);
  });

  it("isVideoItemWatched (the advanceAction gate) is false until a paced watch reaches the end-grace", async () => {
    const student = await userId("student@parvaordo.test");
    const { lessonId, itemId, sourceId } = await videoItemOnClip();

    // No progress persisted yet — a direct advanceAction POST would bounce, not complete.
    expect(await isVideoItemWatched({ parishId: HOLY_SPIRIT, studentId: student, itemId })).toBe(false);

    // Honest mid-clip progress still does not count as watched.
    await markVideoProgress({ parishId: HOLY_SPIRIT, studentId: student, itemId, maxReachedMs: 1_000 });
    expect(await isVideoItemWatched({ parishId: HOLY_SPIRIT, studentId: student, itemId })).toBe(false);

    // Reaching within the end-grace over real watch time flips the gate true.
    await elapseWatchSeconds(student, itemId, 20);
    await markVideoProgress({ parishId: HOLY_SPIRIT, studentId: student, itemId, maxReachedMs: CLIP_MS - 1_000 });
    expect(await isVideoItemWatched({ parishId: HOLY_SPIRIT, studentId: student, itemId })).toBe(true);

    await deleteLesson(HOLY_SPIRIT, lessonId);
    await deleteAsset(HOLY_SPIRIT, sourceId);
  });

  it("a short (sub-tolerance) clip is NOT ungated: zero watching never completes it; a real watch does", async () => {
    const student = await userId("student@parvaordo.test");
    // A 3s clip: shorter than the 5s end-grace, so the pre-floor gate would have waved
    // through zero progress (duration - tolerance <= 0). The fraction floor stops that.
    const { lessonId, versionId, itemId, sourceId } = await videoItemOnClip(3_000);

    await markVideoProgress({ parishId: HOLY_SPIRIT, studentId: student, itemId, maxReachedMs: 0 });
    expect((await getCompletedItemsForVersion(HOLY_SPIRIT, student, versionId)).has(itemId)).toBe(false);
    expect(await isVideoItemWatched({ parishId: HOLY_SPIRIT, studentId: student, itemId })).toBe(false);

    // Genuinely watching the short clip (>= 90% of 3s) over real time does complete it.
    await elapseWatchSeconds(student, itemId, 3);
    await markVideoProgress({ parishId: HOLY_SPIRIT, studentId: student, itemId, maxReachedMs: 3_000 });
    expect((await getCompletedItemsForVersion(HOLY_SPIRIT, student, versionId)).has(itemId)).toBe(true);
    expect(await isVideoItemWatched({ parishId: HOLY_SPIRIT, studentId: student, itemId })).toBe(true);

    await deleteLesson(HOLY_SPIRIT, lessonId);
    await deleteAsset(HOLY_SPIRIT, sourceId);
  });

  it("a clip within the first-save budget completes on a single save — the one-shot watch AND the bounded short-clip residual (po-4dyo)", async () => {
    const student = await userId("student@parvaordo.test");
    // A clip shorter than the first-save budget can be finished by the player's single
    // completion save (no prior throttle save) — the legitimate one-shot path. By the same
    // token a one-shot forge of a clip this short still self-completes: the documented
    // residual. Pacing makes a forge cost ~clip-length of real time, which for a clip
    // shorter than one save interval is negligible; the high-value LONG clips are closed
    // (see the forge test above).
    const { lessonId, versionId, itemId, sourceId } = await videoItemOnClip(6_000);
    expect(6_000).toBeLessThan(VIDEO_WATCH_FIRST_SAVE_BUDGET_MS);

    await markVideoProgress({ parishId: HOLY_SPIRIT, studentId: student, itemId, maxReachedMs: 6_000 });
    expect((await getCompletedItemsForVersion(HOLY_SPIRIT, student, versionId)).has(itemId)).toBe(true);
    expect(await isVideoItemWatched({ parishId: HOLY_SPIRIT, studentId: student, itemId })).toBe(true);

    await deleteLesson(HOLY_SPIRIT, lessonId);
    await deleteAsset(HOLY_SPIRIT, sourceId);
  });
});
