// This file is auto-generated to provide a baseline Playwright regression outline.
import { test, expect } from 'playwright/test';

test.describe('Sparkier - Créez votre boutique de conseil en ligne | Vendez vos Sparks', () => {
  test('Primary interaction completes without errors by activating "Voir un exemple".', async ({ page }) => {
    await page.goto('https://www.sparkier.io/consultants', { waitUntil: 'networkidle' });
    await expect(page).toHaveTitle(/Sparkier - Créez votre boutique de conseil en ligne \| Vendez vos Sparks/i);
    await expect(page.getByRole('heading', { level: 1, name: /La boutique du consulting/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /Sparkier/i }).first()).toBeVisible();
    // Persona focus: design.
    const cta = page.locator('main, [role="main"]').getByRole('button', { name: /Voir un exemple/i }).or(page.locator('main, [role="main"]').getByRole('link', { name: /Voir un exemple/i })).first();
    await expect(cta).toBeVisible();
    await cta.click();
    // Verify navigation after performing the primary action.
    await expect(page).toHaveURL(/https:\/\/www\.sparkier\.io\//); // adjust expected destination if necessary
    // --- Baseline Assertions ---
    // - Title matches "Sparkier - Créez votre boutique de conseil en ligne | Vendez vos Sparks".
    // - Primary heading displays "La boutique du consulting".
    // - CTA "Voir un exemple" is visible and interactive.
    // - Navigation link "Sparkier" remains visible.
    // --- Repeatability Notes ---
    // - No special setup required; verify target environment stability before regression runs.
    // Verification status: UNVERIFIED. Update after validating the scenario.
    // Expected outcome: Primary interaction completes without errors by activating "Voir un exemple".
  });
});
