import { mkdir, writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { logger } from '../utils/logger';
import { sanitizeFileSlug } from './sanitize';
import type { UserStory } from '../types';

const execAsync = promisify(exec);

export const saveTests = async (
    stories: UserStory[],
    generatedCodes: (string | null)[],
    crawlDir: string
): Promise<void> => {
    const testsDir = join(crawlDir, 'playwright');
    await mkdir(testsDir, { recursive: true });

    for (let i = 0; i < stories.length; i++) {
        const story = stories[i];
        const code = generatedCodes[i];

        if (!code) continue;

        const filename = `${sanitizeFileSlug(story.suggestedScriptName, story.id)}.spec.ts`;
        const filepath = join(testsDir, filename);

        try {
            await writeFile(filepath, code, 'utf-8');
            logger.info(`Saved test: ${filename}`);
        } catch (error) {
            logger.error(`Failed to save test ${filename}: ${(error as Error).message}`);
        }
    }
};

export const runTests = async (crawlDir: string): Promise<void> => {
    logger.info('Running generated Playwright tests...');
    const testsDir = join(crawlDir, 'playwright');
    const configPath = join(crawlDir, 'playwright.config.cjs');

    const configContent = `
const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './playwright',
  testMatch: '**/*.spec.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: 'list',
  use: {
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
`;

    try {
        await writeFile(configPath, configContent, 'utf-8');
        const { stdout, stderr } = await execAsync(`npx playwright test -c ${configPath}`, { cwd: process.cwd() });
        logger.info(stdout);
        if (stderr) logger.warn(stderr);
    } catch (error) {
        logger.error(`Playwright tests failed: ${(error as Error).message}`);
        if ((error as any).stdout) logger.info((error as any).stdout);
        if ((error as any).stderr) logger.error((error as any).stderr);
    } finally {
        try {
            await unlink(configPath);
        } catch {
            // Ignore cleanup error
        }
    }
};
