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

// Drive the seeded 8s clip's <video> to its end by walking currentTime forward in <=2s
// steps (so the player's no-skip clamp, rel > maxReached + 2, never fires) and dispatching
// `timeupdate` so the player flips `watched` and persists the furthest point.
//
// The steps elapse REAL time (a fraction of the clip length): the server now PACES each
// progress save against the wall-clock since the previous one (pacedMaxReachedMs, po-4dyo),
// so the furthest point can't outrun real time. We advance ~1.5s of clip per ~0.9s of real
// time (~1.7x, well within the ~2.5x rate the server allows but far below a one-shot forge),
// which mimics a genuine watch and clears the completion gate. (Driving it in ~0ms — as the
// old fast-forward did — now reads as a forge and is correctly refused.)
async function simulateWatchToEnd(page: import("@playwright/test").Page, clipSec: number): Promise<void> {
  await page.evaluate(async (endSec) => {
    const video = document.querySelector<HTMLVideoElement>('[data-testid="video-player"] video');
    if (!video) throw new Error("video element not found");
    let t = 0;
    Object.defineProperty(video, "currentTime", {
      configurable: true,
      get: () => t,
      set: (v: number) => {
        t = v;
      },
    });
    for (let s = 0; s <= endSec; s += 1.5) {
      t = s;
      video.dispatchEvent(new Event("timeupdate"));
      await new Promise((r) => setTimeout(r, 900)); // elapse real time so server-side pacing passes
    }
    t = endSec;
    video.dispatchEvent(new Event("timeupdate"));
  }, clipSec);
}

test("learner who watches the video to the end can advance past it (server-gated completion)", async ({ page }) => {
  await page.request.get("/dev/reset?email=e2e-media-student@parvaordo.test");
  await page.goto("/dev/login?email=e2e-media-student@parvaordo.test");
  await page.goto(`/ocia/lessons/${E2E_VIDEO_LESSON}`);

  // reading → video step; Continue is locked until the clip is watched.
  await page.getByTestId("wizard-next").click();
  await expect(page.getByTestId("video-player")).toBeVisible();
  await expect(page.getByTestId("wizard-next")).toBeDisabled();

  await simulateWatchToEnd(page, 8);

  // The cosmetic gate unlocks, and (crucially) the server gate now passes: advancing lands
  // on the completion screen rather than bouncing back to the video step — the legitimate
  // full-watch path, proof there's no silent lockout under server-derived completion.
  await expect(page.getByTestId("wizard-next")).toBeEnabled();
  await expect(page.getByTestId("wizard-next")).toContainText("Continue");
  await page.waitForTimeout(1000); // let the progress save's round-trip land before advancing
  await page.getByTestId("wizard-next").click();
  // Use the heading role: getByText also matches Next's route-announcer live region.
  await expect(page.getByRole("heading", { name: "Lesson complete" })).toBeVisible();
});

test("a tampered advance on an UNwatched video is refused server-side (bounces, does not complete)", async ({
  page,
}) => {
  await page.request.get("/dev/reset?email=e2e-media-student@parvaordo.test");
  await page.goto("/dev/login?email=e2e-media-student@parvaordo.test");
  await page.goto(`/ocia/lessons/${E2E_VIDEO_LESSON}`);
  await page.getByTestId("wizard-next").click();
  await expect(page.getByTestId("video-player")).toBeVisible();
  await expect(page.getByTestId("wizard-step-current")).toHaveText("2");

  // Tamper: strip the client-side `disabled` guard and submit advanceAction without
  // watching. The server gate (isVideoItemWatched) must refuse — the form bounces back to
  // the same step and the lesson is NOT completed.
  await page.evaluate(() => document.querySelector('[data-testid="wizard-next"]')?.removeAttribute("disabled"));
  await page.getByTestId("wizard-next").click();

  await expect(page.getByTestId("video-player")).toBeVisible(); // still on the video step
  await expect(page.getByTestId("wizard-step-current")).toHaveText("2");
  await expect(page.getByRole("heading", { name: "Lesson complete" })).toHaveCount(0);
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

// The "Add from YouTube" affordance and its live preview are pure client behavior (id
// extraction → youtube-nocookie embed URL), so this asserts the picker UX without the
// network — actually ingesting a YouTube video reaches youtube.com, which is out of scope
// for an offline e2e (see DELTAS: YouTube student-playback e2e is externally blocked).
test("catechist video picker offers a YouTube source with a live preview", async ({ page }) => {
  page.on("dialog", (d) => d.accept());
  await page.goto("/dev/login?email=e2e-admin@parvaordo.test");
  await page.goto("/ocia/lessons");
  await page.getByRole("button", { name: "New lesson" }).click();
  await page.waitForURL(/\/ocia\/lessons\/[0-9a-f-]+\/edit$/);

  await page.getByRole("button", { name: "Video" }).click();
  await page.getByRole("button", { name: "Edit" }).first().click();
  await expect(page.getByRole("heading", { name: "Edit Video" })).toBeVisible();

  // Open the YouTube sub-form and paste a watch URL → the privacy-enhanced embed previews.
  await page.getByTestId("youtube-add-toggle").click();
  await expect(page.getByTestId("youtube-add-submit")).toBeDisabled(); // empty input
  await page.getByTestId("youtube-url-input").fill("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  const preview = page.getByTestId("youtube-preview");
  await expect(preview).toBeVisible();
  await expect(preview).toHaveAttribute("src", /youtube-nocookie\.com\/embed\/dQw4w9WgXcQ/);
  await expect(page.getByTestId("youtube-add-submit")).toBeEnabled();

  await page.getByRole("button", { name: "Close editor" }).click();
  await page.getByTestId("delete-lesson-btn").click();
  await page.waitForURL(/\/ocia\/lessons$/);
});

// po-ob5m: a YouTube source now gets the IFrame-API trimmer (not a play-in-full embed).
// The live scrub drives the cross-origin YouTube IFrame API (offline-blocked, like
// YouTube playback), but the trim track, handles, and fine-tune controls render and
// update from the asset's known duration purely client-side — so the trim-window UX
// (the part that authors start_ms/end_ms) IS covered here against a seeded asset.
test("catechist trims a YouTube source with the IFrame trimmer", async ({ page }) => {
  page.on("dialog", (d) => d.accept());
  await page.goto("/dev/login?email=e2e-admin@parvaordo.test");
  await page.goto("/ocia/lessons");
  await page.getByRole("button", { name: "New lesson" }).click();
  await page.waitForURL(/\/ocia\/lessons\/[0-9a-f-]+\/edit$/);

  await page.getByRole("button", { name: "Video" }).click();
  await page.getByRole("button", { name: "Edit" }).first().click();
  await expect(page.getByRole("heading", { name: "Edit Video" })).toBeVisible();

  // Select the seeded YouTube asset → the IFrame trimmer mounts (replacing the old
  // static "plays in full" embed), and the shared trim track renders from its duration.
  await page.getByTestId("video-asset-select").selectOption({ label: "OCIA YouTube Sample (YouTube)" });
  await expect(page.getByTestId("youtube-trimmer")).toBeVisible();
  await expect(page.getByTestId("trim-track")).toBeVisible();
  await expect(page.getByTestId("trim-start")).toBeVisible();
  await expect(page.getByTestId("trim-end")).toBeVisible();

  // Set the in-point via the numeric control → the window label reflects it (the pure
  // trim-window math runs without the IFrame API; the live seek just no-ops offline).
  await page.getByTestId("trim-in-input").fill("30");
  await page.getByTestId("trim-in-input").blur();
  await expect(page.getByTestId("trim-start-label")).toHaveText("0:30");

  await page.getByRole("button", { name: "Close editor" }).click();
  await page.getByTestId("delete-lesson-btn").click();
  await page.waitForURL(/\/ocia\/lessons$/);
});
