// This file is auto-generated to provide a baseline Playwright regression outline.
import { test, expect } from 'playwright/test';

test.describe('Sparkier - Boostez votre activité avec les Sparks', () => {
  test('Review frequently asked questions', async ({ page }) => {
    await page.goto('https://www.sparkier.io/', { waitUntil: 'networkidle' });
    await expect(page).toHaveTitle(/Sparkier - Boostez votre activité avec les Sparks/i);
    await expect(page.getByRole('heading', { level: 1, name: /Débloquez vos décisions stratégiques en 1h/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /Sparkier/i }).first()).toBeVisible();
    // Persona focus: marketing.
    // Goal: Review frequently asked questions.
    const cta = page.locator('main, [role="main"]').getByRole('button', { name: /Discuter avec notre équipe/i }).or(page.locator('main, [role="main"]').getByRole('link', { name: /Discuter avec notre équipe/i })).first();
    await expect(cta).toBeVisible();
    await cta.click();
    // Verify navigation after performing the primary action.
    await expect(page).toHaveURL(/https:\/\/www\.sparkier\.io\//); // adjust expected destination if necessary
    // --- Baseline Assertions ---
    // - Title matches "Sparkier - Boostez votre activité avec les Sparks".
    // - Primary heading displays "Débloquez vos décisions stratégiques en 1h".
    // - CTA "Discuter avec notre équipe" is visible and interactive.
    // - Navigation link "Sparkier" remains visible.
    // --- Repeatability Notes ---
    // - No special setup required; verify target environment stability before regression runs.
    // Verification status: UNVERIFIED. Update after validating the scenario.
    // Expected outcome: Review frequently asked questions
  });
});