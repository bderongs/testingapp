// This file manages concurrent crawls with unique IDs and limits the number of simultaneous crawls.

import { randomUUID } from 'node:crypto';

export interface CrawlSession {
  id: string;
  url: string;
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
      maxPages,
      sameOriginOnly,
      status: 'pending',
      createdAt: new Date(),
    };
    crawlQueue.push(session);
    activeCrawls.set(session.id, session);
    return { session, queued: true };
  }

  // Create session and mark as running immediately
  const session: CrawlSession = {
    id: randomUUID(),
    url,
    maxPages,
    sameOriginOnly,
    status: 'running',
    createdAt: new Date(),
  };
  activeCrawls.set(session.id, session);
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

