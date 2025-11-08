// This file maintains a registry of crawled websites and their historical crawl metadata for quick lookups.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

import type { CrawlSession } from '@/lib/crawlManager';

const OUTPUT_ROOT = join(process.cwd(), 'output');
const SITES_DIR = join(OUTPUT_ROOT, 'domains');
const REGISTRY_PATH = join(SITES_DIR, 'registry.json');

export interface WebsiteCrawlRecord {
  crawlId: string;
  createdAt: string;
  status: CrawlSession['status'];
}

interface WebsiteEntry {
  domain: string;
  baseUrls: string[];
  latestCrawlId?: string;
  latestCrawlAt?: string;
  crawls: WebsiteCrawlRecord[];
}

export interface CrawlIndexEntry extends WebsiteCrawlRecord {
  domain: string;
}

interface WebsiteRegistry {
  version: 1;
  websites: Record<string, WebsiteEntry>;
  crawlIndex: Record<string, CrawlIndexEntry>;
}

const emptyRegistry = (): WebsiteRegistry => ({
  version: 1,
  websites: {},
  crawlIndex: {},
});

const loadRegistry = async (): Promise<WebsiteRegistry> => {
  try {
    const raw = await readFile(REGISTRY_PATH, 'utf8');
    return JSON.parse(raw) as WebsiteRegistry;
  } catch {
    return emptyRegistry();
  }
};

const saveRegistry = async (registry: WebsiteRegistry): Promise<void> => {
  await mkdir(SITES_DIR, { recursive: true });
  await writeFile(REGISTRY_PATH, `${JSON.stringify(registry, null, 2)}\n`, 'utf8');
};

const ensureWebsiteEntry = (registry: WebsiteRegistry, domain: string): WebsiteEntry => {
  if (!registry.websites[domain]) {
    registry.websites[domain] = {
      domain,
      baseUrls: [],
      crawls: [],
    };
  }
  return registry.websites[domain];
};

const upsertBaseUrl = (entry: WebsiteEntry, baseUrl: string | undefined): void => {
  if (!baseUrl) {
    return;
  }

  if (!entry.baseUrls.includes(baseUrl)) {
    entry.baseUrls.push(baseUrl);
  }
};

export interface WebsiteSummary {
  domain: string;
  baseUrls: string[];
  latestCrawlId?: string;
  latestCrawlAt?: string;
  crawlCount: number;
}

export const listWebsites = async (): Promise<WebsiteSummary[]> => {
  const registry = await loadRegistry();
  return Object.values(registry.websites)
    .map((entry) => ({
      domain: entry.domain,
      baseUrls: entry.baseUrls,
      latestCrawlId: entry.latestCrawlId,
      latestCrawlAt: entry.latestCrawlAt,
      crawlCount: entry.crawls.length,
    }))
    .sort((a, b) => a.domain.localeCompare(b.domain));
};

export const listCrawlsForDomain = async (domain: string): Promise<WebsiteCrawlRecord[]> => {
  const registry = await loadRegistry();
  const entry = registry.websites[domain];
  if (!entry) {
    return [];
  }
  return [...entry.crawls].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
};

export const findCrawlById = async (crawlId: string): Promise<CrawlIndexEntry | null> => {
  if (!crawlId) {
    return null;
  }
  const registry = await loadRegistry();
  return registry.crawlIndex[crawlId] ?? null;
};

export const getWebsiteMetadata = async (domain: string): Promise<WebsiteEntry | null> => {
  const registry = await loadRegistry();
  return registry.websites[domain] ?? null;
};

export const syncCrawlSessionRecord = async (session: CrawlSession): Promise<void> => {
  const registry = await loadRegistry();
  const domainEntry = ensureWebsiteEntry(registry, session.domain);

  upsertBaseUrl(domainEntry, session.url);

  const existingIndex = domainEntry.crawls.findIndex((record) => record.crawlId === session.id);
  const createdAt = existingIndex >= 0 ? domainEntry.crawls[existingIndex].createdAt : session.createdAt.toISOString();
  const nextRecord: WebsiteCrawlRecord = {
    crawlId: session.id,
    createdAt,
    status: session.status,
  };

  if (existingIndex >= 0) {
    domainEntry.crawls[existingIndex] = nextRecord;
  } else {
    domainEntry.crawls.push(nextRecord);
  }

  domainEntry.crawls.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  if (session.status === 'completed') {
    domainEntry.latestCrawlId = session.id;
    domainEntry.latestCrawlAt = createdAt;
  } else if (!domainEntry.latestCrawlId) {
    domainEntry.latestCrawlId = domainEntry.crawls[0]?.crawlId;
    domainEntry.latestCrawlAt = domainEntry.crawls[0]?.createdAt;
  }

  registry.crawlIndex[session.id] = {
    crawlId: session.id,
    domain: session.domain,
    createdAt,
    status: session.status,
  };

  await saveRegistry(registry);
};

export const registerWebsiteBaseUrl = async (domain: string, baseUrl: string): Promise<void> => {
  const registry = await loadRegistry();
  const entry = ensureWebsiteEntry(registry, domain);
  upsertBaseUrl(entry, baseUrl);
  await saveRegistry(registry);
};

