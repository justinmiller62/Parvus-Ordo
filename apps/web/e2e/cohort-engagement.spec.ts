import { expect, test } from "@playwright/test";

// Seeded (seed-e2e.mjs): the E2E cohort + the quiz lesson. No engagement events are stamped
// with this cohort_id, so the page shows the empty state — enough to pin the route, the
// role gate, the cohort-scoped header, and the back link.
const COHORT = "0e2e0000-0000-0000-0000-0000000000e1";
const LESSON = "0e2e0000-0000-0000-0000-0000000000c2";
const URL = `/ocia/cohorts/${COHORT}/lessons/${LESSON}/engagement`;

test("catechist sees the cohort-scoped engagement page (header + cohort name + back link)", async ({ page }) => {
  await page.goto("/dev/login?email=e2e-catechist@parvaordo.test");
  await page.goto(URL);

  await expect(page.getByRole("heading", { name: "Engagement Analytics" })).toBeVisible();
  await expect(page.getByTestId("cohort-engagement-subtitle")).toContainText("E2E OCIA Cohort");
  await expect(page.getByTestId("engagement-empty")).toBeVisible(); // no cohort-stamped events yet

  await page.getByTestId("back-to-cohort").click();
  await expect(page).toHaveURL(new RegExp(`/ocia/cohorts/${COHORT}$`));
});

test("a student is redirected away from the cohort engagement page", async ({ page }) => {
  await page.goto("/dev/login?email=e2e-student@parvaordo.test");
  await page.goto(URL);
  await expect(page).toHaveURL(/\/ocia$/);
  await expect(page.getByRole("heading", { name: "Engagement Analytics" })).toHaveCount(0);
});
