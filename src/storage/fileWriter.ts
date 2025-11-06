// This file handles persistence of crawl and user story artifacts onto the local filesystem.

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { AuditArtifacts } from '../types';
import { logger } from '../utils/logger';
import { persistSpecs } from './specWriter';

const OUTPUT_DIR = 'output';

/**
 * Persists crawl artifacts to isolated directories based on crawlId.
 * If crawlId is provided, files are stored in output/{crawlId}/, otherwise in output/ (legacy mode).
 */
export const persistArtifacts = async (
  artifacts: AuditArtifacts,
  crawlId?: string
): Promise<void> => {
  const crawlDir = crawlId ? join(OUTPUT_DIR, crawlId) : OUTPUT_DIR;
  await mkdir(crawlDir, { recursive: true });

  const crawlPayload = JSON.stringify(
    {
      baseUrl: artifacts.crawl.baseUrl,
      pages: Array.from(artifacts.crawl.pages.values()),
      edges: Array.from(artifacts.crawl.edges.entries()).map(([source, targets]) => ({ source, targets })),
    },
    null,
    2
  );

  const storiesPayload = JSON.stringify(artifacts.userStories, null, 2);

  await Promise.all([
    writeFile(join(crawlDir, 'site-map.json'), `${crawlPayload}\n`),
    writeFile(join(crawlDir, 'user-stories.json'), `${storiesPayload}\n`),
  ]);

  logger.info(
    `Artifacts saved to ${crawlDir}/site-map.json and ${crawlDir}/user-stories.json`
  );

  const specsDir = crawlId ? join(crawlDir, 'playwright') : join(OUTPUT_DIR, 'playwright');
  await persistSpecs(artifacts.userStories, specsDir);
};
