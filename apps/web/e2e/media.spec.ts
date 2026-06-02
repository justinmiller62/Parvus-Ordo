import { expect, test } from "@playwright/test";

// All media specs run inside the dedicated E2E Test Parish (seeded by
// global-setup), so manual edits to the demo parishes never break them.
const E2E_QUIZ_LESSON = "0e2e0000-0000-0000-0000-0000000000c2";
const E2E_VIDEO_LESSON = "0e2e0000-0000-0000-0000-0000000000c1";

// The learner flows use a DEDICATED learner (e2e-media-student), not the shared e2e-student,
// for two reasons: (1) the learner lesson list is cohort-gated (po-dzwc) — a student with no
// cohort sees an empty list, so we deep-link to the lesson by id rather than navigating the
// list; (2) the completion flow resets + rewrites the learner's answers, so a dedicated learner
// keeps it from clobbering the e2e-student's seeded answers that weekly-export.spec asserts on.
// (The empty-list + over-exposure behavior is covered by student-lessons.spec.)

test("media library lists the seeded video as ready + transcribed", async ({ page }) => {
  await page.goto("/dev/login?email=e2e-admin@parvaordo.test");
  await page.goto("/ocia/media");
  await expect(page.getByRole("heading", { name: "Media Library" })).toBeVisible();
  // Scope to the seeded card — other (real) assets may also be present.
  const card = page.locator('[data-testid="asset-grid"] > div').filter({ hasText: "OCIA Welcome Clip" });
  await expect(card).toBeVisible();
  await expect(card.getByText("Ready")).toBeVisible();
  await expect(card.getByText("Transcript ✓")).toBeVisible();
});

test("learner reaches the video step: seek-enforcing player + synced transcript render", async ({ page }) => {
  await page.request.get("/dev/reset?email=e2e-media-student@parvaordo.test");
  await page.goto("/dev/login?email=e2e-media-student@parvaordo.test");
  await page.goto(`/ocia/lessons/${E2E_VIDEO_LESSON}`);

  // Step 1 is the reading; advance to the video item.
  await expect(page.getByTestId("wizard-step-current")).toHaveText("1");
  await expect(page.getByTestId("wizard-step-total")).toHaveText("2");
  await page.getByTestId("wizard-next").click();

  await expect(page.getByTestId("wizard-step-current")).toHaveText("2");
  await expect(page.getByTestId("video-player")).toBeVisible();
  await expect(page.getByTestId("seek-locked")).toBeVisible(); // no-skip until watched
  await expect(page.getByTestId("transcript")).toContainText("Welcome");
  // Continue is locked until the clip has been watched.
  await expect(page.getByTestId("wizard-next")).toBeDisabled();
  await expect(page.getByTestId("wizard-next")).toContainText("Watch to continue");
});

test("learner completes a lesson → asks a question + feedback → reviews answers; catechist sees them", async ({
  page,
}) => {
  await page.request.get("/dev/reset?email=e2e-media-student@parvaordo.test");
  await page.goto("/dev/login?email=e2e-media-student@parvaordo.test");
  await page.goto(`/ocia/lessons/${E2E_QUIZ_LESSON}`);
  await page.getByTestId("wizard-next").click(); // reading → continue
  await page.getByTestId("wizard-answer-input").fill("Jesus is the Christ.");
  await page.getByTestId("wizard-next").click();
  await page.getByRole("radio", { name: /Son of the living God/ }).check();
  await page.getByTestId("wizard-next").click();
  await expect(page.getByText("Lesson complete")).toBeVisible();

  // Ask a question + leave feedback from the completion screen.
  await page.getByTestId("question-input").fill("Why does this matter?");
  await page.getByTestId("question-submit").click();
  await expect(page.getByTestId("question-sent")).toBeVisible();
  await page.getByTestId("feedback-input").fill("Great lesson!");
  await page.getByTestId("feedback-submit").click();
  await expect(page.getByTestId("feedback-sent")).toBeVisible();

  // Review mode shows the saved answer.
  await page.getByTestId("my-answers").click();
  await page.waitForURL(/review=1/);
  await expect(page.getByTestId("review-list")).toContainText("Jesus is the Christ.");

  // Catechist inbox surfaces the question + feedback (same parish).
  await page.goto("/dev/login?email=e2e-admin@parvaordo.test");
  await page.goto(`/ocia/lessons/${E2E_QUIZ_LESSON}/responses`);
  await expect(page.getByTestId("responses-questions")).toContainText("Why does this matter?");
  await expect(page.getByTestId("responses-feedback")).toContainText("Great lesson!");
});

test("teacher preview starts at the beginning, ungated, with a jump-to dropdown", async ({ page }) => {
  page.on("dialog", (d) => d.accept());
  await page.goto("/dev/login?email=e2e-admin@parvaordo.test");
  await page.goto("/ocia/lessons");
  await page.getByRole("button", { name: "New lesson" }).click();
  await page.waitForURL(/\/ocia\/lessons\/[0-9a-f-]+\/edit$/);
  await page.getByRole("button", { name: "Reading" }).click();
  await page.getByRole("button", { name: "Open-Ended" }).click();
  await expect(page.getByTestId("section-count")).toHaveText("2 sections");

  // "Preview" is a button (it flushes pending trim edits before navigating), not a link.
  await page.getByRole("button", { name: "Preview" }).click();
  await page.waitForURL(/preview=1/);
  // Preview always starts at section 1 (not the builder's last position) and is ungated.
  await expect(page.getByTestId("wizard-step-current")).toHaveText("1");
  await page.getByTestId("wizard-jump-to").selectOption("1");
  await expect(page.getByTestId("wizard-step-current")).toHaveText("2");

  // Back to the editor and clean up.
  await page
    .getByRole("link", { name: /Editor/ })
    .first()
    .click();
  await page.waitForURL(/\/edit/);
  await page.getByTestId("delete-lesson-btn").click();
  await page.waitForURL(/\/ocia\/lessons$/);
});

test("catechist adds a video item and the iMovie-style trimmer mounts", async ({ page }) => {
  page.on("dialog", (d) => d.accept());
  await page.goto("/dev/login?email=e2e-admin@parvaordo.test");
  await page.goto("/ocia/lessons");
  await page.getByRole("button", { name: "New lesson" }).click();
  await page.waitForURL(/\/ocia\/lessons\/[0-9a-f-]+\/edit$/);

  await page.getByRole("button", { name: "Video" }).click();
  await expect(page.getByTestId("section-count")).toHaveText("1 sections");

  // Open the item editor, pick the seeded video → the trim track appears.
  await page.getByRole("button", { name: "Edit" }).first().click();
  await expect(page.getByRole("heading", { name: "Edit Video" })).toBeVisible();
  await page.getByTestId("video-asset-select").selectOption({ label: "OCIA Welcome Clip" });
  await expect(page.getByTestId("trim-track")).toBeVisible();
  await expect(page.getByTestId("trim-start")).toBeVisible();
  await expect(page.getByTestId("trim-end")).toBeVisible();

  // Kick off the cut and confirm it's accepted: instant "Clip ready" with the stub
  // processor, or "Cutting clip…" when the real clip-cutter is wired (CLIP_CUTTER_URL).
  await page.getByTestId("generate-clip").click();
  await expect(page.getByTestId("clip-status")).toContainText(/Cutting clip|Clip ready/);
  await page.getByRole("button", { name: "Close editor" }).click();

  // Clean up the lesson this test created.
  await page.getByTestId("delete-lesson-btn").click();
  await page.waitForURL(/\/ocia\/lessons$/);
});
