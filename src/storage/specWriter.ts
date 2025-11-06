// This file generates Playwright spec skeletons from user story metadata for repeatable regression checks.

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { UserStory } from '../types';
import { sanitizeFileSlug } from '../lib/sanitize';
import { logger } from '../utils/logger';

const OUTPUT_DIR = 'output/playwright';

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

export const persistSpecs = async (stories: readonly UserStory[]): Promise<void> => {
  await mkdir(OUTPUT_DIR, { recursive: true });

  await Promise.all(
    stories.map(async (story) => {
      const fileName = `${sanitizeFileSlug(story.suggestedScriptName, story.id)}.spec.ts`;
      const targetPath = join(OUTPUT_DIR, fileName);
      const content = buildSpecContent(story);
      await writeFile(targetPath, content);
      logger.info(`Generated Playwright spec skeleton at ${targetPath}`);
    })
  );
};
