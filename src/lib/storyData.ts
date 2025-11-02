// This file loads crawl output from the filesystem and prepares dashboard-ready data structures.
import { promises as fs, stat } from 'node:fs/promises';
import { join } from 'node:path';

import type { StoryKind, UserStory } from '@/types';
import { sanitizeFileSlug } from '@/lib/sanitize';

const OUTPUT_DIR = join(process.cwd(), 'output');
const STORIES_FILE = join(OUTPUT_DIR, 'user-stories.json');
const SITE_MAP_FILE = join(OUTPUT_DIR, 'site-map.json');

interface StorySummary {
  byKind: Record<StoryKind, number>;
  unverified: number;
  pageCount: number;
}

interface StoryWithSpec extends UserStory {
  specSlug: string;
  specHref: string;
}

interface DashboardData {
  baseUrl: string;
  storyCount: number;
  generatedAtLabel: string;
  summary: StorySummary;
  stories: StoryWithSpec[];
}

const defaultSummary = (): StorySummary => ({
  byKind: {
    authentication: 0,
    browsing: 0,
    complex: 0,
    interaction: 0,
  },
  unverified: 0,
  pageCount: 0,
});

const readJson = async <T>(filePath: string, label: string): Promise<T | null> => {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw) as T;
    console.info(`[storyData] Loaded ${label} (${filePath})`);
    return parsed;
  } catch (error) {
    console.warn(`[storyData] Failed to load ${label} (${filePath}):`, (error as Error).message);
    return null;
  }
};

const getGeneratedAtLabel = async (): Promise<string> => {
  try {
    const fileStat = await stat(STORIES_FILE);
    return `Generated ${fileStat.mtime.toLocaleString()}`;
  } catch {
    return 'No crawl artifacts detected';
  }
};

const buildSpecMetadata = (story: UserStory): { specSlug: string; specHref: string } => {
  const slug = sanitizeFileSlug(story.suggestedScriptName, story.id);
  return {
    specSlug: slug,
    specHref: `/api/spec/${slug}`,
  };
};

export const loadDashboardData = async (): Promise<DashboardData> => {
  const stories = (await readJson<UserStory[]>(STORIES_FILE, 'stories')) ?? [];
  const siteMap =
    (await readJson<{ baseUrl: string; pages: Array<{ url: string }>; edges: Array<{ source: string; targets: string[] }>; }>(
      SITE_MAP_FILE,
      'site-map'
    )) ??
    { baseUrl: 'Unknown source', pages: [], edges: [] };

  console.info('[storyData] Story count', stories.length);


  const summary = stories.reduce<StorySummary>((acc, story) => {
    acc.byKind[story.kind] += 1;
    if (story.verificationStatus !== 'baseline') {
      acc.unverified += 1;
    }
    return acc;
  }, defaultSummary());

  summary.pageCount = siteMap.pages.length;

  const sortedStories = [...stories].sort((a, b) => {
    if (a.verificationStatus === b.verificationStatus) {
      return a.title.localeCompare(b.title);
    }
    return a.verificationStatus === 'baseline' ? -1 : 1;
  });

  return {
    baseUrl: siteMap.baseUrl,
    storyCount: stories.length,
    generatedAtLabel: await getGeneratedAtLabel(),
    summary,
    stories: sortedStories.map((story) => ({
      ...story,
      ...buildSpecMetadata(story),
    })),
  };
};
