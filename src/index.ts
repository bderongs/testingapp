// This file provides the CLI entry point that orchestrates crawling and user story identification for a target site.

import { z } from 'zod';

import type { CrawlOptions } from './types';
import { crawlSite } from './lib/crawler';
import { identifyUserStories } from './lib/storyBuilder';
import { persistArtifacts } from './storage/fileWriter';
import { logger } from './utils/logger';

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
});

const mapArgsToOptions = (parsed: z.infer<typeof argsSchema>): CrawlOptions => ({
  baseUrl: parsed.url,
  maxPages: parsed['max-pages'],
  sameOriginOnly: parsed['same-origin-only'],
  navigationTimeoutMs: parsed['navigation-timeout'],
});

const printUsage = (): void => {
  logger.info(
    'Usage: tsx src/index.ts --url=https://example.com [--max-pages=40] [--same-origin-only=false] [--navigation-timeout=15000]'
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

  const options = mapArgsToOptions(parseResult.data);

  logger.info(`Starting crawl for ${options.baseUrl}`);

  const crawl = await crawlSite(options);
  const userStories = identifyUserStories(crawl);

  await persistArtifacts({ crawl, userStories });

  logger.info(`Crawl complete. ${crawl.pages.size} page(s) mapped.`);
  logger.info(`Identified ${userStories.length} user stor${userStories.length === 1 ? 'y' : 'ies'}.`);
};

main().catch((error: unknown) => {
  logger.error(`Unexpected failure: ${(error as Error).message}`);
  process.exitCode = 1;
});
