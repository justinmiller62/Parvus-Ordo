import { expect, test } from "@playwright/test";

// Super-admin admin plane (RFC-004 §6/§12, po-4t5j). The dev bypass logs in as a seeded user:
// super@parvaordo.test is_super_admin=true; admin@parvaordo.test is a parish admin (NOT super).

test("a non-super-admin cannot reach /admin (redirected home)", async ({ page }) => {
  await page.goto("/dev/login?email=admin@parvaordo.test");
  await expect(page).toHaveURL("http://localhost:3000/");
  await page.goto("/admin");
  // requireSuperAdmin → redirect("/"): the admin shell never renders for a non-super-admin.
  await expect(page).toHaveURL("http://localhost:3000/");
  await expect(page.getByRole("heading", { name: "Parishes" })).toHaveCount(0);
});

test("a super-admin reaches the admin plane and sees existing parishes", async ({ page }) => {
  await page.goto("/dev/login?email=super@parvaordo.test");
  await page.goto("/admin");
  await expect(page).toHaveURL("http://localhost:3000/admin");
  await expect(page.getByRole("heading", { name: "Parishes" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Provision a parish" })).toBeVisible();
  await expect(page.getByText("Holy Spirit Parish")).toBeVisible();
});

test("create form: live preview + a taken slug is flagged by the debounced probe", async ({ page }) => {
  await page.goto("/dev/login?email=super@parvaordo.test");
  await page.goto("/admin");
  await page.getByPlaceholder("holy-spirit").fill("holy-spirit"); // seeded → taken
  await expect(page.getByTestId("slug-preview")).toContainText("holy-spirit");
  await expect(page.getByText(/already taken/i)).toBeVisible();
});

test("a super-admin provisions a bare parish and gets the hand-off toast", async ({ page }) => {
  await page.goto("/dev/login?email=super@parvaordo.test");
  await page.goto("/admin");
  const slug = `e2e-admintest-${Date.now().toString(36)}`;
  await page.getByPlaceholder("Holy Spirit Parish").fill("E2E Admin Test Parish");
  await page.getByPlaceholder("holy-spirit").fill(slug);
  await page.locator('select[name="dioceseId"]').selectOption({ index: 1 });
  await page.getByRole("button", { name: /Provision parish/ }).click();
  await expect(page.getByText(/provisioned/i)).toBeVisible(); // success toast
  await expect(page.getByText(`${slug}.`)).toBeVisible(); // animates into the list
});
