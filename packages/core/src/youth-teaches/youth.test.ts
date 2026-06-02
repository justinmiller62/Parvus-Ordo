import { afterEach, describe, expect, it, vi } from "vitest";
import { canTransitionProject, scriptStats } from "./projects";
import { YOUTH_MCP_TOOLS, validateMcpToken, type McpSession } from "./mcp";
import { uploadRecordingToBunny } from "./recordings";
import { presignSlideUrl, putSlide } from "./r2";

describe("scriptStats", () => {
  it("counts words and estimates ~150 wpm", () => {
    expect(scriptStats("")).toEqual({ words: 0, seconds: 0 });
    expect(scriptStats("   ")).toEqual({ words: 0, seconds: 0 });
    expect(scriptStats("hello world")).toEqual({ words: 2, seconds: 1 });
    // 150 words → 60s
    const text = Array.from({ length: 150 }, () => "word").join(" ");
    expect(scriptStats(text)).toEqual({ words: 150, seconds: 60 });
    // 300 words → 120s (a ~2 minute script)
    const text2 = Array.from({ length: 300 }, () => "word").join(" ");
    expect(scriptStats(text2)).toEqual({ words: 300, seconds: 120 });
  });

  it("collapses irregular whitespace", () => {
    expect(scriptStats("a\n\nb   c\td").words).toBe(4);
  });
});

describe("canTransitionProject (lifecycle guard)", () => {
  it("allows the forward lifecycle edges", () => {
    expect(canTransitionProject("drafting", "ready_to_record")).toBe(true);
    expect(canTransitionProject("ready_to_record", "submitted")).toBe(true);
    expect(canTransitionProject("submitted", "approved")).toBe(true);
    expect(canTransitionProject("submitted", "rejected")).toBe(true);
  });

  it("allows reopening a submitted/approved/rejected project for re-recording", () => {
    expect(canTransitionProject("submitted", "ready_to_record")).toBe(true);
    expect(canTransitionProject("approved", "ready_to_record")).toBe(true);
    expect(canTransitionProject("rejected", "ready_to_record")).toBe(true);
  });

  it("rejects illegal jumps", () => {
    expect(canTransitionProject("drafting", "submitted")).toBe(false);
    expect(canTransitionProject("drafting", "approved")).toBe(false);
    expect(canTransitionProject("ready_to_record", "approved")).toBe(false);
    expect(canTransitionProject("approved", "submitted")).toBe(false);
    expect(canTransitionProject("rejected", "approved")).toBe(false);
    expect(canTransitionProject("approved", "rejected")).toBe(false);
  });

  it("does not treat a same-state edge as a forward transition (transitionProject handles it as a no-op)", () => {
    expect(canTransitionProject("drafting", "drafting")).toBe(false);
    expect(canTransitionProject("submitted", "submitted")).toBe(false);
  });
});

describe("YOUTH_MCP_TOOLS", () => {
  it("exposes the project tools (no corpus tools — those come from the corpus server)", () => {
    const names = YOUTH_MCP_TOOLS.map((t) => t.name);
    expect(names).toEqual([
      "list_my_projects",
      "get_project_details",
      "update_script_draft",
      "save_corpus_passage",
      "upload_slide",
    ]);
    expect(names).not.toContain("corpus_search");
    expect(names).not.toContain("corpus_read");
  });

  it("every tool has a name, description, and object inputSchema", () => {
    for (const t of YOUTH_MCP_TOOLS) {
      expect(typeof t.name).toBe("string");
      expect(t.description.length).toBeGreaterThan(0);
      expect(t.inputSchema.type).toBe("object");
    }
  });

  it("tools that act on a project require project_id", () => {
    for (const name of ["get_project_details", "update_script_draft", "save_corpus_passage"]) {
      const tool = YOUTH_MCP_TOOLS.find((t) => t.name === name)!;
      expect((tool.inputSchema as { required?: string[] }).required).toContain("project_id");
    }
  });
});

describe("validateMcpToken in-process cache", () => {
  // Each case uses a distinct token so the process-global cache can't cross-pollinate.
  const SESSION: McpSession = { parishId: "p-1", teenUserId: "t-1" };

  it("validates once per token within the TTL, then serves from cache (DB out of the hot path)", async () => {
    let calls = 0;
    const load = async (_t: string): Promise<McpSession | null> => ((calls += 1), SESSION);
    const clock = () => 1_000_000;

    expect(await validateMcpToken("mcp_hit", load, clock)).toEqual(SESSION);
    expect(await validateMcpToken("mcp_hit", load, clock)).toEqual(SESSION);
    expect(await validateMcpToken("mcp_hit", load, clock)).toEqual(SESSION);
    expect(calls).toBe(1); // burst of tool calls → one validation
  });

  it("re-validates once the TTL has elapsed", async () => {
    let calls = 0;
    const load = async (_t: string): Promise<McpSession | null> => ((calls += 1), SESSION);
    let nowMs = 2_000_000;
    const clock = () => nowMs;

    expect(await validateMcpToken("mcp_ttl", load, clock)).toEqual(SESSION);
    expect(calls).toBe(1);
    nowMs += 60_001; // just past the 60s TTL
    expect(await validateMcpToken("mcp_ttl", load, clock)).toEqual(SESSION);
    expect(calls).toBe(2);
  });

  it("never caches an invalid token, so a flood of bad tokens can't bloat the cache", async () => {
    let calls = 0;
    const load = async (_t: string): Promise<McpSession | null> => ((calls += 1), null);
    const clock = () => 3_000_000;

    expect(await validateMcpToken("mcp_bad", load, clock)).toBeNull();
    expect(await validateMcpToken("mcp_bad", load, clock)).toBeNull();
    expect(calls).toBe(2); // re-checked every time; nothing stored
  });

  it("keys strictly by token — one token's session is never served for another", async () => {
    const byToken: Record<string, McpSession> = {
      mcp_parishA: { parishId: "A", teenUserId: "ta" },
      mcp_parishB: { parishId: "B", teenUserId: "tb" },
    };
    const load = async (t: string): Promise<McpSession | null> => byToken[t] ?? null;
    const clock = () => 4_000_000;

    expect(await validateMcpToken("mcp_parishA", load, clock)).toEqual(byToken.mcp_parishA);
    expect(await validateMcpToken("mcp_parishB", load, clock)).toEqual(byToken.mcp_parishB);
    // Both now cached; each token still resolves to its own session (no cross-tenant bleed).
    expect(await validateMcpToken("mcp_parishA", load, clock)).toEqual(byToken.mcp_parishA);
    expect(await validateMcpToken("mcp_parishB", load, clock)).toEqual(byToken.mcp_parishB);
  });

  it("returns null for an empty token without consulting the validator", async () => {
    let calls = 0;
    const load = async (_t: string): Promise<McpSession | null> => ((calls += 1), SESSION);
    expect(await validateMcpToken("", load, () => 5_000_000)).toBeNull();
    expect(calls).toBe(0);
  });
});

describe("external-provider behavior when unconfigured", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("uploadRecordingToBunny uses the shared stub provider under MEDIA_STUB (no separate Bunny client)", async () => {
    // Routing recordings through the media StorageProvider means Studio runs on the
    // local stub path instead of throwing — the duplicate Bunny client it replaces
    // had no stub support at all.
    vi.stubEnv("MEDIA_STUB", "1");
    const r = await uploadRecordingToBunny(new Uint8Array([1, 2, 3]), "Recording");
    expect(r.videoId).toMatch(/^stub-/);
    expect(r.playbackUrl).toBeTruthy();
  });

  it("presignSlideUrl / putSlide throw when R2 env is missing", async () => {
    for (const k of ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_SLIDES_BUCKET"]) {
      vi.stubEnv(k, "");
    }
    await expect(presignSlideUrl("k")).rejects.toThrow(/R2 is not configured/);
    await expect(putSlide("k", new Uint8Array(), "image/png")).rejects.toThrow(/R2 is not configured/);
  });
});
