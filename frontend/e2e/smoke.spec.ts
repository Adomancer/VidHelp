import { expect, test } from "@playwright/test";

/**
 * Sign in through the login form as each role and land on that role's dashboard.
 * Accounts default to the demo seeders (php artisan db:seed --class=DemoSeeder2, password "password");
 * override with E2E_<ROLE>_EMAIL / E2E_PASSWORD.
 */
const password = process.env.E2E_PASSWORD ?? "password";
const roles = [
  { role: "host", email: process.env.E2E_HOST_EMAIL ?? "bulk01@vidhelp.com", home: "/host/dashboard" },
  { role: "operator", email: process.env.E2E_OPERATOR_EMAIL ?? "operator1@vidhelp.com", home: "/operator/dashboard" },
  { role: "finance", email: process.env.E2E_FINANCE_EMAIL ?? "finance@vidhelp.com", home: "/admin/dashboard" },
  { role: "admin", email: process.env.E2E_ADMIN_EMAIL ?? "admin@vidhelp.com", home: "/admin/dashboard" },
];

for (const { role, email, home } of roles) {
  test(`${role} signs in and sees the dashboard`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));

    await page.goto("/login");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Kata sandi", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Masuk", exact: true }).click();

    // Admins and finance may have to pass (or set up) 2FA first: not something a smoke test can do
    await Promise.race([page.waitForURL((url) => url.pathname !== "/login"), page.getByText("Verifikasi dua langkah").waitFor()]);
    const twoFactor = page.url().includes("/two-factor/setup") || (await page.getByText("Verifikasi dua langkah").isVisible());
    test.skip(twoFactor, `${email} needs 2FA; set TWO_FACTOR_REQUIRED_FOR_ADMINS=false on a test backend or use another account`);

    await expect(page).toHaveURL(new RegExp(`${home}$`));
    await expect(page.locator("main h1")).toBeVisible();
    expect(errors).toEqual([]);
  });
}

test("signed-out visitors are sent to the login page", async ({ page }) => {
  await page.goto("/admin/dashboard");
  await expect(page).toHaveURL(/\/login$/);
});
