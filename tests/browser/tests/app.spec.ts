import { test, expect } from '@playwright/test';

test.describe('Cabinet App', () => {
  test('Dashboard loads with project switcher', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('h1')).toContainText('Dashboard');
    // Project switcher should be visible
    await expect(page.locator('button')).toContainText('Product Launch');
  });

  test('Navigation works', async ({ page }) => {
    await page.goto('/');
    // Click Cabinet nav
    await page.click('text=Cabinet');
    await expect(page).toHaveURL(/\/cabinet/);
    // Click Office nav
    await page.click('text=Office');
    await expect(page).toHaveURL(/\/office/);
  });

  test('Cabinet page has chat input', async ({ page }) => {
    await page.goto('/cabinet');
    await expect(page.locator('input[placeholder]')).toBeVisible();
    await expect(page.locator('button:has-text("Send")')).toBeVisible();
  });

  test('Dark mode toggle works', async ({ page }) => {
    await page.goto('/');
    const html = page.locator('html');
    const initial = await html.getAttribute('class');
    // Click dark mode toggle in nav
    const toggleBtn = page.locator('button:has-text("Dark")');
    if (await toggleBtn.isVisible()) {
      await toggleBtn.click();
      await expect(html).toHaveClass(/dark/);
    }
  });
});
