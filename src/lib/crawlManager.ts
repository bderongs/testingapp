// This file manages concurrent crawls with unique IDs, persists session metadata, and limits the number of simultaneous crawls.

import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { syncCrawlSessionRecord } from '@/storage/siteRegistry';

export interface CrawlSession {
  id: string;
  url: string;
  domain: string;
  maxPages: number;
  sameOriginOnly: boolean;
  status: 'pending' | 'running' | 'completed' | 'failed';
  createdAt: Date;
  completedAt?: Date;
  error?: string;
}

// Maximum number of concurrent crawls
const MAX_CONCURRENT_CRAWLS = 3;

// In-memory store of active crawls
const activeCrawls = new Map<string, CrawlSession>();
const crawlQueue: CrawlSession[] = [];
const OUTPUT_DIR = join(process.cwd(), 'output');

const buildSessionPayload = (session: CrawlSession): string =>
  JSON.stringify(
    {
      id: session.id,
      url: session.url,
      domain: session.domain,
      maxPages: session.maxPages,
      sameOriginOnly: session.sameOriginOnly,
      status: session.status,
      createdAt: session.createdAt.toISOString(),
      completedAt: session.completedAt ? session.completedAt.toISOString() : null,
      error: session.error ?? null,
    },
    null,
    2
  );

const ensureDomain = (targetUrl: string): string => {
  try {
    const parsed = new URL(targetUrl);
    return parsed.hostname.toLowerCase();
  } catch {
    return 'unknown-domain';
  }
};

const getSessionDir = (session: CrawlSession): string =>
  join(OUTPUT_DIR, 'domains', session.domain, 'crawls', session.id);

export const persistCrawlSessionSnapshot = async (session: CrawlSession): Promise<void> => {
  const crawlDir = getSessionDir(session);
  await mkdir(crawlDir, { recursive: true });
  await writeFile(join(crawlDir, 'session.json'), `${buildSessionPayload(session)}\n`);

  // Maintain legacy layout for backwards compatibility
  const legacyDir = join(OUTPUT_DIR, session.id);
  await mkdir(legacyDir, { recursive: true });
  await writeFile(join(legacyDir, 'session.json'), `${buildSessionPayload(session)}\n`);

  void syncCrawlSessionRecord(session);
};

/**
 * Creates a new crawl session and returns its ID.
 * Returns null if the maximum number of concurrent crawls is reached.
 */
export const createCrawlSession = (
  url: string,
  maxPages: number,
  sameOriginOnly: boolean
): { session: CrawlSession; queued: boolean } | null => {
  const runningCount = Array.from(activeCrawls.values()).filter(
    (crawl) => crawl.status === 'running'
  ).length;

  if (runningCount >= MAX_CONCURRENT_CRAWLS) {
    // Create session but mark as queued
    const session: CrawlSession = {
      id: randomUUID(),
      url,
      domain: ensureDomain(url),
      maxPages,
      sameOriginOnly,
      status: 'pending',
      createdAt: new Date(),
    };
    crawlQueue.push(session);
    activeCrawls.set(session.id, session);
    void syncCrawlSessionRecord(session);
    return { session, queued: true };
  }

  // Create session and mark as running immediately
  const session: CrawlSession = {
    id: randomUUID(),
    url,
    domain: ensureDomain(url),
    maxPages,
    sameOriginOnly,
    status: 'running',
    createdAt: new Date(),
  };
  activeCrawls.set(session.id, session);
  void syncCrawlSessionRecord(session);
  return { session, queued: false };
};

/**
 * Marks a crawl session as completed or failed.
 */
export const completeCrawlSession = (crawlId: string, success: boolean, error?: string): void => {
  const session = activeCrawls.get(crawlId);
  if (!session) {
    return;
  }

  session.status = success ? 'completed' : 'failed';
  session.completedAt = new Date();
  if (error) {
    session.error = error;
  }

  // Process next crawl in queue
  processNextCrawl();
  void persistCrawlSessionSnapshot(session);
};

/**
 * Processes the next crawl in the queue if there's capacity.
 */
const processNextCrawl = (): void => {
  const runningCount = Array.from(activeCrawls.values()).filter(
    (crawl) => crawl.status === 'running'
  ).length;

  if (runningCount >= MAX_CONCURRENT_CRAWLS || crawlQueue.length === 0) {
    return;
  }

  const nextCrawl = crawlQueue.shift();
  if (nextCrawl) {
    nextCrawl.status = 'running';
    void persistCrawlSessionSnapshot(nextCrawl);
  }
};

/**
 * Gets a crawl session by ID.
 */
export const getCrawlSession = (crawlId: string): CrawlSession | undefined => {
  return activeCrawls.get(crawlId);
};

/**
 * Gets all crawl sessions (for debugging/admin purposes).
 */
export const getAllCrawlSessions = (): CrawlSession[] => {
  return Array.from(activeCrawls.values());
};

/**
 * Cleans up old completed crawls (older than 1 hour).
 */
export const cleanupOldCrawls = (): void => {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  
  for (const [id, session] of activeCrawls.entries()) {
    if (
      (session.status === 'completed' || session.status === 'failed') &&
      session.completedAt &&
      session.completedAt < oneHourAgo
    ) {
      activeCrawls.delete(id);
    }
  }
};

