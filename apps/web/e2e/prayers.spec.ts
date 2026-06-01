import { expect, test } from "@playwright/test";

// Prayer Book in the E2E Test Parish (seeded global 'Hail Mary'). All members read; staff add.

test("a learner can browse prayers and open one", async ({ page }) => {
  await page.goto("/dev/login?email=e2e-student@parvaordo.test");
  await page.goto("/prayers");
  await expect(page.getByRole("heading", { name: "Prayer Book" })).toBeVisible();
  await expect(page.getByTestId("prayer-list")).toContainText("Hail Mary");
  await expect(page.getByTestId("prayer-add")).toHaveCount(0);
  await page.getByTestId("prayer-row-Hail Mary").click();
  await expect(page.getByTestId("prayer-modal")).toContainText("full of grace");
});

test("an admin sees the Add prayer control", async ({ page }) => {
  await page.goto("/dev/login?email=e2e-admin@parvaordo.test");
  await page.goto("/prayers");
  await expect(page.getByTestId("prayer-add")).toBeVisible();
});
