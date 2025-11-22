import { test, expect } from '@playwright/test';

test('interaction-new-group', async ({ page }) => {
  // Navigate to the QuikSplit groups page
  await page.goto('https://quiksplit.kieffer.me/groups');

  // Click on the "New Group" link
  const newGroupLink = page.locator('text=New Group');
  await newGroupLink.click();

  // Verify that the "Create a group" action is available
  const createGroupLink = page.locator('text=Create a group');
  await expect(createGroupLink).toBeVisible();

  // Click on the "Create a group" link to complete the primary interaction
  await createGroupLink.click();

  // Verify that the page navigates to a new group creation page or shows a form
  // Assuming the new page or form has a heading or element that confirms the action
  const newGroupHeading = page.locator('h1:has-text("Create a New Group")');
  await expect(newGroupHeading).toBeVisible();
});