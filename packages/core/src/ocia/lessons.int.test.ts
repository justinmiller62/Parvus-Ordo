import "dotenv/config";
import { afterAll, describe, expect, it } from "vitest";
import { closeDb, getLessonDetail, getLessons } from "@parvaordo/core";

const HOLY_SPIRIT = "11111111-1111-1111-1111-111111111111"; // diocese AJ
const ST_MONICA = "22222222-2222-2222-2222-222222222222"; // diocese AJ
const ST_PETER = "33333333-3333-3333-3333-333333333333"; // diocese Erie

const GLOBAL_LESSON = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const DIOCESE_LESSON_AJ = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const HS_LESSON = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const SM_LESSON = "dddddddd-dddd-dddd-dddd-dddddddddddd";

afterAll(async () => {
  await closeDb();
});

describe("three-tier content visibility (integration)", () => {
  it("Holy Spirit sees global + its diocese + its own parish content, not other parishes'", async () => {
    const ids = (await getLessons(HOLY_SPIRIT)).map((l) => l.id);
    expect(ids).toContain(GLOBAL_LESSON);
    expect(ids).toContain(DIOCESE_LESSON_AJ);
    expect(ids).toContain(HS_LESSON);
    expect(ids).not.toContain(SM_LESSON);
  });

  it("St. Monica sees global + diocese + its own, not Holy Spirit's parish content", async () => {
    const ids = (await getLessons(ST_MONICA)).map((l) => l.id);
    expect(ids).toContain(GLOBAL_LESSON);
    expect(ids).toContain(DIOCESE_LESSON_AJ);
    expect(ids).toContain(SM_LESSON);
    expect(ids).not.toContain(HS_LESSON);
  });

  it("a parish in another diocese sees global only — not AJ's diocese or parish content", async () => {
    const ids = (await getLessons(ST_PETER)).map((l) => l.id);
    expect(ids).toContain(GLOBAL_LESSON);
    expect(ids).not.toContain(DIOCESE_LESSON_AJ);
    expect(ids).not.toContain(HS_LESSON);
    expect(ids).not.toContain(SM_LESSON);
  });

  it("getLessonDetail returns ordered items for a visible lesson", async () => {
    const lesson = await getLessonDetail(HOLY_SPIRIT, GLOBAL_LESSON);
    expect(lesson?.items).toHaveLength(3);
    expect(lesson?.items[0]?.kind).toBe("reading");
    expect(lesson?.items[1]?.kind).toBe("question");
    expect(lesson?.items[2]?.kind).toBe("question");
  });

  it("getLessonDetail hides another parish's lesson (RLS returns null)", async () => {
    expect(await getLessonDetail(ST_PETER, HS_LESSON)).toBeNull();
  });
});
