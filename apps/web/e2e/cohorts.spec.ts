import { expect, test } from "@playwright/test";

// Cohorts + Scheduling runs in the E2E Test Parish (seeded by global-setup), which has
// published lessons (2 parish + 1 global) for the schedule generator to draw on. The
// suite shares one DB across viewport projects, so each created cohort gets a unique
// name to stay order-independent.
const uniq = () => `E2E Cohort ${Date.now()}-${Math.floor(Math.random() * 1e4)}`;

async function login(page: import("@playwright/test").Page, email: string) {
  await page.goto(`/dev/login?email=${email}`);
}

test("an admin creates a cohort and it appears as a card", async ({ page }) => {
  await login(page, "e2e-admin@parvaordo.test");
  await page.goto("/ocia/cohorts");
  await expect(page.getByRole("heading", { name: "Cohorts" })).toBeVisible();

  const name = uniq();
  await page.getByTestId("cohort-name").fill(name);
  await page.getByTestId("cohort-create").click();
  await expect(page.getByText(name)).toBeVisible();
});

test("a catechist can view cohorts but cannot create one", async ({ page }) => {
  await login(page, "e2e-catechist@parvaordo.test");
  await page.goto("/ocia/cohorts");
  await expect(page.getByRole("heading", { name: "Cohorts" })).toBeVisible();
  await expect(page.getByTestId("cohort-create")).toHaveCount(0);
  await expect(page.getByTestId("cohort-name")).toHaveCount(0);
});

test("auto-generate is gated on start date + day, then builds a weekly schedule", async ({ page }) => {
  await login(page, "e2e-admin@parvaordo.test");
  await page.goto("/ocia/cohorts");
  const name = uniq();
  await page.getByTestId("cohort-name").fill(name);
  await page.getByTestId("cohort-create").click();
  await page.getByText(name).click();

  // Detail page → Schedule tab.
  await page.getByTestId("tab-schedule").click();
  // Generate is disabled until both a start date and a discussion day are set.
  await expect(page.getByTestId("schedule-generate")).toBeDisabled();

  await page.getByTestId("settings-start").fill("2026-06-01");
  await page.getByTestId("settings-start").blur();
  await page.getByTestId("settings-day").selectOption("Tuesday");

  await expect(page.getByTestId("schedule-generate")).toBeEnabled();
  await page.getByTestId("schedule-generate").click();

  // The published lessons get paired with weekly Tuesday dates.
  const rows = page.locator('[data-testid^="schedule-row-"]');
  await expect(rows.first()).toBeVisible();
  expect(await rows.count()).toBeGreaterThanOrEqual(1);

  // The Lessons overview tab reflects the generated schedule.
  await page.getByTestId("tab-lessons").click();
  await expect(page.getByTestId("lessons-overview")).toBeVisible();
});

test("an admin enrolls a learner from the roster", async ({ page }) => {
  await login(page, "e2e-admin@parvaordo.test");
  await page.goto("/ocia/cohorts");
  const name = uniq();
  await page.getByTestId("cohort-name").fill(name);
  await page.getByTestId("cohort-create").click();
  await page.getByText(name).click();

  await page.getByTestId("tab-settings").click();
  const toggle = page.getByTestId("roster-toggle-e2e-student@parvaordo.test");
  await expect(toggle).toBeVisible();
  await toggle.check();
  await expect(toggle).toBeChecked();

  // The Students tab now lists the enrolled learner.
  await page.getByTestId("tab-students").click();
  await expect(page.getByTestId("students-list")).toContainText("E2E Student");
});

test("a learning path can be created", async ({ page }) => {
  await login(page, "e2e-admin@parvaordo.test");
  await page.goto("/ocia/cohorts");
  const name = uniq();
  await page.getByTestId("cohort-name").fill(name);
  await page.getByTestId("cohort-create").click();
  await page.getByText(name).click();

  await page.getByTestId("tab-paths").click();
  await page.getByTestId("path-name").fill("Adapted track");
  await page.getByTestId("path-create").click();
  await expect(page.getByTestId("paths-list")).toContainText("Adapted track");
});
