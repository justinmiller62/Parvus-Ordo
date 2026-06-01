import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  callYouthTool,
  closeDb,
  createRecording,
  createYouthProject,
  createYouthTopic,
  deleteYouthProject,
  getDb,
  getLatestRecording,
  getProject,
  getProjectDetails,
  listMyProjects,
  listParishYouthProjects,
  listYouthTeens,
  listYouthTopics,
  mintMcpToken,
  saveCorpusPassage,
  setProjectStatus,
  updateScriptDraft,
  validateMcpToken,
} from "@parvaordo/core";

const HS = "11111111-1111-1111-1111-111111111111";
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
    const { rows } = await getDb(HS).query<{ saved_passages: unknown }>("SELECT saved_passages FROM youth_projects WHERE id = $1", [projectId]);
    expect(JSON.stringify(rows[0]!.saved_passages)).toContain("CCC 1374");
  });

  it("mints + validates an MCP token (and rejects an unknown one)", async () => {
    const { token } = await mintMcpToken(HS, teenId);
    expect(await validateMcpToken(token)).toEqual({ parishId: HS, teenUserId: teenId });
    expect(await validateMcpToken("mcp_does_not_exist")).toBeNull();
  });

  it("callYouthTool dispatches tools + writes the audit log", async () => {
    const session = { parishId: HS, teenUserId: teenId };
    const res = (await callYouthTool(session, "list_my_projects", {})) as { projects: unknown[] };
    expect(res.projects.length).toBeGreaterThan(0);
    await callYouthTool(session, "get_project_details", { project_id: projectId });
    const { rows } = await getDb(HS).query<{ tool_name: string }>(
      "SELECT tool_name FROM youth_mcp_audit_log WHERE parish_id = $1",
      [HS],
    );
    const tools = rows.map((r) => r.tool_name);
    expect(tools).toContain("list_my_projects");
    expect(tools).toContain("get_project_details");
  });

  it("getProject returns the saved draft, status, and passages", async () => {
    await updateScriptDraft(HS, projectId, "Hello Real Presence draft.");
    const p = await getProject(HS, projectId);
    expect(p).not.toBeNull();
    expect(p!.id).toBe(projectId);
    expect(p!.scriptDraft.full_text).toBe("Hello Real Presence draft.");
    expect(Array.isArray(p!.savedPassages)).toBe(true);
  });

  it("setProjectStatus flips the status", async () => {
    await setProjectStatus(HS, projectId, "ready_to_record");
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
    const proj = await createYouthProject(HS, { teenUserId: teenId, title: "Baptism project (int)", topicId: topic.id });
    const all = await listParishYouthProjects(HS);
    const row = all.find((p) => p.id === proj.id);
    expect(row?.teenName).toBe("Youth Int");
    expect(row?.topicTitle).toBe("Baptism (int)");
    // deleteYouthProject also serves as cleanup (afterAll only knows the fixed fixtures).
    await deleteYouthProject(HS, proj.id);
    expect((await listParishYouthProjects(HS)).find((p) => p.id === proj.id)).toBeUndefined();
    await getDb(HS).query("DELETE FROM youth_topics WHERE id = $1", [topic.id]);
  });

  it("createRecording flips the project to submitted + getLatestRecording returns it", async () => {
    const rec = await createRecording(HS, {
      projectId,
      bunnyVideoId: "guid-int",
      playbackUrl: "https://iframe.mediadelivery.net/embed/672172/guid-int",
      durationSeconds: 100,
      slideAdvanceCount: 3,
    });
    expect(rec.projectStatus).toBe("submitted");
    const latest = await getLatestRecording(HS, projectId);
    expect(latest?.bunnyVideoId).toBe("guid-int");
    const status = await getDb(HS).query<{ status: string }>("SELECT status FROM youth_projects WHERE id = $1", [projectId]);
    expect(status.rows[0]!.status).toBe("submitted");
  });
});
