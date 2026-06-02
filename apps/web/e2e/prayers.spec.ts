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

// po-s2lm: /prayers is an OCIA tool at a top-level route — same shell + active-state
// expectation as /dictionary (one root cause, two pages).
test("Prayer Book presents inside the OCIA tool shell", async ({ page }) => {
  await page.goto("/dev/login?email=e2e-student@parvaordo.test");
  await page.goto("/prayers");

  // Chrome: the breadcrumb reads OCIA, not the bare "Reference".
  await expect(page.getByText("OCIA › Reference")).toBeVisible();

  // On phone viewports the sidebar is behind a hamburger; open it. On desktop the toggle
  // is hidden (lg:hidden) and the sidebar is always present.
  const menuToggle = page.getByRole("button", { name: "Open menu" });
  if (await menuToggle.isVisible()) await menuToggle.click();

  // The OCIA module nav is rendered (an OCIA-only item is present)…
  await expect(page.locator('[data-testid="nav-ocia-lessons"]:visible')).toBeVisible();
  // …and the Prayers item is the active (highlighted) one.
  await expect(page.locator('[data-testid="nav-prayers"]:visible')).toHaveClass(/text-gold/);
});
