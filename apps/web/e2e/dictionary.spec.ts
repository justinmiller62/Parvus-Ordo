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

// po-s2lm: /dictionary is an OCIA tool living at a top-level route. It must still present
// as OCIA — the OCIA module sidebar stays, the Dictionary item is the active one (the user
// is not "popped out" to the bare global nav), and the chrome reads OCIA.
test("Dictionary presents inside the OCIA tool shell", async ({ page }) => {
  await page.goto("/dev/login?email=e2e-student@parvaordo.test");
  await page.goto("/dictionary");

  // Chrome: the breadcrumb reads OCIA, not the bare "Reference".
  await expect(page.getByText("OCIA › Reference")).toBeVisible();

  // On phone viewports the sidebar is behind a hamburger; open it. On desktop the toggle
  // is hidden (lg:hidden) and the sidebar is always present.
  const menuToggle = page.getByRole("button", { name: "Open menu" });
  if (await menuToggle.isVisible()) await menuToggle.click();

  // The OCIA module nav is rendered (an OCIA-only item is present)…
  await expect(page.locator('[data-testid="nav-ocia-lessons"]:visible')).toBeVisible();
  // …and the Dictionary item is the active (highlighted) one.
  await expect(page.locator('[data-testid="nav-dictionary"]:visible')).toHaveClass(/text-gold/);
});
