import { expect, test } from "@playwright/test";

// Seeded by global-setup (seed-e2e.mjs): the universal dictionary entry "eucharist"
// (definition mentions "Real Presence"); the quiz lesson's reading and the video lesson's
// synced transcript both mention the Eucharist so the inline highlighter has a term to hit.
const QUIZ_LESSON = "0e2e0000-0000-0000-0000-0000000000c2";
const VIDEO_LESSON = "0e2e0000-0000-0000-0000-0000000000c1";

test("reading: a dictionary term is highlighted (others untouched) and opens a definition in place", async ({
  page,
}) => {
  await page.request.get("/dev/reset?email=e2e-student@parvaordo.test");
  await page.goto("/dev/login?email=e2e-student@parvaordo.test");
  await page.goto(`/ocia/lessons/${QUIZ_LESSON}`); // resumes at step 1 — the reading

  const terms = page.locator(".dict-term");
  await expect(terms).toHaveCount(1); // only "Eucharist" — "Jesus", "Who", … are untouched
  await expect(terms.first()).toHaveText("Eucharist");

  await terms.first().click();
  const modal = page.getByTestId("dictionary-modal");
  await expect(modal).toBeVisible();
  await expect(modal).toContainText("Real Presence"); // the seeded definition

  // Escape closes it in place (focus trap / dismissal), leaving the lesson intact.
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("dictionary-modal")).toHaveCount(0);
  await expect(page.getByTestId("wizard-step-current")).toBeVisible();
});

test("transcript: a dictionary term in the video transcript opens the same definition", async ({ page }) => {
  await page.request.get("/dev/reset?email=e2e-student@parvaordo.test");
  await page.goto("/dev/login?email=e2e-student@parvaordo.test");
  await page.goto(`/ocia/lessons/${VIDEO_LESSON}`);

  // Step 1 is the reading; advance to the video item (step 2) where the transcript renders.
  await page.getByTestId("wizard-next").click();
  await expect(page.getByTestId("transcript")).toBeVisible();

  const term = page.getByTestId("transcript-term").filter({ hasText: "Eucharist" });
  await expect(term.first()).toBeVisible();
  await term.first().click();
  await expect(page.getByTestId("dictionary-modal")).toContainText("Real Presence");
});
