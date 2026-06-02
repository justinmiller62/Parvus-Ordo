import { expect, test } from "@playwright/test";

// Runs in the E2E Test Parish (seeded by global-setup). The e2e student is enrolled in a
// learning PATH but has no cohort_members row and no cohort_schedule, so the gated read
// model (getStudentLessons) releases NOTHING to them. Meanwhile two published parish
// lessons exist ("E2E: Welcome Video Lesson", "E2E: Who Do You Say That I Am") that the
// LEGACY learner list (getPublishedLessons) would have rendered unconditionally. This
// spec pins the over-exposure fix shut at the page level: the learner sees the empty
// state, never those un-released lessons.
async function login(page: import("@playwright/test").Page, email: string) {
  await page.goto(`/dev/login?email=${email}`);
}

test("learner lesson list shows the empty state and does not over-expose published lessons", async ({ page }) => {
  await login(page, "e2e-student@parvaordo.test");
  await page.goto("/ocia/lessons");

  await expect(page.getByRole("heading", { name: "My Lessons" })).toBeVisible();

  // Gated path → nothing released to this student → empty state.
  await expect(page.getByTestId("lesson-empty-state")).toBeVisible();

  // The published lessons the legacy getPublishedLessons() list WOULD have shown are absent.
  await expect(page.getByText("E2E: Welcome Video Lesson")).toHaveCount(0);
  await expect(page.getByText("E2E: Who Do You Say That I Am")).toHaveCount(0);
});
