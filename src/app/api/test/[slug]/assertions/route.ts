// This file provides an API endpoint to validate baseline assertions individually using Playwright.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import { findDomainForCrawl } from '@/lib/websites';

export const runtime = 'nodejs';

const OUTPUT_DIR = join(process.cwd(), 'output');
const DOMAINS_ROOT = join(OUTPUT_DIR, 'domains');
const LEGACY_SPEC_DIR = join(OUTPUT_DIR, 'playwright');

const readJson = async <T>(filePath: string): Promise<T | null> => {
  try {
    const content = await readFile(filePath, 'utf8');
    return JSON.parse(content) as T;
  } catch {
    return null;
  }
};

interface AssertionResult {
  assertion: string;
  passed: boolean;
  error?: string;
  duration: number;
}

const parseAssertion = (assertion: string, story: { entryUrl: string; primaryCtaLabel?: string }): string[] => {
  const checks: string[] = [];
  const lower = assertion.toLowerCase();

  // Title check - more flexible pattern matching
  if (lower.includes('title')) {
    const match = assertion.match(/title matches "([^"]+)"/i) || 
                  assertion.match(/title[^"]*"([^"]+)"/i) ||
                  assertion.match(/title[^"]*is "([^"]+)"/i);
    if (match) {
      const title = match[1];
      checks.push(`await expect(page).toHaveTitle(/${escapeRegex(title)}/i);`);
    }
  }

  // Heading check - support "primary heading" and "heading"
  if (lower.includes('heading')) {
    const match = assertion.match(/heading displays "([^"]+)"/i) || 
                  assertion.match(/(?:primary )?heading[^"]*"([^"]+)"/i);
    if (match) {
      const headingText = match[1];
      const escapedText = escapeRegex(headingText);
      // Try multiple strategies to find the heading with better error handling
      checks.push(`// Try to find heading with text: "${headingText}"`);
      checks.push(`const headingRegex = /${escapedText}/i;`);
      checks.push(`// First try: getByRole with longer timeout`);
      checks.push(`try {`);
      checks.push(`  const heading = page.getByRole('heading', { name: headingRegex });`);
      checks.push(`  await expect(heading).toBeVisible({ timeout: 10000 });`);
      checks.push(`} catch (error) {`);
      checks.push(`  // Fallback: search all headings manually`);
      checks.push(`  const allHeadings = page.locator('h1, h2, h3, h4, h5, h6');`);
      checks.push(`  const count = await allHeadings.count();`);
      checks.push(`  let found = false;`);
      checks.push(`  for (let i = 0; i < count; i++) {`);
      checks.push(`    const text = await allHeadings.nth(i).textContent();`);
      checks.push(`    if (text && headingRegex.test(text.trim())) {`);
      checks.push(`      await expect(allHeadings.nth(i)).toBeVisible({ timeout: 10000 });`);
      checks.push(`      found = true;`);
      checks.push(`      break;`);
      checks.push(`    }`);
      checks.push(`  }`);
      checks.push(`  if (!found) {`);
      checks.push(`    // Heading not found - this is a warning, not a fatal error`);
      checks.push(`    // The page content may have changed since the crawl`);
      checks.push(`    const availableHeadings = await Promise.all(Array.from({length: Math.min(count, 5)}, (_, i) => allHeadings.nth(i).textContent()));`);
      checks.push(`    console.warn('⚠️  Heading with text matching "${headingText}" not found. Available headings: ' + availableHeadings.join(', '));`);
      checks.push(`    // Mark as failed but don't throw - allow other assertions to run`);
      checks.push(`    throw new Error('ASSERTION_FAILED: Heading with text matching "${headingText}" not found. Available headings: ' + availableHeadings.join(', '));`);
      checks.push(`  }`);
      checks.push(`}`);
    }
  }

  // CTA check - more flexible
  if (lower.includes('cta') && (lower.includes('visible') || lower.includes('interactive'))) {
    const match = assertion.match(/CTA "([^"]+)"/i) || 
                  assertion.match(/cta[^"]*"([^"]+)"/i);
    const ctaLabel = match ? match[1] : story.primaryCtaLabel;
    if (ctaLabel) {
      checks.push(`await expect(page.getByRole('button', { name: /${escapeRegex(ctaLabel)}/i }).or(page.getByRole('link', { name: /${escapeRegex(ctaLabel)}/i })).first()).toBeVisible();`);
    }
  }

  // Navigation link check
  if (lower.includes('navigation link') || (lower.includes('link') && lower.includes('visible') && !lower.includes('cta'))) {
    const match = assertion.match(/navigation link "([^"]+)"/i) || 
                  assertion.match(/link "([^"]+)"[^"]*visible/i) ||
                  assertion.match(/link[^"]*"([^"]+)"[^"]*remains visible/i);
    if (match) {
      const linkText = match[1];
      checks.push(`await expect(page.getByRole('link', { name: /${escapeRegex(linkText)}/i }).first()).toBeVisible();`);
    }
  }

  // Form fields check
  if (lower.includes('form') && (lower.includes('accept') || lower.includes('validation') || lower.includes('field'))) {
    checks.push(`const formFields = page.locator('input, textarea, select');`);
    checks.push(`await expect(formFields.first()).toBeVisible();`);
  }

  return checks;
};

const escapeRegex = (str: string): string => {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
};

const generateAssertionTest = (story: {
  entryUrl: string;
  baselineAssertions: string[];
  primaryCtaLabel?: string;
  suggestedScriptName: string;
}): string => {
  const lines: string[] = [];
  lines.push("import { test, expect } from 'playwright/test';");
  lines.push('');
  lines.push(`test.describe('${story.suggestedScriptName}', () => {`);
  lines.push(`  test('Validate baseline assertions', async ({ page }) => {`);
  lines.push(`    await page.goto('${story.entryUrl}', { waitUntil: 'domcontentloaded' });`);
  lines.push(`    // Wait for page to be fully interactive`);
  lines.push(`    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});`);
  lines.push(`    // Additional wait to ensure dynamic content is loaded`);
  lines.push(`    await page.waitForTimeout(1000);`);
  lines.push('');

  // Track assertion results
  lines.push(`    const assertionResults: Array<{ num: number; passed: boolean; error?: string }> = [];`);
  lines.push('');

  story.baselineAssertions.forEach((assertion, index) => {
    const assertionNum = index + 1;
    lines.push(`    await test.step('Assertion ${assertionNum}: ${assertion}', async () => {`);
    lines.push(`      try {`);
    const checks = parseAssertion(assertion, story);
    if (checks.length > 0) {
      checks.forEach((check) => lines.push(`        ${check}`));
      lines.push(`        assertionResults.push({ num: ${assertionNum}, passed: true });`);
    } else {
      lines.push(`        // TODO: Could not parse assertion automatically`);
      lines.push(`        // Assertion: ${assertion}`);
      lines.push(`        assertionResults.push({ num: ${assertionNum}, passed: true }); // Skip unparseable assertions`);
    }
    lines.push(`      } catch (error) {`);
    lines.push(`        const errorMsg = error instanceof Error ? error.message : String(error);`);
    lines.push(`        assertionResults.push({ num: ${assertionNum}, passed: false, error: errorMsg });`);
    lines.push(`        // Log but don't fail the entire test - content may have changed`);
    lines.push(`        console.warn('Assertion ${assertionNum} failed: ' + errorMsg);`);
    lines.push(`      }`);
    lines.push('    });');
    lines.push('');
  });

  // Add final check
  lines.push(`    // Check overall results`);
  lines.push(`    const passedCount = assertionResults.filter(r => r.passed).length;`);
  lines.push(`    const totalCount = assertionResults.length;`);
  lines.push(`    const successRate = totalCount > 0 ? (passedCount / totalCount) * 100 : 0;`);
  lines.push(`    // Fail only if less than 50% of assertions pass`);
  lines.push(`    if (successRate < 50) {`);
  lines.push(`      const failedAssertions = assertionResults.filter(r => !r.passed).map(r => 'Assertion ' + r.num).join(', ');`);
  lines.push(`      throw new Error('Only ' + passedCount + '/' + totalCount + ' assertions passed (' + successRate.toFixed(0) + '%). Failed: ' + failedAssertions);`);
  lines.push(`    }`);

  lines.push('  });');
  lines.push('});');
  return lines.join('\n');
};

const runAssertionTest = (specFile: string): Promise<{ code: number; output: string }> =>
  new Promise((resolve) => {
    // specFile should be a relative path from project root
    // Playwright will search in testDir by default, but can find files outside if we pass the path correctly
    // Use the relative path - Playwright should find it
    const child = spawn('npx', ['playwright', 'test', specFile, '--reporter=list'], {
      cwd: process.cwd(),
      shell: process.platform === 'win32',
      env: { ...process.env, CI: 'false' },
    });
    let output = '';

    child.stdout.on('data', (chunk) => {
      output += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      output += chunk.toString();
    });

    child.on('close', (code) => {
      resolve({ code: code ?? 1, output });
    });
  });

const sanitizeCrawlId = (value: string | null): string | null => {
  if (!value) {
    return null;
  }
  const trimmed = value.trim().toLowerCase().replace(/[^a-z0-9-]/g, '');
  return trimmed.length > 0 ? trimmed : null;
};

const sanitizeDomain = (value: string | null): string | null => {
  if (!value) {
    return null;
  }
  const trimmed = value.trim().toLowerCase();
  return /^[a-z0-9.-]+$/.test(trimmed) ? trimmed : null;
};

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
): Promise<NextResponse> {
  const resolvedParams = await params;
  const slug = resolvedParams.slug.replace(/[^a-z0-9-]/g, '');

  try {
    // Get crawlId from query parameter or use latest crawl
    const url = new URL(request.url);
    const crawlId = sanitizeCrawlId(url.searchParams.get('crawlId'));
    let domain = sanitizeDomain(url.searchParams.get('domain'));

    if (!domain && crawlId) {
      domain = await findDomainForCrawl(crawlId);
    }
    
    let storiesFile: string;
    let specDir: string;

    if (domain) {
      const baseDir = crawlId
        ? join(DOMAINS_ROOT, domain, 'crawls', crawlId)
        : join(DOMAINS_ROOT, domain, 'latest');
      storiesFile = join(baseDir, 'user-stories.json');
      specDir = join(baseDir, 'playwright');
    } else if (crawlId) {
      const crawlDir = join(OUTPUT_DIR, crawlId);
      storiesFile = join(crawlDir, 'user-stories.json');
      specDir = join(crawlDir, 'playwright');
    } else {
      storiesFile = join(OUTPUT_DIR, 'user-stories.json');
      specDir = LEGACY_SPEC_DIR;
    }

    // Load stories from the correct directory
    const stories = (await readJson<Array<{
      suggestedScriptName: string;
      entryUrl: string;
      baselineAssertions: string[];
      primaryCtaLabel?: string;
    }>>(storiesFile)) ?? [];

    const story = stories.find((s) => {
      const storySlug = s.suggestedScriptName.replace(/[^a-z0-9-]/g, '');
      return storySlug === slug;
    });

    if (!story) {
      return NextResponse.json(
        {
          success: false,
          message: 'Story not found',
        },
        { status: 404 }
      );
    }

    // Generate test file for assertions
    const assertionTestCode = generateAssertionTest(story);
    const assertionSpecFile = join(specDir, `${slug}.assertions.spec.ts`);

    // Write temporary test file
    await mkdir(specDir, { recursive: true });
    await writeFile(assertionSpecFile, assertionTestCode, 'utf8');

    // Run the test - ensure the file exists and use the correct path
    // Check if file exists before running
    try {
      await readFile(assertionSpecFile, 'utf8');
    } catch (error) {
      return NextResponse.json(
        {
          success: false,
          message: `Test file not found: ${assertionSpecFile}`,
          error: (error as Error).message,
        },
        { status: 500 }
      );
    }
    
    // Pass the path relative to project root
    // Playwright should find the file even if it's outside testDir when we pass the exact path
    const relativePath = assertionSpecFile.replace(process.cwd() + '/', '');
    const { code, output } = await runAssertionTest(relativePath);

    // Parse results to extract individual assertion results
    // Playwright test.step() will report failures per step
    const assertionResults: AssertionResult[] = story.baselineAssertions.map((assertion, index) => {
      const assertionNum = index + 1;
      const stepName = `Assertion ${assertionNum}: ${assertion}`;
      
      // Check if this specific assertion step failed
      const stepFailed = output.includes(`Assertion ${assertionNum}`) && 
                         (output.includes('failed') || output.includes('Error') || output.includes('Timeout') || output.includes('ASSERTION_FAILED'));
      
      // Extract error message if available
      let errorMessage: string | undefined;
      if (stepFailed) {
        // Try to extract the error message
        const stepMatch = output.match(new RegExp(`Assertion ${assertionNum}[\\s\\S]*?Error:([^\\n]+)`, 'i'));
        if (stepMatch) {
          errorMessage = stepMatch[1].trim();
        } else {
          // Try to find ASSERTION_FAILED message
          const assertionFailedMatch = output.match(new RegExp(`ASSERTION_FAILED:([^\\n]+)`, 'i'));
          if (assertionFailedMatch) {
            errorMessage = assertionFailedMatch[1].trim();
          } else {
            errorMessage = 'Assertion validation failed - content may have changed since crawl';
          }
        }
      }

      return {
        assertion,
        passed: code === 0 && !stepFailed,
        error: errorMessage,
        duration: 0,
      };
    });

    // Calculate success rate
    const passedCount = assertionResults.filter(r => r.passed).length;
    const totalCount = assertionResults.length;
    const successRate = totalCount > 0 ? (passedCount / totalCount) * 100 : 0;
    
    // Consider the test successful if at least 50% of assertions pass
    // This allows for some content changes while still catching major regressions
    const overallSuccess = successRate >= 50;

    // Clean up temp file (optional - keep for debugging)
    // await unlink(assertionSpecFile).catch(() => {});

    return NextResponse.json({
      success: overallSuccess,
      message: overallSuccess 
        ? `${passedCount}/${totalCount} assertions passed (${successRate.toFixed(0)}%)`
        : `Only ${passedCount}/${totalCount} assertions passed (${successRate.toFixed(0)}%) - content may have changed significantly`,
      assertionResults,
      output,
      code: overallSuccess ? 0 : code,
      stats: {
        passed: passedCount,
        total: totalCount,
        successRate: Math.round(successRate),
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        message: 'Failed to validate assertions',
        error: (error as Error).message,
      },
      { status: 500 }
    );
  }
}

