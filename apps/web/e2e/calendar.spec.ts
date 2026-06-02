import { expect, test } from "@playwright/test";

// Seeded by global-setup (seed-e2e.mjs): two parish calendar events in June 2026 — a plain
// "E2E Parish Feast" (06-15) and a transferred "E2E Transferred Feast" (actual 06-10,
// celebrated 06-12) that the expander renders as a ghost + the full event.
const JUNE = "/ocia/calendar?month=2026-06";

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

  // Single click → read-only detail modal.
  await parishFeast.click();
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
