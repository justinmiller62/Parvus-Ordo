import { expect, test } from "@playwright/test";
import { Client } from "pg";

// The Gather module shell (RFC-005 §2.1, po-ck9z). Gather ships dark (defaultEnabled=false), so the
// requireModule("gather") gate is exercised both ways: disabled → redirect home; enabled → the
// shell + sub-nav render with "Gather" active in the main sidebar. admin@parvaordo.test is a Holy
// Spirit admin (the int seed). The parish_modules toggle is set directly + restored to dark after.

const HOLY_SPIRIT = "11111111-1111-1111-1111-111111111111";

async function setGather(enabled: boolean | null): Promise<void> {
  const c = new Client({ connectionString: process.env.MIGRATION_DATABASE_URL });
  await c.connect();
  if (enabled === null) {
    await c.query("DELETE FROM parish_modules WHERE parish_id = $1 AND module_key = 'gather'", [HOLY_SPIRIT]);
  } else {
    await c.query(
      "INSERT INTO parish_modules (parish_id, module_key, enabled) VALUES ($1, 'gather', $2) ON CONFLICT (parish_id, module_key) DO UPDATE SET enabled = $2",
      [HOLY_SPIRIT, enabled],
    );
  }
  await c.end();
}

test.describe.serial("Gather module shell", () => {
  test.afterAll(async () => {
    await setGather(null); // restore the dark default
  });

  test("ships dark — with Gather disabled, /gather redirects home (requireModule gate)", async ({ page }) => {
    await setGather(null); // no row → defaultEnabled false → disabled
    await page.goto("/dev/login?email=admin@parvaordo.test");
    await page.goto("/gather");
    await expect(page).toHaveURL("http://localhost:3000/");
  });

  test("when enabled — renders the shell + sub-nav with Gather active in the main sidebar", async ({ page }) => {
    await setGather(true);
    await page.goto("/dev/login?email=admin@parvaordo.test");
    await page.goto("/gather");
    await expect(page).toHaveURL("http://localhost:3000/gather");
    await expect(page.getByRole("heading", { level: 1, name: "Gather", exact: true })).toBeVisible();
    const subnav = page.getByRole("navigation", { name: "Gather sections" });
    await expect(subnav.getByRole("link", { name: "My Groups" })).toBeVisible();
    await expect(subnav.getByRole("link", { name: "Requests" })).toBeVisible();
    await expect(subnav.getByText("Health Dashboard")).toBeVisible(); // later-tier, present-but-disabled
    await expect(page.getByTestId("nav-gather")).toBeVisible(); // the main-sidebar entry
  });
});
