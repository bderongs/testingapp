// This file generates Playwright spec skeletons from user story metadata for repeatable regression checks.

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { UserStory } from '../types';
import { sanitizeFileSlug } from '../lib/sanitize';
import { logger } from '../utils/logger';

const DEFAULT_OUTPUT_DIR = 'output/playwright';

const escapeForSingleQuote = (input: string): string => input.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

const formatCommentList = (heading: string, items: readonly string[]): string[] => {
  if (!items.length) {
    return [];
  }

  const lines = [`    // --- ${heading} ---`];
  items.forEach((item) => {
    lines.push(`    // - ${item}`);
  });
  return lines;
};

const buildSpecContent = (story: UserStory): string => {
  const specLines: string[] = [];
  specLines.push('// This file is auto-generated to provide a baseline Playwright regression outline.');
  specLines.push("import { test, expect } from 'playwright/test';");
  specLines.push('');

  const describeTitle = escapeForSingleQuote(story.title);
  const testTitle = escapeForSingleQuote(story.expectedOutcome || 'Regression scenario');

  specLines.push(`test.describe('${describeTitle}', () => {`);
  specLines.push(`  test('${testTitle}', async ({ page }) => {`);

  story.playwrightOutline.forEach((step) => {
    specLines.push(`    ${step}`);
  });

  specLines.push(...formatCommentList('Baseline Assertions', story.baselineAssertions));
  specLines.push(...formatCommentList('Repeatability Notes', story.repeatabilityNotes));

  specLines.push(`    // Verification status: ${story.verificationStatus.toUpperCase()}. Update after validating the scenario.`);
  if (story.expectedOutcome) {
    specLines.push(`    // Expected outcome: ${story.expectedOutcome}`);
  }

  specLines.push('  });');
  specLines.push('});');
  specLines.push('');

  return specLines.join('\n');
};

/**
 * Persists Playwright spec files to the specified directory.
 * If no directory is provided, uses the default output/playwright directory.
 */
export const persistSpecs = async (
  stories: readonly UserStory[],
  outputDir: string = DEFAULT_OUTPUT_DIR
): Promise<void> => {
  await mkdir(outputDir, { recursive: true });

  await Promise.all(
    stories.map(async (story) => {
      const fileName = `${sanitizeFileSlug(story.suggestedScriptName, story.id)}.spec.ts`;
      const targetPath = join(outputDir, fileName);
      const content = buildSpecContent(story);
      await writeFile(targetPath, content);
      logger.info(`Generated Playwright spec skeleton at ${targetPath}`);
    })
  );
};
