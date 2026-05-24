import { test, expect } from '@playwright/test';

test.describe('Cabinet App', () => {
  test('Office page loads', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('h1')).toContainText('Office');
  });

  test('Navigation works', async ({ page }) => {
    await page.goto('/');
    // Click Factory nav
    await page.click('text=Factory');
    await expect(page).toHaveURL(/\/factory/);
    // Click Office nav
    await page.click('text=Office');
    await expect(page).toHaveURL(/\/$/);
  });

  test('Chat panel has input', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('textarea[placeholder]')).toBeVisible();
    await expect(page.locator('button[aria-label="Send"]')).toBeVisible();
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
