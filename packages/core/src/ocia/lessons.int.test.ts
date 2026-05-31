import "dotenv/config";
import { afterAll, describe, expect, it } from "vitest";
import {
  addLessonItem,
  closeDb,
  createLesson,
  deleteLesson,
  deleteVersion,
  ensureDraft,
  forkLesson,
  getDb,
  getLessonDetail,
  getLessonForEdit,
  getManageLessons,
  getPublishedLessons,
  publishVersion,
  unpublishLesson,
} from "@parvaordo/core";

const HOLY_SPIRIT = "11111111-1111-1111-1111-111111111111"; // diocese AJ
const ST_MONICA = "22222222-2222-2222-2222-222222222222"; // diocese AJ
const ST_PETER = "33333333-3333-3333-3333-333333333333"; // diocese Erie

const GLOBAL_LESSON = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const DIOCESE_LESSON_AJ = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const HS_LESSON = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const SM_LESSON = "dddddddd-dddd-dddd-dddd-dddddddddddd";

async function userId(email: string): Promise<string> {
  const { rows } = await getDb(HOLY_SPIRIT).query<{ id: string }>("SELECT id FROM users WHERE email = $1", [email]);
  return rows[0]!.id;
}

afterAll(async () => {
  await closeDb();
});

describe("three-tier visibility (published, live versions)", () => {
  it("Holy Spirit sees global + its diocese + its own, not St. Monica's", async () => {
    const ids = (await getPublishedLessons(HOLY_SPIRIT)).map((l) => l.id);
    expect(ids).toContain(GLOBAL_LESSON);
    expect(ids).toContain(DIOCESE_LESSON_AJ);
    expect(ids).toContain(HS_LESSON);
    expect(ids).not.toContain(SM_LESSON);
  });

  it("a parish in another diocese sees global only", async () => {
    const ids = (await getPublishedLessons(ST_PETER)).map((l) => l.id);
    expect(ids).toContain(GLOBAL_LESSON);
    expect(ids).not.toContain(DIOCESE_LESSON_AJ);
    expect(ids).not.toContain(HS_LESSON);
  });

  it("getLessonDetail returns the live version's ordered items", async () => {
    const d = await getLessonDetail(HOLY_SPIRIT, GLOBAL_LESSON);
    expect(d?.items).toHaveLength(3);
    expect(d?.items[0]?.kind).toBe("reading");
    expect(d?.items[1]?.kind).toBe("question");
  });

  it("hides another parish's lesson (RLS null)", async () => {
    expect(await getLessonDetail(ST_PETER, HS_LESSON)).toBeNull();
  });
});

describe("versioning lifecycle", () => {
  it("a new lesson is a draft — invisible to students until published", async () => {
    const id = await createLesson({ parishId: HOLY_SPIRIT, createdBy: await userId("admin@parvaordo.test"), title: "Brand New" });
    expect((await getPublishedLessons(HOLY_SPIRIT)).map((l) => l.id)).not.toContain(id);
    expect((await getManageLessons(HOLY_SPIRIT, {})).find((l) => l.id === id)?.status).toBe("draft");

    const edit = await getLessonForEdit(HOLY_SPIRIT, id);
    await publishVersion({ parishId: HOLY_SPIRIT, lessonId: id, versionId: edit!.selected.versionId });
    expect((await getPublishedLessons(HOLY_SPIRIT)).map((l) => l.id)).toContain(id);
    await deleteLesson(HOLY_SPIRIT, id); // self-clean (no reseed between runs)
  });

  it("editing a published lesson makes a draft; students keep seeing the live version; publish/rollback/unpublish", async () => {
    const id = await createLesson({ parishId: HOLY_SPIRIT, createdBy: await userId("admin@parvaordo.test"), title: "Lifecycle" });
    const e1 = await getLessonForEdit(HOLY_SPIRIT, id);
    const v1 = e1!.selected.versionId;
    await addLessonItem({ parishId: HOLY_SPIRIT, versionId: v1, kind: "reading", content: { html: "<p>v1</p>" } });
    await publishVersion({ parishId: HOLY_SPIRIT, lessonId: id, versionId: v1 });

    // edit -> new draft (v2), copy of v1
    const draftId = await ensureDraft(HOLY_SPIRIT, id);
    expect(draftId).not.toBe(v1);
    expect((await getLessonDetail(HOLY_SPIRIT, id, draftId))?.items).toHaveLength(1);
    // only one draft: ensureDraft is idempotent
    expect(await ensureDraft(HOLY_SPIRIT, id)).toBe(draftId);
    // students still see v1 (live)
    expect((await getLessonDetail(HOLY_SPIRIT, id))?.versionId).toBe(v1);

    // publish v2 -> live moves
    await publishVersion({ parishId: HOLY_SPIRIT, lessonId: id, versionId: draftId });
    expect((await getLessonDetail(HOLY_SPIRIT, id))?.versionId).toBe(draftId);
    // rollback to v1
    await publishVersion({ parishId: HOLY_SPIRIT, lessonId: id, versionId: v1 });
    expect((await getLessonDetail(HOLY_SPIRIT, id))?.versionId).toBe(v1);
    // unpublish -> offline
    await unpublishLesson({ parishId: HOLY_SPIRIT, lessonId: id });
    expect(await getLessonDetail(HOLY_SPIRIT, id)).toBeNull();
    await deleteLesson(HOLY_SPIRIT, id); // self-clean
  });

  it("enforces a single draft per lesson (partial unique index)", async () => {
    const id = await createLesson({ parishId: HOLY_SPIRIT, createdBy: await userId("admin@parvaordo.test"), title: "One Draft" });
    // createLesson made the draft; a second raw draft insert must fail.
    await expect(
      getDb(HOLY_SPIRIT).query(
        "INSERT INTO lesson_versions (lesson_id, scope, parish_id, version_number, title) VALUES ($1, 'parish', $2, 99, 'dupe')",
        [id, HOLY_SPIRIT],
      ),
    ).rejects.toThrow();
    await deleteLesson(HOLY_SPIRIT, id); // self-clean
  });
});

describe("fork", () => {
  it("forks a global lesson into a parish-owned published copy; original untouched; isolated", async () => {
    const forkId = await forkLesson({
      parishId: HOLY_SPIRIT,
      createdBy: await userId("admin@parvaordo.test"),
      sourceLessonId: GLOBAL_LESSON,
    });
    expect(forkId).not.toBe(GLOBAL_LESSON);

    const fork = await getLessonDetail(HOLY_SPIRIT, forkId);
    expect(fork?.scope).toBe("parish");
    expect(fork?.items).toHaveLength(3); // copied from the global live version

    // source unchanged
    expect((await getLessonDetail(HOLY_SPIRIT, GLOBAL_LESSON))?.scope).toBe("global");
    // another parish cannot see the fork
    expect(await getLessonDetail(ST_MONICA, forkId)).toBeNull();
    await deleteLesson(HOLY_SPIRIT, forkId); // self-clean (was leaking a parish "Who Do You Say…" fork)
  });

  it("a parish cannot edit a global lesson (editable=false)", async () => {
    const e = await getLessonForEdit(HOLY_SPIRIT, GLOBAL_LESSON);
    expect(e?.editable).toBe(false);
  });
});

describe("delete", () => {
  it("deletes a whole lesson (cascade)", async () => {
    const id = await createLesson({ parishId: HOLY_SPIRIT, createdBy: await userId("admin@parvaordo.test"), title: "To Delete" });
    await publishVersion({
      parishId: HOLY_SPIRIT,
      lessonId: id,
      versionId: (await getLessonForEdit(HOLY_SPIRIT, id))!.selected.versionId,
    });
    expect(await getLessonForEdit(HOLY_SPIRIT, id)).not.toBeNull();
    await deleteLesson(HOLY_SPIRIT, id);
    expect(await getLessonForEdit(HOLY_SPIRIT, id)).toBeNull();
  });

  it("discards a draft, but refuses to delete the only version or the live version", async () => {
    const id = await createLesson({ parishId: HOLY_SPIRIT, createdBy: await userId("admin@parvaordo.test"), title: "Del Version" });
    const v1 = (await getLessonForEdit(HOLY_SPIRIT, id))!.selected.versionId;

    // only version -> refuse
    await expect(deleteVersion({ parishId: HOLY_SPIRIT, lessonId: id, versionId: v1 })).rejects.toThrow();

    await publishVersion({ parishId: HOLY_SPIRIT, lessonId: id, versionId: v1 });
    // live version -> refuse
    await expect(deleteVersion({ parishId: HOLY_SPIRIT, lessonId: id, versionId: v1 })).rejects.toThrow();

    // make a draft, then discard it
    const draft = await ensureDraft(HOLY_SPIRIT, id);
    await deleteVersion({ parishId: HOLY_SPIRIT, lessonId: id, versionId: draft });
    expect((await getLessonForEdit(HOLY_SPIRIT, id))!.versions.some((v) => v.id === draft)).toBe(false);

    await deleteLesson(HOLY_SPIRIT, id); // cleanup
  });
});

describe("manage sort + filter", () => {
  it("filters by scope", async () => {
    const parishOnly = await getManageLessons(HOLY_SPIRIT, { scope: "parish" });
    expect(parishOnly.length).toBeGreaterThan(0);
    expect(parishOnly.every((l) => l.scope === "parish")).toBe(true);
  });

  it("filters by status", async () => {
    const published = await getManageLessons(HOLY_SPIRIT, { status: "published" });
    expect(published.every((l) => l.status === "published")).toBe(true);
  });

  it("sorts by title", async () => {
    const titles = (await getManageLessons(HOLY_SPIRIT, { sort: "title" })).map((l) => l.title);
    expect(titles).toEqual([...titles].sort((a, b) => a.localeCompare(b)));
  });

  it("sorts by recent (timestamps are ISO strings, not Date objects)", async () => {
    const rows = await getManageLessons(HOLY_SPIRIT, { sort: "updated" });
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(typeof r.updatedAt).toBe("string");
    const stamps = rows.map((r) => r.updatedAt);
    expect(stamps).toEqual([...stamps].sort((a, b) => b.localeCompare(a)));
  });
});
