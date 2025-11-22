// This file provides the CLI entry point that orchestrates crawling and user story identification for a target site.

import { z } from 'zod';

import type { CrawlOptions, Cookie } from './types';
import { crawlSite } from './lib/crawler';
import { identifyUserStories } from './lib/storyBuilder';
import { persistArtifacts } from './storage/fileWriter';
import { logger } from './utils/logger';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const rawArgsToRecord = (argv: readonly string[]): Record<string, string | boolean | number> => {
  const result: Record<string, string | boolean | number> = {};

  argv.forEach((token) => {
    if (!token.startsWith('--')) {
      return;
    }

    const [keyPart, valuePart] = token.slice(2).split('=');
    const key = keyPart.trim();
    const value = valuePart?.trim();

    if (value === undefined) {
      result[key] = true;
      return;
    }

    if (value === 'true' || value === 'false') {
      result[key] = value === 'true';
      return;
    }

    const maybeNumber = Number(value);
    if (!Number.isNaN(maybeNumber) && value !== '') {
      result[key] = maybeNumber;
      return;
    }

    result[key] = value;
  });

  return result;
};

const argsSchema = z.object({
  url: z.string().url({ message: 'Please provide a valid --url parameter.' }),
  'max-pages': z.number().int().positive().max(200).optional(),
  'same-origin-only': z.boolean().optional(),
  'navigation-timeout': z.number().int().positive().optional(),
  'crawl-id': z.string().optional(),
  'cookies-file': z.string().optional(),
  'generate-tests': z.boolean().optional(),
  'run-tests': z.boolean().optional(),
});

const mapArgsToOptions = async (parsed: z.infer<typeof argsSchema>): Promise<CrawlOptions> => {
  let cookies: readonly Cookie[] | undefined;

  // Load cookies from file if provided
  if (parsed['cookies-file']) {
    try {
      const { readFile } = await import('node:fs/promises');
      const cookiesContent = await readFile(parsed['cookies-file'], 'utf-8');
      cookies = JSON.parse(cookiesContent) as readonly Cookie[];
    } catch (error) {
      logger.warn(`Failed to load cookies from file: ${(error as Error).message}`);
    }
  }

  return {
    baseUrl: parsed.url,
    maxPages: parsed['max-pages'],
    sameOriginOnly: parsed['same-origin-only'],
    navigationTimeoutMs: parsed['navigation-timeout'],
    cookies,
  };
};

const printUsage = (): void => {
  logger.info(
    'Usage: tsx src/index.ts --url=https://example.com [--max-pages=40] [--same-origin-only=false] [--navigation-timeout=15000] [--generate-tests] [--run-tests]'
  );
};

const main = async (): Promise<void> => {
  const raw = rawArgsToRecord(process.argv.slice(2));

  const parseResult = argsSchema.safeParse(raw);
  if (!parseResult.success) {
    logger.error(parseResult.error.errors.map((issue) => issue.message).join('; '));
    printUsage();
    process.exitCode = 1;
    return;
  }

  const options = await mapArgsToOptions(parseResult.data);
  const crawlId = parseResult.data['crawl-id'];
  const shouldGenerateTests = parseResult.data['generate-tests'];
  const shouldRunTests = parseResult.data['run-tests'];

  logger.info(`Starting crawl for ${options.baseUrl}${crawlId ? ` (crawl ID: ${crawlId})` : ''}`);
  if (options.cookies && options.cookies.length > 0) {
    logger.info(`Using ${options.cookies.length} cookie(s) for authenticated crawling`);
  }

  const crawl = await crawlSite(options);
  const userStories = identifyUserStories(crawl);

  const crawlDir = await persistArtifacts({ crawl, userStories }, crawlId);

  logger.info(`Crawl complete. ${crawl.pages.size} page(s) mapped.`);
  logger.info(`Identified ${userStories.length} user stor${userStories.length === 1 ? 'y' : 'ies'}.`);

  if (shouldGenerateTests) {
    logger.info('Generating Playwright tests for identified stories...');
    const { generatePlaywrightTest } = await import('./lib/testGenerator');
    const { saveTests } = await import('./lib/testRunner');

    const generatedCodes = await Promise.all(
      userStories.map(async (story) => {
        const page = crawl.pages.get(story.entryUrl);
        if (!page) return null;
        return generatePlaywrightTest(story, page);
      })
    );

    await saveTests(userStories, generatedCodes, crawlDir);
    logger.info('Test generation complete.');
  }

  if (shouldRunTests) {
    const { runTests } = await import('./lib/testRunner');
    await runTests(crawlDir);
  }
};

main().catch((error: unknown) => {
  logger.error(`Unexpected failure: ${(error as Error).message}`);
  process.exitCode = 1;
});
