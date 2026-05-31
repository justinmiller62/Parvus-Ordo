import { expect, test } from "@playwright/test";

// The E2E Test Parish has applications_enabled=true and slug "e2e-test", so its
// public /apply is reachable on the e2e-test.localhost subdomain (host → slug →
// parish). Emails use the e2e- prefix so seed-e2e cleans them up, and a per-project
// suffix so the chromium + mobile runs don't collide on the shared parish (dup rows
// / the resubmit throttle).
const PARISH_ORIGIN = "http://e2e-test.localhost:3000";

test("public applicant applies on the parish subdomain, admin converts to student", async ({ page }, testInfo) => {
  const email = `e2e-applicant-${testInfo.project.name}@parvaordo.test`;

  // 1) Unauthenticated application on the parish subdomain.
  await page.goto(`${PARISH_ORIGIN}/apply`);
  await expect(page.getByTestId("apply-name")).toBeVisible();
  await page.getByTestId("apply-name").fill("Prospective Catechumen");
  await page.getByTestId("apply-email").fill(email);

  // Conditional Catholic-sacraments sub-section appears for baptized + "catholic".
  await page.getByTestId("apply-baptized").selectOption("yes");
  await page.locator("#faithTradition").fill("Roman Catholic");
  await expect(page.getByTestId("apply-sacraments")).toBeVisible();

  await page.getByTestId("apply-submit").click();
  await expect(page.getByTestId("apply-received")).toBeVisible();

  // 2) Admin reviews on the apex (e2e-admin is single-parish → active = E2E parish).
  await page.goto("/dev/login?email=e2e-admin@parvaordo.test");
  await page.goto("/ocia/applicants");
  const row = page.locator('[data-testid="applicants-list"] li').filter({ hasText: email });
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "Invite as student" }).click();

  // After conversion the applicant shows the "invited" status.
  await expect(page.locator('[data-testid="applicants-list"] li').filter({ hasText: email })).toContainText("invited");
});

test("admin invites a member directly by email", async ({ page }, testInfo) => {
  await page.goto("/dev/login?email=e2e-admin@parvaordo.test");
  await page.goto("/ocia/applicants");
  await page.getByTestId("invite-email").fill(`e2e-invited-${testInfo.project.name}@parvaordo.test`);
  await page.getByTestId("invite-submit").click();
  await expect(page.getByTestId("invite-success")).toBeVisible();
});

test("the public apply form is closed when applications are disabled", async ({ page }) => {
  // Admin turns applications off, the public form shows the closed card, then back on.
  await page.goto("/dev/login?email=e2e-admin@parvaordo.test");
  await page.goto("/ocia/applicants");
  await page.getByTestId("toggle-applications").click(); // Open → Closed
  await expect(page.getByTestId("toggle-applications")).toContainText("Closed");

  await page.goto(`${PARISH_ORIGIN}/apply`);
  await expect(page.getByTestId("apply-closed")).toBeVisible();

  // Restore so the suite is order-independent across projects / re-runs.
  await page.goto("/ocia/applicants");
  await page.getByTestId("toggle-applications").click(); // Closed → Open
  await expect(page.getByTestId("toggle-applications")).toContainText("Open");
});
