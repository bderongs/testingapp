// This file provides an API endpoint to validate baseline assertions individually using Playwright.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { writeFile, mkdir } from 'node:fs/promises';

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export const runtime = 'nodejs';

const STORIES_FILE = join(process.cwd(), 'output', 'user-stories.json');
const SPEC_DIR = join(process.cwd(), 'output', 'playwright');

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
      // Try different heading levels
      checks.push(`await expect(page.getByRole('heading', { name: /${escapeRegex(headingText)}/i })).toBeVisible();`);
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
  lines.push(`    await page.goto('${story.entryUrl}', { waitUntil: 'networkidle' });`);
  lines.push('');

  story.baselineAssertions.forEach((assertion, index) => {
    const assertionNum = index + 1;
    lines.push(`    await test.step('Assertion ${assertionNum}: ${assertion}', async () => {`);
    const checks = parseAssertion(assertion, story);
    if (checks.length > 0) {
      checks.forEach((check) => lines.push(`      ${check}`));
    } else {
      lines.push(`      // TODO: Could not parse assertion automatically`);
      lines.push(`      // Assertion: ${assertion}`);
    }
    lines.push('    });');
    lines.push('');
  });

  lines.push('  });');
  lines.push('});');
  return lines.join('\n');
};

const runAssertionTest = (specFile: string): Promise<{ code: number; output: string }> =>
  new Promise((resolve) => {
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

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
): Promise<NextResponse> {
  const resolvedParams = await params;
  const slug = resolvedParams.slug.replace(/[^a-z0-9-]/g, '');

  try {
    // Load stories
    const stories = (await readJson<Array<{
      suggestedScriptName: string;
      entryUrl: string;
      baselineAssertions: string[];
      primaryCtaLabel?: string;
    }>>(STORIES_FILE)) ?? [];

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
    const assertionSpecFile = join(SPEC_DIR, `${slug}.assertions.spec.ts`);

    // Write temporary test file
    await mkdir(SPEC_DIR, { recursive: true });
    await writeFile(assertionSpecFile, assertionTestCode, 'utf8');

    // Run the test
    const { code, output } = await runAssertionTest(assertionSpecFile);

    // Parse results to extract individual assertion results
    // Playwright test.step() will report failures per step
    const assertionResults: AssertionResult[] = story.baselineAssertions.map((assertion, index) => {
      const assertionNum = index + 1;
      const stepName = `Assertion ${assertionNum}: ${assertion}`;
      
      // Check if this specific assertion step failed
      const stepFailed = output.includes(`Assertion ${assertionNum}`) && 
                         (output.includes('failed') || output.includes('Error') || output.includes('Timeout'));
      
      // Extract error message if available
      let errorMessage: string | undefined;
      if (stepFailed) {
        const stepMatch = output.match(new RegExp(`Assertion ${assertionNum}[\\s\\S]*?Error:([^\\n]+)`, 'i'));
        if (stepMatch) {
          errorMessage = stepMatch[1].trim();
        } else {
          errorMessage = 'Assertion validation failed';
        }
      }

      return {
        assertion,
        passed: code === 0 && !stepFailed,
        error: errorMessage,
        duration: 0,
      };
    });

    // Clean up temp file (optional - keep for debugging)
    // await unlink(assertionSpecFile).catch(() => {});

    return NextResponse.json({
      success: code === 0,
      message: code === 0 ? 'All assertions passed' : 'Some assertions failed',
      assertionResults,
      output,
      code,
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

