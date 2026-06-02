import { expect, test } from "@playwright/test";

// Seeded by global-setup (seed-e2e.mjs): two parish calendar events in June 2026 — a plain
// "E2E Parish Feast" (06-15) and a transferred "E2E Transferred Feast" (actual 06-10,
// celebrated 06-12) that the expander renders as a ghost + the full event.
const JUNE = "/ocia/calendar?month=2026-06";
const E2E_COHORT = "0e2e0000-0000-0000-0000-0000000000e1";

test("catechist: parish events render (incl. a transferred-feast ghost), detail opens, filter hides", async ({
  page,
}) => {
  await page.goto("/dev/login?email=e2e-catechist@parvaordo.test");
  await page.goto(JUNE);
  await expect(page.getByTestId("calendar-month")).toHaveText("June 2026");

  const parishFeast = page.getByTestId("calendar-event").filter({ hasText: "E2E Parish Feast" });
  await expect(parishFeast).toHaveCount(1);
  // The transferred feast renders TWICE: the faded ghost on the actual date + the full
  // event on the celebrated date.
  await expect(page.getByTestId("calendar-event").filter({ hasText: "E2E Transferred Feast" })).toHaveCount(2);

  // Single click opens the read-only detail modal. Click the VISIBLE representation — the grid
  // chip on desktop, the agenda row on mobile (the grid is hidden below the sm breakpoint).
  await page.getByRole("button", { name: "E2E Parish Feast" }).and(page.locator(":visible")).first().click();
  const detail = page.getByTestId("calendar-detail-modal");
  await expect(detail).toBeVisible();
  await expect(detail).toContainText("E2E Parish Feast");
  await page.keyboard.press("Escape");
  await expect(detail).toHaveCount(0);

  // Unchecking the Narthex source hides its events.
  await page.getByTestId("calendar-filters").getByRole("button", { name: "Narthex Events" }).click();
  await expect(page.getByTestId("calendar-event").filter({ hasText: "E2E Parish Feast" })).toHaveCount(0);
});

test("catechist: Add Event creates a parish event that appears on the grid", async ({ page }) => {
  await page.goto("/dev/login?email=e2e-catechist@parvaordo.test");
  await page.goto(JUNE);

  await page.getByTestId("calendar-add-event").click();
  await expect(page.getByTestId("calendar-event-modal")).toBeVisible();
  await page.getByTestId("event-title").fill("E2E Created Event");
  await page.getByTestId("event-date").fill("2026-06-20");
  await page.getByTestId("event-save").click();

  await expect(page.getByTestId("calendar-event").filter({ hasText: "E2E Created Event" })).toHaveCount(1);
});

test("student: no Add Event control (read-only calendar)", async ({ page }) => {
  await page.goto("/dev/login?email=e2e-student@parvaordo.test");
  await page.goto(JUNE);
  await expect(page.getByTestId("calendar-month")).toBeVisible();
  await expect(page.getByTestId("calendar-add-event")).toHaveCount(0);
});

test("Manage feeds is editor-only: catechist sees the link; student has none and is redirected away", async ({
  page,
}) => {
  await page.goto("/dev/login?email=e2e-catechist@parvaordo.test");
  await page.goto(JUNE);
  await expect(page.getByTestId("calendar-manage-feeds")).toBeVisible();

  await page.goto("/dev/login?email=e2e-student@parvaordo.test");
  await page.goto(JUNE);
  await expect(page.getByTestId("calendar-manage-feeds")).toHaveCount(0);
  // requireStaff redirects a student who deep-links to the sources admin back to the calendar.
  await page.goto("/ocia/calendar/sources");
  await expect(page).toHaveURL(/\/ocia\/calendar(\?|$)/);
});

test("catechist: Manage feeds — create, toggle, and delete an iCal source", async ({ page }) => {
  page.on("dialog", (d) => d.accept()); // the delete confirm
  await page.goto("/dev/login?email=e2e-catechist@parvaordo.test");
  await page.goto("/ocia/calendar/sources");
  await expect(page.getByRole("heading", { name: "Calendar feeds" })).toBeVisible();
  await expect(page.getByTestId("sources-empty")).toBeVisible(); // seed ships no feeds

  await page.getByTestId("add-source").click();
  await expect(page.getByTestId("source-modal")).toBeVisible();
  await page.getByTestId("source-name").fill("E2E Diocesan Feed");
  await page.getByTestId("source-url").fill("https://example.org/diocese.ics");
  await page.getByTestId("source-save").click();

  const row = page.getByTestId("sources-list").locator("li").filter({ hasText: "E2E Diocesan Feed" });
  await expect(row).toHaveCount(1);

  // Enable-toggle round-trips without dropping the row.
  await row.getByTestId("source-toggle").click();
  await expect(row).toHaveCount(1);

  // Delete via the edit modal's confirm.
  await row.getByTestId("source-edit").click();
  await expect(page.getByTestId("source-modal")).toBeVisible();
  await page.getByTestId("source-delete").click();
  await expect(page.getByTestId("sources-list").locator("li").filter({ hasText: "E2E Diocesan Feed" })).toHaveCount(0);
});

test("catechist: cohort detail has a Calendar tab rendering the cohort schedule", async ({ page }) => {
  await page.goto("/dev/login?email=e2e-catechist@parvaordo.test");
  await page.goto(`/ocia/cohorts/${E2E_COHORT}`);
  await page.getByTestId("tab-calendar").click();
  // The cohort's schedule renders as a month grid (or the empty state if it has no schedule).
  await expect(page.getByTestId("cohort-calendar").or(page.getByTestId("cohort-calendar-empty"))).toBeVisible();
});
