import { expect, test } from "@playwright/test";

// Runs in the E2E Test Parish (global-setup). The e2e-locked-student is enrolled in a
// SEQUENTIAL cohort whose schedule puts the quiz lesson (week 1) before the video lesson
// (week 2), with no progress — so the video lesson is sequentially LOCKED. This proves the
// lesson view refuses a locked deep-link server-side, while the open prior lesson loads.
const QUIZ_LESSON = "0e2e0000-0000-0000-0000-0000000000c2"; // week 1 — open (first sequenced)
const VIDEO_LESSON = "0e2e0000-0000-0000-0000-0000000000c1"; // week 2 — locked until the quiz is complete

async function login(page: import("@playwright/test").Page, email: string) {
  await page.goto(`/dev/login?email=${email}`);
}

test("a sequentially-locked lesson is refused server-side on direct navigation", async ({ page }) => {
  await login(page, "e2e-locked-student@parvaordo.test");

  // Deep-link straight to the locked (week-2) lesson → server renders the blocked state.
  await page.goto(`/ocia/lessons/${VIDEO_LESSON}`);
  await expect(page.getByTestId("lesson-view-locked")).toBeVisible();

  // The open prior lesson (week 1) loads the wizard normally — enforcement is targeted.
  await page.goto(`/ocia/lessons/${QUIZ_LESSON}`);
  await expect(page.getByTestId("lesson-view-locked")).toHaveCount(0);
  await expect(page.getByText(/Jesus asked/)).toBeVisible();
});
