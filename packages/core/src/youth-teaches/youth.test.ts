import { afterEach, describe, expect, it, vi } from "vitest";
import { scriptStats } from "./projects";
import { YOUTH_MCP_TOOLS } from "./mcp";
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

describe("YOUTH_MCP_TOOLS", () => {
  it("exposes exactly the 4 project tools (no corpus tools)", () => {
    const names = YOUTH_MCP_TOOLS.map((t) => t.name);
    expect(names).toEqual(["list_my_projects", "get_project_details", "update_script_draft", "save_corpus_passage"]);
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

describe("external-provider guards (fail fast when unconfigured)", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("uploadRecordingToBunny throws when Bunny env is missing", async () => {
    vi.stubEnv("BUNNY_STREAM_LIBRARY_ID", "");
    vi.stubEnv("BUNNY_STREAM_LIBRARY_KEY", "");
    await expect(uploadRecordingToBunny(new Uint8Array(), "t")).rejects.toThrow(/Bunny is not configured/);
  });

  it("presignSlideUrl / putSlide throw when R2 env is missing", async () => {
    for (const k of ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_SLIDES_BUCKET"]) {
      vi.stubEnv(k, "");
    }
    await expect(presignSlideUrl("k")).rejects.toThrow(/R2 is not configured/);
    await expect(putSlide("k", new Uint8Array(), "image/png")).rejects.toThrow(/R2 is not configured/);
  });
});
