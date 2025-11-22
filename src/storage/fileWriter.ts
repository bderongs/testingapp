// This file handles persistence of crawl and user story artifacts onto the local filesystem, grouped by website domain.

import { mkdir, writeFile, cp, rm } from 'node:fs/promises';
import { join } from 'node:path';

import type { AuditArtifacts } from '../types';
import { logger } from '../utils/logger';
import { persistSpecs } from './specWriter';
import { upsertWebsiteRecord } from './websiteRegistry';

const OUTPUT_ROOT = 'output';
const DOMAINS_ROOT = join(OUTPUT_ROOT, 'domains');

const deriveDomain = (url: string): string => {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return 'unknown-domain';
  }
};

const ensureCrawlId = (): string => `legacy-${Date.now()}`;

const replicateSnapshot = async (sourceDir: string, targetDir: string): Promise<void> => {
  await rm(targetDir, { recursive: true, force: true });
  await mkdir(targetDir, { recursive: true });
  await cp(sourceDir, targetDir, { recursive: true, force: true });
};

/**
 * Persists crawl artifacts under both domain-aware paths and legacy crawl directories.
 */
export const persistArtifacts = async (
  artifacts: AuditArtifacts,
  crawlId?: string
): Promise<string> => {
  const domain = deriveDomain(artifacts.crawl.baseUrl);
  const resolvedCrawlId = crawlId ?? ensureCrawlId();
  const timestamp = new Date().toISOString();

  const domainRoot = join(DOMAINS_ROOT, domain);
  const crawlDir = join(domainRoot, 'crawls', resolvedCrawlId);
  const latestDir = join(domainRoot, 'latest');
  const legacyDir = join(OUTPUT_ROOT, resolvedCrawlId);

  await mkdir(crawlDir, { recursive: true });

  const crawlPayload = JSON.stringify(
    {
      baseUrl: artifacts.crawl.baseUrl,
      pendingUrls: artifacts.crawl.pendingUrls,
      pages: Array.from(artifacts.crawl.pages.values()),
      edges: Array.from(artifacts.crawl.edges.entries()).map(([source, targets]) => ({
        source,
        targets,
      })),
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

  const sessionSnapshot = {
    id: resolvedCrawlId,
    url: artifacts.crawl.baseUrl,
    status: 'completed' as const,
    createdAt: timestamp,
    completedAt: timestamp,
  };

  await writeFile(join(crawlDir, 'session.json'), `${JSON.stringify(sessionSnapshot, null, 2)}\n`);

  // const domainSpecsDir = join(crawlDir, 'playwright');
  // await persistSpecs(artifacts.userStories, domainSpecsDir);

  // Maintain convenience snapshots
  await replicateSnapshot(crawlDir, latestDir);
  await replicateSnapshot(crawlDir, legacyDir);

  await upsertWebsiteRecord({
    domain,
    baseUrl: artifacts.crawl.baseUrl,
    crawlId: resolvedCrawlId,
    crawlDir,
    timestamp,
  });

  return crawlDir;
};
