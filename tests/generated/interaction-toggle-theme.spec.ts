import { test, expect } from '@playwright/test';

test('interaction-toggle-theme', async ({ page }) => {
  // Navigate to the QuikSplit page
  await page.goto('https://quiksplit.kieffer.me/');

  // Locate and click the "Toggle theme" button
  const toggleThemeButton = page.locator('button', { hasText: 'Toggle theme' });
  await toggleThemeButton.click();

  // Verify the theme has toggled by checking a style or class change
  // This is a placeholder assertion, replace with actual verification logic
  const body = page.locator('body');
  await expect(body).toHaveClass(/dark-theme|light-theme/);

  // Locate and click the "Baptiste Derongs" button
  const baptisteButton = page.locator('button', { hasText: 'Baptiste Derongs\nbaptiste.derongs@gmail.com' });
  await baptisteButton.click();

  // Verify the action associated with "Baptiste Derongs" button
  // This is a placeholder assertion, replace with actual verification logic
  await expect(page).toHaveURL(/.*baptiste-action-completed/);
});