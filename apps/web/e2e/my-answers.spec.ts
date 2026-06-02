import { expect, test } from "@playwright/test";

// Runs in the E2E Test Parish (global-setup). The e2e student has one submitted answer —
// to the open question of "E2E: Who Do You Say That I Am" (see seed-e2e.mjs). The video
// lesson has no questions and no answers. So the My Answers surface lists the quiz lesson
// only, and each row links into the existing read-only review mode (?review=1).
async function login(page: import("@playwright/test").Page, email: string) {
  await page.goto(`/dev/login?email=${email}`);
}

test("My Answers lists answered lessons and links into the read-only review", async ({ page }) => {
  await login(page, "e2e-student@parvaordo.test");
  await page.goto("/ocia/my-answers");

  await expect(page.getByRole("heading", { name: "My Answers" })).toBeVisible();

  const list = page.getByTestId("my-answers-list");
  await expect(list).toBeVisible();
  await expect(list.getByText("E2E: Who Do You Say That I Am")).toBeVisible();
  // The video lesson has no questions → no answers → it is not listed.
  await expect(list.getByText("E2E: Welcome Video Lesson")).toHaveCount(0);

  // Click through to the existing read-only review of that lesson's answers.
  await list.getByText("E2E: Who Do You Say That I Am").click();
  await expect(page).toHaveURL(/\/ocia\/lessons\/.*review=1/);
  await expect(page.getByRole("heading", { name: /Who Do You Say That I Am/ })).toBeVisible();
  await expect(page.getByTestId("review-list")).toBeVisible();
});
