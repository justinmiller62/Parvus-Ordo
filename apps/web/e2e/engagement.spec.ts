import { expect, test } from "@playwright/test";

// E2E_QUIZ_LESSON from infra/db/seed-e2e.mjs — reading → open-ended → multiple-choice.
const QUIZ_LESSON = "0e2e0000-0000-0000-0000-0000000000c2";
const ENGAGEMENT_URL = `/ocia/lessons/${QUIZ_LESSON}/engagement`;

test("a learner is redirected away from the engagement dashboard (role-gated)", async ({ page }) => {
  await page.goto("/dev/login?email=e2e-student@parvaordo.test");
  await page.goto(ENGAGEMENT_URL);
  // catechumen_candidate has no admin/catechist role → bounced to OCIA Home, never the dashboard.
  await expect(page).toHaveURL(/\/ocia$/);
  await expect(page.getByTestId("engagement-students")).toHaveCount(0);
});

test("a learner's progress shows up on the catechist's engagement dashboard", async ({ page }) => {
  // 1. A learner completes the quiz lesson (reading → open-ended → multiple-choice).
  await page.request.get("/dev/reset?email=e2e-student@parvaordo.test");
  await page.goto("/dev/login?email=e2e-student@parvaordo.test");
  await page.goto(`/ocia/lessons/${QUIZ_LESSON}`);

  await expect(page.getByTestId("wizard-step-current")).toHaveText("1");
  await page.getByTestId("wizard-next").click(); // reading → continue

  await expect(page.getByTestId("wizard-step-current")).toHaveText("2");
  await page.getByTestId("wizard-answer-input").fill("Jesus is the Christ.");
  await page.getByTestId("wizard-next").click(); // open-ended → submit

  await expect(page.getByTestId("wizard-step-current")).toHaveText("3");
  await page.getByRole("radio", { name: /Son of the living God/ }).check();
  await page.getByTestId("wizard-next").click(); // multiple-choice → submit

  await expect(page.getByText("Lesson complete")).toBeVisible();

  // 2. A catechist opens the engagement dashboard and sees that learner's activity.
  //    Engagement writes run in `after()` (post-response), so reload-poll until they land.
  await page.goto("/dev/login?email=e2e-catechist@parvaordo.test");
  await expect(async () => {
    await page.goto(ENGAGEMENT_URL);
    await expect(page.getByRole("heading", { name: "Engagement Analytics" })).toBeVisible();
    await expect(page.getByTestId("engagement-students")).toHaveText("1");
    await expect(page.getByTestId("engagement-completed")).toHaveText("1");
  }).toPass({ timeout: 15_000 });

  // The learner appears in the student table, marked completed, with both questions answered.
  const row = page.getByTestId("engagement-student-row").filter({ hasText: "E2E Student" });
  await expect(row).toBeVisible();
  await expect(row).toContainText("Completed");

  // Per-question analytics rendered the multiple-choice question with 100% accuracy.
  // (Scope to the table — the prompt also appears as a per-step bar label, and "100%"
  // also appears on the completion card/donut.)
  const qTable = page.getByTestId("engagement-question-table");
  await expect(qTable.getByText("Which is a profession of faith?")).toBeVisible();
  await expect(qTable.getByRole("row", { name: /Which is a profession of faith/ })).toContainText("100%");
});
