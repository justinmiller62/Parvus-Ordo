import { expect, test } from "@playwright/test";

// Seeded by global-setup (seed-e2e.mjs): a cohort with one learning path, the
// student enrolled, the quiz lesson assigned to week 1, with the student's answer
// + a submitted question + feedback.
const E2E_COHORT = "0e2e0000-0000-0000-0000-0000000000e1";
const EXPORT_URL = `/ocia/cohorts/${E2E_COHORT}/week/1/export`;

test("catechist sees the weekly export with lesson material + the student's answer, and copies it", async ({ page }) => {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/dev/login?email=e2e-catechist@parvaordo.test");
  await page.goto(EXPORT_URL);

  const header = page.getByTestId("weekly-export-header");
  await expect(header).toContainText("Week 1 Discussion");
  await expect(header).toContainText("E2E OCIA Cohort");

  // Single-path cohort → exactly one card and no "## Path:" heading in the export.
  const cards = page.getByTestId("export-path-card");
  await expect(cards).toHaveCount(1);
  await expect(cards.first()).toContainText("E2E: Who Do You Say That I Am");

  const preview = page.getByTestId("export-preview");
  await expect(preview).toContainText("# Week 1 Discussion — E2E OCIA Cohort");
  await expect(preview).toContainText("Who do you say that Jesus is?"); // a lesson question
  await expect(preview).toContainText("I say Jesus is the Son of the living God."); // the student's answer
  await expect(preview).toContainText("*No answers submitted.*"); // the unanswered MC question
  await expect(preview).toContainText("How can I be sure Jesus is truly God?"); // student question
  await expect(preview).toContainText("This lesson really helped me pray."); // student feedback
  await expect(preview).not.toContainText("## Path:");

  await page.getByTestId("copy-export").click();
  await expect(page.getByTestId("copy-export")).toContainText("Copied!");
});

test("a student cannot reach the weekly export (role-gated, redirected to /ocia)", async ({ page }) => {
  await page.goto("/dev/login?email=e2e-student@parvaordo.test");
  await page.goto(EXPORT_URL);
  await expect(page).toHaveURL(/\/ocia$/);
  await expect(page.getByTestId("weekly-export-header")).toHaveCount(0);
});
