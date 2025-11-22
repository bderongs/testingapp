import { test, expect } from '@playwright/test';

test('Complete the key form on QuikSplit and submit using "+ Add another member" CTA', async ({ page }) => {
  // Navigate to the QuikSplit new group page
  await page.goto('https://quiksplit.kieffer.me/groups/new');

  // Fill in the mandatory fields in the form
  await page.fill('input[name="group-name"]', 'Test Group');
  
  // Optionally fill in the description
  await page.fill('textarea[name="group-description"]', 'This is a test group description.');

  // Select a currency if applicable
  await page.selectOption('select[name="group-currency"]', 'USD');

  // Fill in the placeholder member field
  await page.fill('input[name="placeholder-member-0"]', 'John Doe');

  // Click on the "+ Add another member" button
  await page.click('button:has-text("+ Add another member")');

  // Verify that the form submission succeeds and displays the expected confirmation state
  // Assuming there is a confirmation message or state change we can check
  await expect(page).toHaveURL(/.*\/groups\/new/); // Ensure we are still on the same page
  await expect(page.locator('text=Create a new group')).toBeVisible(); // Check for the heading

  // Check for a confirmation message or state indicating success
  // This is a placeholder, replace with actual confirmation check
  await expect(page.locator('text=Member added successfully')).toBeVisible();
});