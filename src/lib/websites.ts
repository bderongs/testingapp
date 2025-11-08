// This file centralises helpers for reading website-level crawl metadata and registries from the filesystem.

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  getFileTimestampLabel,
  getSiteMapPath,
  getUserStoriesPath,
  listCrawlSummaries,
  listWebsiteRecords,
} from '@/storage/websiteRegistry';

const DOMAINS_ROOT = join(process.cwd(), 'output', 'domains');

export interface WebsiteSummary {
  domain: string;
  label: string;
  baseUrl: string;
  lastCrawlId?: string | null;
  lastCrawlAt?: string | null;
  crawlCount: number;
}

export interface CrawlSummary {
  id: string;
  domain: string;
  baseUrl?: string;
  status?: string;
  createdAt?: string | null;
  completedAt?: string | null;
  path: string;
  isLatest: boolean;
}

const safeReadJson = async <T>(path: string): Promise<T | null> => {
  try {
    const raw = await readFile(path, 'utf8');
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
};

export const listWebsites = async (): Promise<WebsiteSummary[]> => {
  const records = await listWebsiteRecords();
  return records.map((record) => ({
    domain: record.domain,
    label: record.domain,
    baseUrl: record.baseUrl,
    lastCrawlId: record.lastCrawlId,
    lastCrawlAt: record.lastCrawlAt,
    crawlCount: record.crawlCount,
  }));
};

export const loadWebsiteMetadata = async (
  domain: string
): Promise<{
  domain: string;
  baseUrl: string;
  lastCrawlId?: string | null;
  lastCrawlAt?: string | null;
}> => {
  const records = await listWebsiteRecords();
  const match = records.find((record) => record.domain === domain);
  if (match) {
    return {
      domain: match.domain,
      baseUrl: match.baseUrl,
      lastCrawlId: match.lastCrawlId,
      lastCrawlAt: match.lastCrawlAt,
    };
  }

  return {
    domain,
    baseUrl: `https://${domain}`,
  };
};

export const findDomainForCrawl = async (crawlId: string): Promise<string | null> => {
  if (!crawlId) {
    return null;
  }

  const websites = await listWebsiteRecords();
  for (const website of websites) {
    if (website.lastCrawlId === crawlId) {
      return website.domain;
    }
  }

  for (const website of websites) {
    const crawls = await listCrawlSummaries(website.domain);
    if (crawls.some((crawl) => crawl.crawlId === crawlId)) {
      return website.domain;
    }
  }

  return null;
};

export const listCrawlsForDomain = async (domain: string, limit = 20): Promise<CrawlSummary[]> => {
  const summaries = await listCrawlSummaries(domain);
  return summaries.slice(0, limit).map((summary) => ({
    id: summary.crawlId,
    domain,
    path: summary.directory,
    createdAt: summary.createdAt,
    completedAt: summary.completedAt,
    isLatest: summary.isLatest,
    status: 'completed',
  }));
};

export const loadCrawlArtifacts = async (
  domain: string,
  crawlId?: string
): Promise<{ siteMap: unknown | null; userStories: unknown | null; generatedLabel: string }> => {
  const summaries = await listCrawlSummaries(domain);
  const target = crawlId
    ? summaries.find((summary) => summary.crawlId === crawlId)
    : summaries[0];

  if (!target) {
    return {
      siteMap: null,
      userStories: null,
      generatedLabel: 'No crawl artifacts detected',
    };
  }

  const storiesPath = getUserStoriesPath(target.directory);
  const siteMapPath = getSiteMapPath(target.directory);
  const [siteMapRaw, storiesRaw, generatedLabel] = await Promise.all([
    safeReadJson<unknown>(siteMapPath),
    safeReadJson<unknown>(storiesPath),
    getFileTimestampLabel(storiesPath),
  ]);

  return {
    siteMap: siteMapRaw,
    userStories: storiesRaw,
    generatedLabel,
  };
};

