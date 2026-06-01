import { expect, test } from "@playwright/test";

// Youth Teaches runs inside the dedicated E2E Test Parish (seeded by global-setup).
// Two surfaces are exercised: the MCP route (Claude Desktop's door — token-auth, not
// WorkOS) over HTTP, and the teen's project page (Start AI session → live script poll
// → mark ready). The /api/v1 REST endpoints authenticate via a WorkOS Bearer JWT that
// e2e can't mint; their logic lives in packages/core and is covered by the int suite.
const E2E_PARISH = "0e2e0000-0000-0000-0000-0000000000a1";
const E2E_YOUTH_PROJECT = "0e2e0000-0000-0000-0000-0000000000d2";
const E2E_MCP_TOKEN = "mcp_e2e_youth_token";

const rpc = (method: string, params?: unknown) => ({ jsonrpc: "2.0", id: 1, method, params });

test("MCP route: initialize advertises the youth-teaches server", async ({ request }) => {
  const res = await request.post("/api/mcp/youth", { data: rpc("initialize", { protocolVersion: "2024-11-05" }) });
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  expect(body.result.serverInfo.name).toBe("parvus-youth-teaches");
});

test("MCP route: tools/list is rejected without a valid token", async ({ request }) => {
  const res = await request.post("/api/mcp/youth", { data: rpc("tools/list") });
  expect(res.status()).toBe(401);
  const body = await res.json();
  expect(body.error.code).toBe(-32001);
});

test("MCP route: tools/list returns exactly the 4 project tools with a token", async ({ request }) => {
  const res = await request.post(`/api/mcp/youth?token=${E2E_MCP_TOKEN}`, { data: rpc("tools/list") });
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  const names = body.result.tools.map((t: { name: string }) => t.name);
  expect(names).toEqual(["list_my_projects", "get_project_details", "update_script_draft", "save_corpus_passage"]);
});

test("MCP route: update_script_draft writes the draft + returns counts", async ({ request }) => {
  const res = await request.post(`/api/mcp/youth?token=${E2E_MCP_TOKEN}`, {
    data: rpc("tools/call", {
      name: "update_script_draft",
      arguments: { project_id: E2E_YOUTH_PROJECT, new_text: "one two three" },
    }),
  });
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  const payload = JSON.parse(body.result.content[0].text);
  expect(payload.new_word_count).toBe(3);
});

test("youth_teen lands on Youth Teaches home and can open a project", async ({ page }) => {
  // /dev/login redirects to "/", which for a teen redirects on to /youth-teaches.
  await page.goto("/dev/login?email=e2e-teen@parvaordo.test");
  await page.waitForURL(/\/youth-teaches$/);
  await expect(page.getByRole("heading", { name: "My projects" })).toBeVisible();

  await page.getByTestId(`yt-project-${E2E_YOUTH_PROJECT}`).click();
  await page.waitForURL(new RegExp(`youth-teaches/projects/${E2E_YOUTH_PROJECT}$`));
  await expect(page.getByTestId("yt-status")).toBeVisible();
});

test("teen drafts a script with AI (via MCP) then marks it ready to record", async ({ page, request }) => {
  // Re-runnable across viewports: reset the project to a pristine drafting state.
  await request.get(`/dev/youth-reset?project=${E2E_YOUTH_PROJECT}&parish=${E2E_PARISH}`);

  await page.goto("/dev/login?email=e2e-teen@parvaordo.test");
  await page.goto(`/youth-teaches/projects/${E2E_YOUTH_PROJECT}`);

  await expect(page.getByRole("heading", { name: /Real Presence/ })).toBeVisible();
  await expect(page.getByText(/just a symbol/i)).toBeVisible(); // common misconception
  await expect(page.getByTestId("yt-status")).toHaveText("Drafting");

  // Start AI session → an MCP token is displayed to paste into Claude Desktop.
  await page.getByTestId("yt-start-session").click();
  await expect(page.getByTestId("yt-token")).toContainText("mcp_");

  // Claude writes the script via the MCP endpoint; the page's 3s poll picks it up live.
  const draft = "Hi, I'm Sarah, and the Eucharist is truly the Body and Blood of Christ.";
  await request.post(`/api/mcp/youth?token=${E2E_MCP_TOKEN}`, {
    data: rpc("tools/call", { name: "update_script_draft", arguments: { project_id: E2E_YOUTH_PROJECT, new_text: draft } }),
  });
  await expect(page.getByTestId("yt-script")).toHaveValue(draft, { timeout: 8000 });

  // Mark ready to record → status flips (poll-driven).
  await page.getByTestId("yt-mark-ready").click();
  await expect(page.getByTestId("yt-status")).toHaveText("Ready to record", { timeout: 8000 });
});
