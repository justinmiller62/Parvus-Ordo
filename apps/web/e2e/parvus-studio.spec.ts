import { expect, test } from "@playwright/test";

// Parvus Studio runs inside the dedicated E2E Test Parish (seeded by global-setup).
// Two surfaces are exercised: the MCP route (Claude Desktop's door — token-auth, not
// WorkOS) over HTTP, and the teen's project page (Start AI session → live script poll
// → mark ready). The /api/v1 REST endpoints authenticate via a WorkOS Bearer JWT that
// e2e can't mint; their logic lives in packages/core and is covered by the int suite.
const E2E_PARISH = "0e2e0000-0000-0000-0000-0000000000a1";
const E2E_YOUTH_PROJECT = "0e2e0000-0000-0000-0000-0000000000d2";
const E2E_MCP_TOKEN = "mcp_e2e_youth_token";

const rpc = (method: string, params?: unknown) => ({ jsonrpc: "2.0", id: 1, method, params });

test("MCP route: initialize advertises the parvus-studio server", async ({ request }) => {
  const res = await request.post("/api/mcp/studio", { data: rpc("initialize", { protocolVersion: "2024-11-05" }) });
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  expect(body.result.serverInfo.name).toBe("parvus-studio");
});

test("MCP route: tools/list is rejected without a valid token", async ({ request }) => {
  const res = await request.post("/api/mcp/studio", { data: rpc("tools/list") });
  expect(res.status()).toBe(401);
  const body = await res.json();
  expect(body.error.code).toBe(-32001);
});

test("MCP route: tools/list returns the project tools (incl. upload_slide) with a token", async ({ request }) => {
  const res = await request.post(`/api/mcp/studio?token=${E2E_MCP_TOKEN}`, { data: rpc("tools/list") });
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  const names = body.result.tools.map((t: { name: string }) => t.name);
  expect(names).toEqual([
    "list_my_projects",
    "get_project_details",
    "update_script_draft",
    "save_corpus_passage",
    "upload_slide",
  ]);
});

test("MCP route: update_script_draft writes the draft + returns counts", async ({ request }) => {
  const res = await request.post(`/api/mcp/studio?token=${E2E_MCP_TOKEN}`, {
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

test("studio lands on Parvus Studio home and can open a project", async ({ page }) => {
  // /dev/login redirects to "/", which for a teen redirects on to /parvus-studio.
  await page.goto("/dev/login?email=e2e-teen@parvaordo.test");
  await page.waitForURL(/\/parvus-studio$/);
  await expect(page.getByRole("heading", { name: "My projects" })).toBeVisible();

  await page.getByTestId(`yt-project-${E2E_YOUTH_PROJECT}`).click();
  await page.waitForURL(new RegExp(`parvus-studio/projects/${E2E_YOUTH_PROJECT}$`));
  await expect(page.getByTestId("yt-status")).toBeVisible();
});

test("People console: admin sees members + invite form with Studio as an invitable role", async ({ page }) => {
  await page.goto("/dev/login?email=e2e-admin@parvaordo.test");
  await page.goto("/people");
  await expect(page.getByRole("heading", { name: "People" })).toBeVisible();
  // Members list includes the seeded parish people.
  await expect(page.getByTestId("people-list")).toContainText("E2E Teen");
  await expect(page.getByTestId("people-list")).toContainText("E2E Catechist");
  // Invite-by-email form is here, and offers the studio role.
  await expect(page.getByTestId("invite-form")).toBeVisible();
  await expect(page.locator('[data-testid="invite-role"] option[value="studio"]')).toHaveCount(1);
  // A non-self member has a role selector.
  await expect(page.getByTestId("role-select-e2e-teen@parvaordo.test")).toBeVisible();
});

test("admin assigns a new project to a creator, then deletes it", async ({ page }) => {
  await page.goto("/dev/login?email=e2e-admin@parvaordo.test");
  await page.goto("/parvus-studio");
  await expect(page.getByRole("heading", { name: "Manage projects" })).toBeVisible();
  // The seeded project shows in the parish-wide list.
  await expect(page.getByTestId("yt-manage-list")).toContainText("Real Presence");

  // Assign a new project to the creator.
  await page.getByTestId("yt-teen-select").selectOption({ label: "E2E Teen" });
  await page.getByTestId("yt-title-input").fill("E2E assigned project");
  await page.getByTestId("yt-create-submit").click();
  const row = page.getByTestId("yt-manage-list").locator("li", { hasText: "E2E assigned project" });
  await expect(row).toBeVisible();

  // Delete it (self-cleans, so re-runs across viewports stay idempotent).
  await row.getByRole("button", { name: "Delete" }).click();
  await expect(page.getByTestId("yt-manage-list")).not.toContainText("E2E assigned project");
});

test("teen drafts a script with AI (via MCP) then marks it ready to record", async ({ page, request }) => {
  // Re-runnable across viewports: reset the project to a pristine drafting state.
  await request.get(`/dev/studio-reset?project=${E2E_YOUTH_PROJECT}&parish=${E2E_PARISH}`);

  await page.goto("/dev/login?email=e2e-teen@parvaordo.test");
  await page.goto(`/parvus-studio/projects/${E2E_YOUTH_PROJECT}`);

  await expect(page.getByRole("heading", { name: /Real Presence/ })).toBeVisible();
  await expect(page.getByText(/just a symbol/i)).toBeVisible(); // common misconception
  await expect(page.getByTestId("yt-status")).toHaveText("Drafting");

  // Start AI session → an MCP token is displayed to paste into Claude Desktop.
  await page.getByTestId("yt-start-session").click();
  await expect(page.getByTestId("yt-token")).toContainText("mcp_");

  // Claude writes the script via the MCP endpoint; the page's 3s poll picks it up live.
  const draft = "Hi, I'm Sarah, and the Eucharist is truly the Body and Blood of Christ.";
  await request.post(`/api/mcp/studio?token=${E2E_MCP_TOKEN}`, {
    data: rpc("tools/call", {
      name: "update_script_draft",
      arguments: { project_id: E2E_YOUTH_PROJECT, new_text: draft },
    }),
  });
  await expect(page.getByTestId("yt-script")).toHaveValue(draft, { timeout: 8000 });

  // Mark ready to record → status flips (poll-driven).
  await page.getByTestId("yt-mark-ready").click();
  await expect(page.getByTestId("yt-status")).toHaveText("Ready to record", { timeout: 8000 });
});
