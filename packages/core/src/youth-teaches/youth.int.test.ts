import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  callYouthTool,
  closeDb,
  createRecording,
  createYouthProject,
  createYouthTopic,
  deleteProjectSlide,
  deleteRecordings,
  deleteYouthProject,
  getDb,
  listProjectSlides,
  getLatestRecording,
  getProject,
  getProjectDetails,
  getProjectOwnerId,
  listMyProjects,
  listParishYouthProjects,
  listYouthTeens,
  listYouthTopics,
  mintMcpToken,
  reorderProjectSlides,
  saveCorpusPassage,
  approveProject,
  InvalidProjectTransition,
  markProjectReady,
  reopenProject,
  resetProjectToDrafting,
  submitProject,
  transitionProject,
  updateScriptDraft,
  validateMcpToken,
} from "@parvaordo/core";

const HS = "11111111-1111-1111-1111-111111111111"; // Holy Spirit — this teen's parish
const ST_PETER = "33333333-3333-3333-3333-333333333333"; // a different parish — for RLS isolation
const EMAIL = "youth-int@inttest.local";
let teenId: string;
let topicId: string;
let projectId: string;

beforeAll(async () => {
  const u = await getDb(null).query<{ id: string }>(
    "INSERT INTO users (email, display_name) VALUES ($1, 'Youth Int') ON CONFLICT (email) DO UPDATE SET display_name = 'Youth Int' RETURNING id",
    [EMAIL],
  );
  teenId = u.rows[0]!.id;
  await getDb(HS).query("DELETE FROM memberships WHERE user_id = $1 AND parish_id = $2", [teenId, HS]);
  await getDb(HS).query("INSERT INTO memberships (user_id, parish_id, role) VALUES ($1, $2, 'studio')", [teenId, HS]);
  const t = await getDb(HS).query<{ id: string }>(
    "INSERT INTO youth_topics (parish_id, category, title, common_misconception, correct_teaching, age_band) VALUES ($1,'Sacraments','Real Presence (int)','symbol only','Real Presence','high_school') RETURNING id",
    [HS],
  );
  topicId = t.rows[0]!.id;
  const p = await getDb(HS).query<{ id: string }>(
    "INSERT INTO youth_projects (parish_id, teen_user_id, topic_id, title) VALUES ($1,$2,$3,'Real Presence (int)') RETURNING id",
    [HS, teenId, topicId],
  );
  projectId = p.rows[0]!.id;
});

afterAll(async () => {
  await getDb(HS).query("DELETE FROM youth_recordings WHERE project_id = $1", [projectId]);
  await getDb(HS).query("DELETE FROM youth_mcp_audit_log WHERE project_id = $1", [projectId]);
  await getDb(HS).query("DELETE FROM youth_mcp_tokens WHERE teen_user_id = $1", [teenId]);
  await getDb(HS).query("DELETE FROM youth_projects WHERE id = $1", [projectId]);
  await getDb(HS).query("DELETE FROM youth_topics WHERE id = $1", [topicId]);
  await getDb(null).query("DELETE FROM users WHERE email = $1", [EMAIL]); // cascades membership
  await closeDb();
});

describe("youth-teaches (integration)", () => {
  it("lists the teen's projects", async () => {
    const list = await listMyProjects(HS, teenId);
    expect(list.find((p) => p.id === projectId)?.title).toContain("Real Presence");
  });

  it("returns project details joined with the topic", async () => {
    const d = await getProjectDetails(HS, projectId);
    expect(d?.common_misconception).toBe("symbol only");
    expect(d?.age_band).toBe("high_school");
  });

  it("updates the script draft + reports word/second counts", async () => {
    const r = await updateScriptDraft(HS, projectId, "one two three four five");
    expect(r.ok).toBe(true);
    expect(r.new_word_count).toBe(5);
    expect(r.new_estimated_seconds).toBe(2);
    const d = await getProjectDetails(HS, projectId);
    expect(d?.current_script_text).toBe("one two three four five");
  });

  it("appends a saved corpus passage", async () => {
    await saveCorpusPassage(HS, projectId, "CCC 1374", "key paragraph");
    const { rows } = await getDb(HS).query<{ saved_passages: unknown }>(
      "SELECT saved_passages FROM youth_projects WHERE id = $1",
      [projectId],
    );
    expect(JSON.stringify(rows[0]!.saved_passages)).toContain("CCC 1374");
  });

  it("mints + validates an MCP token (and rejects an unknown one)", async () => {
    const { token, expiresAt } = await mintMcpToken(HS, teenId);
    expect(new Date(expiresAt).getTime()).toBeGreaterThan(Date.now()); // a fresh token's TTL is in the future
    expect(await validateMcpToken(token)).toEqual({ parishId: HS, teenUserId: teenId });
    expect(await validateMcpToken("mcp_does_not_exist")).toBeNull();
  });

  it("rejects an MCP token once it has expired (the TTL boundary, not just unknown tokens)", async () => {
    const { token } = await mintMcpToken(HS, teenId);
    // Push it past its TTL using the same clock (DB now()) the validator compares against,
    // so the assertion can't flake on client/server clock skew.
    await getDb(HS).query("UPDATE youth_mcp_tokens SET expires_at = now() - interval '1 minute' WHERE token = $1", [
      token,
    ]);
    expect(await validateMcpToken(token)).toBeNull();
  });

  it("callYouthTool dispatches tools + writes a tenant-scoped, parish-isolated audit log", async () => {
    const session = { parishId: HS, teenUserId: teenId };
    const res = (await callYouthTool(session, "list_my_projects", {})) as { projects: unknown[] };
    expect(res.projects.length).toBeGreaterThan(0);
    await callYouthTool(session, "get_project_details", { project_id: projectId });

    // The audit log's worth is its integrity: WHICH parish and WHICH project each AI
    // tool call touched. Assert the recorded tenancy, not merely that a row exists.
    const { rows } = await getDb(HS).query<{ parish_id: string; project_id: string | null; tool_name: string }>(
      "SELECT parish_id, project_id, tool_name FROM youth_mcp_audit_log WHERE parish_id = $1",
      [HS],
    );

    // list_my_projects is teen-scoped, not project-scoped → it logs parish + NULL project.
    const listed = rows.filter((r) => r.tool_name === "list_my_projects");
    expect(listed.length).toBeGreaterThan(0);
    expect(listed.every((r) => r.parish_id === HS && r.project_id === null)).toBe(true);

    // get_project_details records the exact project the AI read, under this parish.
    const detailed = rows.filter((r) => r.tool_name === "get_project_details");
    expect(detailed.some((r) => r.parish_id === HS && r.project_id === projectId)).toBe(true);

    // Parish isolation: St. Peter, querying Holy Spirit's own project id, sees none of
    // its audit trail — RLS scopes every read to app.parish_id. The same rows are
    // visible to their owner above, so this is isolation, not just an empty table.
    const { rows: leaked } = await getDb(ST_PETER).query("SELECT id FROM youth_mcp_audit_log WHERE project_id = $1", [
      projectId,
    ]);
    expect(leaked).toHaveLength(0);
  });

  it("getProject returns the saved draft, status, and passages", async () => {
    await updateScriptDraft(HS, projectId, "Hello Real Presence draft.");
    const p = await getProject(HS, projectId);
    expect(p).not.toBeNull();
    expect(p!.id).toBe(projectId);
    expect(p!.scriptDraft.full_text).toBe("Hello Real Presence draft.");
    expect(Array.isArray(p!.savedPassages)).toBe(true);
  });

  it("project lifecycle: enforces legal transitions and rejects illegal jumps", async () => {
    await resetProjectToDrafting(HS, projectId); // known start, independent of prior tests
    await markProjectReady(HS, projectId); // drafting → ready_to_record
    expect((await getProject(HS, projectId))!.status).toBe("ready_to_record");
    await submitProject(HS, projectId); // ready_to_record → submitted
    expect((await getProject(HS, projectId))!.status).toBe("submitted");
    await approveProject(HS, projectId); // submitted → approved
    expect((await getProject(HS, projectId))!.status).toBe("approved");

    // Illegal: an approved project cannot be re-submitted — guard throws, status unchanged.
    await expect(submitProject(HS, projectId)).rejects.toThrow(InvalidProjectTransition);
    expect((await getProject(HS, projectId))!.status).toBe("approved");

    await reopenProject(HS, projectId); // approved → ready_to_record (replace the recording)
    expect((await getProject(HS, projectId))!.status).toBe("ready_to_record");
  });

  it("callYouthTool rejects an unknown tool", async () => {
    const session = { parishId: HS, teenUserId: teenId };
    await expect(callYouthTool(session, "nope", {})).rejects.toThrow(/unknown tool/);
  });

  it("getProjectDetails / getProject return null for a project that doesn't exist", async () => {
    const missing = "00000000-0000-0000-0000-0000000000ff";
    expect(await getProjectDetails(HS, missing)).toBeNull();
    expect(await getProject(HS, missing)).toBeNull();
  });

  it("staff: lists assignable teens and the topic library", async () => {
    const teens = await listYouthTeens(HS);
    expect(teens.find((t) => t.userId === teenId)?.displayName).toBe("Youth Int");
    const topics = await listYouthTopics(HS);
    expect(topics.find((t) => t.id === topicId)).toBeTruthy();
  });

  it("staff: creates a topic + assigns a project, then sees it in the parish list", async () => {
    const topic = await createYouthTopic(HS, {
      category: "Sacraments",
      title: "Baptism (int)",
      commonMisconception: "just a symbol",
      correctTeaching: "regeneration",
      ageBand: "high_school",
    });
    const proj = await createYouthProject(HS, {
      teenUserId: teenId,
      title: "Baptism project (int)",
      topicId: topic.id,
    });
    const all = await listParishYouthProjects(HS);
    const row = all.find((p) => p.id === proj.id);
    expect(row?.teenName).toBe("Youth Int");
    expect(row?.topicTitle).toBe("Baptism (int)");
    // deleteYouthProject also serves as cleanup (afterAll only knows the fixed fixtures).
    await deleteYouthProject(HS, proj.id);
    expect((await listParishYouthProjects(HS)).find((p) => p.id === proj.id)).toBeUndefined();
    await getDb(HS).query("DELETE FROM youth_topics WHERE id = $1", [topic.id]);
  });

  it("lists, reorders, and deletes project slides", async () => {
    for (const n of [1, 2, 3]) {
      await getDb(HS).query(
        "INSERT INTO youth_slides (parish_id, project_id, slide_order, r2_key) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING",
        [HS, projectId, n, `studio-slides/${projectId}/s${n}.png`],
      );
    }
    let slides = await listProjectSlides(HS, projectId);
    expect(slides.map((s) => s.order)).toEqual([1, 2, 3]);

    // Reverse the order; reorder renumbers to 1..N in the given sequence.
    const reversed = [...slides].reverse().map((s) => s.id);
    await reorderProjectSlides(HS, projectId, reversed);
    slides = await listProjectSlides(HS, projectId);
    expect(slides.map((s) => s.id)).toEqual(reversed);
    expect(slides.map((s) => s.order)).toEqual([1, 2, 3]);

    await deleteProjectSlide(HS, projectId, slides[0]!.id);
    slides = await listProjectSlides(HS, projectId);
    expect(slides.length).toBe(2);
    // clean up the rest
    for (const s of slides) await deleteProjectSlide(HS, projectId, s.id);
  });

  it("createRecording flips the project to submitted + getLatestRecording returns it", async () => {
    await transitionProject(HS, projectId, "ready_to_record"); // createRecording submits, which requires ready_to_record
    const rec = await createRecording(HS, {
      projectId,
      teenUserId: teenId,
      bunnyVideoId: "guid-int",
      playbackUrl: "https://iframe.mediadelivery.net/embed/672172/guid-int",
      durationSeconds: 100,
      slideAdvanceCount: 3,
    });
    expect(rec).not.toBeNull();
    expect(rec!.projectStatus).toBe("submitted");
    const latest = await getLatestRecording(HS, projectId);
    expect(latest?.bunnyVideoId).toBe("guid-int");
    const status = await getDb(HS).query<{ status: string }>("SELECT status FROM youth_projects WHERE id = $1", [
      projectId,
    ]);
    expect(status.rows[0]!.status).toBe("submitted");
  });

  it("deleteRecordings removes the recording so it can be re-recorded", async () => {
    await deleteRecordings(HS, projectId);
    expect(await getLatestRecording(HS, projectId)).toBeNull();
  });

  // Multi-tenant isolation invariant (Architecture §multi-tenant): a parish must read
  // NONE of another's youth data. The youth module carries its own RLS policies and a
  // SECURITY DEFINER token function, so — like assets/lessons/feedback/progress — it
  // gets an explicit cross-parish denial test across every read path.
  it("RLS denies a second parish any read of this parish's project, recording, and slides", async () => {
    // Seed a recording + a slide under Holy Spirit so each assertion proves ISOLATION
    // (the owner can still see the row) rather than reading a coincidentally empty table.
    await createRecording(HS, {
      projectId,
      teenUserId: teenId,
      bunnyVideoId: "guid-rls",
      playbackUrl: "https://iframe.mediadelivery.net/embed/672172/guid-rls",
      durationSeconds: 42,
      slideAdvanceCount: 1,
    });
    await getDb(HS).query(
      "INSERT INTO youth_slides (parish_id, project_id, slide_order, r2_key) VALUES ($1,$2,1,$3) ON CONFLICT DO NOTHING",
      [HS, projectId, `studio-slides/${projectId}/rls.png`],
    );

    // Owner (Holy Spirit) sees its own data…
    expect(await getProject(HS, projectId)).not.toBeNull();
    expect(await getLatestRecording(HS, projectId)).not.toBeNull();
    expect((await listMyProjects(HS, teenId)).some((p) => p.id === projectId)).toBe(true);
    expect((await listParishYouthProjects(HS)).some((p) => p.id === projectId)).toBe(true);
    expect(await listProjectSlides(HS, projectId)).not.toHaveLength(0);

    // …St. Peter, querying the very same ids, sees none of it. RLS scopes every read to
    // app.parish_id, so these are real denials, not a coincidentally empty database.
    expect(await getProject(ST_PETER, projectId)).toBeNull();
    expect(await getProjectDetails(ST_PETER, projectId)).toBeNull();
    expect(await getLatestRecording(ST_PETER, projectId)).toBeNull();
    expect((await listMyProjects(ST_PETER, teenId)).some((p) => p.id === projectId)).toBe(false);
    expect((await listParishYouthProjects(ST_PETER)).some((p) => p.id === projectId)).toBe(false);
    expect(await listProjectSlides(ST_PETER, projectId)).toHaveLength(0);

    // Clean up the rows seeded here (afterAll only knows the fixed fixtures).
    await deleteRecordings(HS, projectId);
    for (const s of await listProjectSlides(HS, projectId)) await deleteProjectSlide(HS, projectId, s.id);
  });

  it("getProjectOwnerId returns the owner, null for missing, and is parish-isolated", async () => {
    expect(await getProjectOwnerId(HS, projectId)).toBe(teenId);
    expect(await getProjectOwnerId(HS, "00000000-0000-0000-0000-0000000000ff")).toBeNull();
    // RLS: another parish cannot resolve this project's owner at all (po-7ge).
    expect(await getProjectOwnerId(ST_PETER, projectId)).toBeNull();
  });

  it("createRecording refuses a project the caller does not own — no write, status unchanged (po-7ge)", async () => {
    // A second teen in the SAME parish. RLS is parish-level only, so without a
    // project-ownership check this attacker could overwrite the victim's recording and
    // flip the project to 'submitted'. The guard must block exactly that.
    const a = await getDb(null).query<{ id: string }>(
      "INSERT INTO users (email, display_name) VALUES ($1,'Attacker Int') ON CONFLICT (email) DO UPDATE SET display_name='Attacker Int' RETURNING id",
      ["youth-int-attacker@inttest.local"],
    );
    const attackerId = a.rows[0]!.id;

    // Victim baseline: ready_to_record, no recording.
    await transitionProject(HS, projectId, "ready_to_record");
    await deleteRecordings(HS, projectId);

    const rec = await createRecording(HS, {
      projectId, // owned by teenId, NOT attackerId
      teenUserId: attackerId,
      bunnyVideoId: "guid-attacker",
      playbackUrl: "https://iframe.mediadelivery.net/embed/672172/guid-attacker",
    });

    expect(rec).toBeNull(); // refused
    expect(await getLatestRecording(HS, projectId)).toBeNull(); // nothing written
    const { rows } = await getDb(HS).query<{ status: string }>("SELECT status FROM youth_projects WHERE id = $1", [
      projectId,
    ]);
    expect(rows[0]!.status).toBe("ready_to_record"); // NOT flipped to submitted

    await getDb(null).query("DELETE FROM users WHERE email = $1", ["youth-int-attacker@inttest.local"]);
  });
});
