import { expect, test } from "@playwright/test";

const HOLY_SPIRIT = "11111111-1111-1111-1111-111111111111";
const ST_MONICA = "22222222-2222-2222-2222-222222222222";

test("multi-parish user chooses a parish, then switches (role changes per parish)", async ({ page }) => {
  // No &parish → the chooser appears (2 memberships, no active parish).
  await page.goto("/dev/login?email=multi@parvaordo.test");
  await expect(page.getByTestId("choose-parish")).toBeVisible();

  // Pick St. Monica, where multi@ is ADMIN → lands on the parish dashboard.
  await page.getByTestId(`choose-${ST_MONICA}`).click();
  await expect(page).toHaveURL("http://localhost:3000/");
  await expect(page.getByText("St. Monica Parish")).toBeVisible();
  await expect(page.getByTestId("parish-switcher")).toBeVisible();

  // Switch to Holy Spirit, where multi@ is CATECHIST (OCIA-only) → routed into OCIA.
  await page.getByTestId("parish-switcher").click();
  await page.getByTestId(`switch-${HOLY_SPIRIT}`).click();
  await expect(page).toHaveURL("http://localhost:3000/ocia");
  await expect(page.getByRole("heading", { name: "OCIA Home" })).toBeVisible();
});

test("single-parish user never sees the chooser or switcher", async ({ page }) => {
  await page.goto("/dev/login?email=admin@parvaordo.test");
  await expect(page).toHaveURL("http://localhost:3000/");
  await expect(page.getByTestId("choose-parish")).toHaveCount(0);
  await expect(page.getByTestId("parish-switcher")).toHaveCount(0);
});
