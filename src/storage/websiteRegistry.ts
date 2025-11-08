// This file manages domain-scoped crawl metadata and discovery of available websites.

import { mkdir, readFile, writeFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

const OUTPUT_DIR = join(process.cwd(), 'output');
const WEBSITES_DIR = join(OUTPUT_DIR, 'domains');
const REGISTRY_FILE = join(WEBSITES_DIR, 'websites.json');

export interface WebsiteRecord {
  domain: string;
  baseUrl: string;
  firstCrawlAt: string;
  lastCrawlAt: string;
  lastCrawlId: string | null;
  lastCrawlDir: string | null;
  crawlCount: number;
}

export interface CrawlSummary {
  crawlId: string;
  createdAt: string | null;
  completedAt: string | null;
  directory: string;
  isLatest: boolean;
}

interface RegistryPayload {
  websites: WebsiteRecord[];
}

const readRegistry = async (): Promise<WebsiteRecord[]> => {
  try {
    const raw = await readFile(REGISTRY_FILE, 'utf8');
    const payload = JSON.parse(raw) as RegistryPayload;
    return payload.websites;
  } catch {
    return [];
  }
};

const writeRegistry = async (records: WebsiteRecord[]): Promise<void> => {
  await mkdir(WEBSITES_DIR, { recursive: true });
  const payload: RegistryPayload = { websites: records };
  await writeFile(REGISTRY_FILE, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
};

const normaliseDomain = (input: string): string =>
  input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9.-]/g, '')
    .replace(/^\.+|\.+$/g, '');

export const upsertWebsiteRecord = async ({
  domain,
  baseUrl,
  crawlId,
  crawlDir,
  timestamp,
}: {
  domain: string;
  baseUrl: string;
  crawlId: string | null;
  crawlDir: string | null;
  timestamp: string;
}): Promise<void> => {
  const canonicalDomain = normaliseDomain(domain);
  if (!canonicalDomain) {
    return;
  }

  const records = await readRegistry();
  const existingIndex = records.findIndex((record) => record.domain === canonicalDomain);

  if (existingIndex === -1) {
    records.push({
      domain: canonicalDomain,
      baseUrl,
      firstCrawlAt: timestamp,
      lastCrawlAt: timestamp,
      lastCrawlId: crawlId,
      lastCrawlDir: crawlDir,
      crawlCount: crawlId ? 1 : 0,
    });
  } else {
    const existing = records[existingIndex];
    const increment = crawlId && existing.lastCrawlId !== crawlId ? existing.crawlCount + 1 : existing.crawlCount;
    records[existingIndex] = {
      ...existing,
      baseUrl,
      lastCrawlAt: timestamp,
      lastCrawlId: crawlId ?? existing.lastCrawlId,
      lastCrawlDir: crawlDir ?? existing.lastCrawlDir,
      crawlCount: crawlId ? increment : existing.crawlCount,
    };
  }

  records.sort((a, b) => (a.lastCrawlAt < b.lastCrawlAt ? 1 : -1));
  await writeRegistry(records);
};

export const listWebsiteRecords = async (): Promise<WebsiteRecord[]> => {
  const records = await readRegistry();
  if (records.length > 0) {
    return records;
  }

  try {
    const entries = await readdir(WEBSITES_DIR, { withFileTypes: true });
    const discovered: WebsiteRecord[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      const domainDir = join(WEBSITES_DIR, entry.name);
      const latestSession = await readFile(join(domainDir, 'latest', 'session.json'), 'utf8').catch(() => null);
      if (!latestSession) {
        continue;
      }

      const { id, url, completedAt } = JSON.parse(latestSession) as {
        id?: string;
        url?: string;
        completedAt?: string;
      };

      discovered.push({
        domain: entry.name,
        baseUrl: url ?? `https://${entry.name}`,
        firstCrawlAt: completedAt ?? new Date().toISOString(),
        lastCrawlAt: completedAt ?? new Date().toISOString(),
        lastCrawlId: id ?? null,
        lastCrawlDir: null,
        crawlCount: 1,
      });
    }

    return discovered.sort((a, b) => (a.lastCrawlAt < b.lastCrawlAt ? 1 : -1));
  } catch {
    return [];
  }
};

const readSessionSnapshot = async (directory: string): Promise<{
  crawlId: string;
  createdAt: string | null;
  completedAt: string | null;
} | null> => {
  const payload = await readFile(join(directory, 'session.json'), 'utf8').catch(() => null);
  if (!payload) {
    return null;
  }

  try {
    const parsed = JSON.parse(payload) as {
      id?: string;
      createdAt?: string;
      completedAt?: string;
    };

    if (!parsed.id) {
      return null;
    }

    return {
      crawlId: parsed.id,
      createdAt: parsed.createdAt ?? null,
      completedAt: parsed.completedAt ?? null,
    };
  } catch {
    return null;
  }
};

export const listCrawlSummaries = async (domain: string): Promise<CrawlSummary[]> => {
  const canonicalDomain = normaliseDomain(domain);
  if (!canonicalDomain) {
    return [];
  }

  const domainDir = join(WEBSITES_DIR, canonicalDomain);
  const crawlsDir = join(domainDir, 'crawls');
  const latestDir = join(domainDir, 'latest');

  const summaries: CrawlSummary[] = [];

  const latestSnapshot = await readSessionSnapshot(latestDir);
  if (latestSnapshot) {
    summaries.push({
      crawlId: latestSnapshot.crawlId,
      createdAt: latestSnapshot.createdAt,
      completedAt: latestSnapshot.completedAt,
      directory: latestDir,
      isLatest: true,
    });
  }

  const crawlEntries = await readdir(crawlsDir, { withFileTypes: true }).catch(() => []);

  for (const entry of crawlEntries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const crawlDir = join(crawlsDir, entry.name);
    const snapshot = await readSessionSnapshot(crawlDir);
    if (!snapshot) {
      continue;
    }

    summaries.push({
      crawlId: snapshot.crawlId,
      createdAt: snapshot.createdAt,
      completedAt: snapshot.completedAt,
      directory: crawlDir,
      isLatest: false,
    });
  }

  summaries.sort((a, b) => {
    const aTime = a.completedAt ?? a.createdAt ?? '';
    const bTime = b.completedAt ?? b.createdAt ?? '';
    return aTime < bTime ? 1 : -1;
  });

  return summaries;
};

export const getLatestCrawlDirectory = async (domain: string): Promise<string | null> => {
  const summaries = await listCrawlSummaries(domain);
  if (summaries.length === 0) {
    return null;
  }
  return summaries[0]?.directory ?? null;
};

export const getUserStoriesPath = (directory: string): string => join(directory, 'user-stories.json');
export const getSiteMapPath = (directory: string): string => join(directory, 'site-map.json');
export const getPlaywrightDir = (directory: string): string => join(directory, 'playwright');

export const getFileTimestampLabel = async (filePath: string): Promise<string> => {
  try {
    const fileStat = await stat(filePath);
    return `Generated ${fileStat.mtime.toLocaleString()}`;
  } catch {
    return 'No crawl artifacts detected';
  }
};

