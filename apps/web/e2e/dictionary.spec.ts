import { expect, test } from "@playwright/test";

// Dictionary runs in the E2E Test Parish (seeded by global-setup) with one seeded
// global entry ('eucharist'). All members read; only staff can add.

test("a learner can browse the dictionary and open an entry", async ({ page }) => {
  await page.goto("/dev/login?email=e2e-student@parvaordo.test");
  await page.goto("/dictionary");
  await expect(page.getByRole("heading", { name: "Dictionary" })).toBeVisible();
  await expect(page.getByTestId("dict-list")).toContainText("Eucharist");
  // learner: no add control
  await expect(page.getByTestId("dict-add")).toHaveCount(0);
  // detail modal
  await page.getByTestId("dict-row-eucharist").click();
  await expect(page.getByTestId("dict-modal")).toContainText("Real Presence");
});

test("search filters the list", async ({ page }) => {
  await page.goto("/dev/login?email=e2e-student@parvaordo.test");
  await page.goto("/dictionary");
  await page.getByTestId("dict-search").fill("zzzznomatch");
  await expect(page.getByText("No entries match your search.")).toBeVisible();
  await page.getByTestId("dict-search").fill("real presence");
  await expect(page.getByTestId("dict-list")).toContainText("Eucharist");
});

test("an admin sees the Add entry control", async ({ page }) => {
  await page.goto("/dev/login?email=e2e-admin@parvaordo.test");
  await page.goto("/dictionary");
  await expect(page.getByTestId("dict-add")).toBeVisible();
});
