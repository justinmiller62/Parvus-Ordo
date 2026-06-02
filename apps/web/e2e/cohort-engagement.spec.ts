import { expect, test } from "@playwright/test";

// Seeded (seed-e2e.mjs): the E2E cohort + the quiz lesson. No engagement events are stamped
// with this cohort_id, so both engagement pages render their empty state — enough to pin the
// routes, the role gates, the cohort-scoped header, and the back link, without seeding telemetry.
const COHORT = "0e2e0000-0000-0000-0000-0000000000e1";
const LESSON = "0e2e0000-0000-0000-0000-0000000000c2";
const BY_LESSON_URL = `/ocia/cohorts/${COHORT}/lessons/${LESSON}/engagement`;

async function login(page: import("@playwright/test").Page, email: string) {
  await page.goto(`/dev/login?email=${email}`);
}

// ── Cohort-by-lesson engagement route (po-9viy) ──
test("catechist sees the cohort-scoped engagement page (header + cohort name + back link)", async ({ page }) => {
  await login(page, "e2e-catechist@parvaordo.test");
  await page.goto(BY_LESSON_URL);

  await expect(page.getByRole("heading", { name: "Engagement Analytics" })).toBeVisible();
  await expect(page.getByTestId("cohort-engagement-subtitle")).toContainText("E2E OCIA Cohort");
  await expect(page.getByTestId("engagement-empty")).toBeVisible(); // no cohort-stamped events yet

  await page.getByTestId("back-to-cohort").click();
  await expect(page).toHaveURL(new RegExp(`/ocia/cohorts/${COHORT}$`));
});

test("a student is redirected away from the cohort-by-lesson engagement page", async ({ page }) => {
  await login(page, "e2e-student@parvaordo.test");
  await page.goto(BY_LESSON_URL);
  await expect(page).toHaveURL(/\/ocia$/);
  await expect(page.getByRole("heading", { name: "Engagement Analytics" })).toHaveCount(0);
});

// ── Cohort-wide (all-lessons) engagement route (po-3x5e) ──
test("staff can open the cohort-wide engagement page", async ({ page }) => {
  await login(page, "e2e-admin@parvaordo.test");
  await page.goto(`/ocia/cohorts/${COHORT}/engagement`);
  await expect(page.getByRole("heading", { name: "Cohort Engagement" })).toBeVisible();
  await expect(page.getByTestId("cohort-engagement-empty")).toBeVisible(); // no events seeded
});

test("a student cannot reach the cohort-wide engagement page (role-gated, redirected to /ocia)", async ({ page }) => {
  await login(page, "e2e-student@parvaordo.test");
  await page.goto(`/ocia/cohorts/${COHORT}/engagement`);
  await expect(page).toHaveURL(/\/ocia$/);
  await expect(page.getByRole("heading", { name: "Cohort Engagement" })).toHaveCount(0);
});
