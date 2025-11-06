// This file loads crawl output from the filesystem and prepares dashboard-ready data structures.
import { readFile, stat, readdir } from 'node:fs/promises';
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

interface SitemapNode {
  id: string;
  label: string;
  url: string;
}

interface SitemapEdge {
  from: string;
  to: string;
}

interface DashboardData {
  baseUrl: string;
  storyCount: number;
  generatedAtLabel: string;
  summary: StorySummary;
  stories: StoryWithSpec[];
  sitemapNodes: SitemapNode[];
  sitemapEdges: SitemapEdge[];
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
    const raw = await readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw) as T;
    console.info(`[storyData] Loaded ${label} (${filePath})`);
    return parsed;
  } catch (error) {
    console.warn(`[storyData] Failed to load ${label} (${filePath}):`, (error as Error).message);
    return null;
  }
};

const getGeneratedAtLabel = async (crawlDir: string, storiesFile: string): Promise<string> => {
  try {
    const fileStat = await stat(storiesFile);
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

/**
 * Finds the most recent crawl ID by scanning output directories.
 * Returns the crawlId of the directory with the most recent user-stories.json file.
 */
const findLatestCrawlId = async (): Promise<string | null> => {
  try {
    const entries = await readdir(OUTPUT_DIR, { withFileTypes: true });
    const crawlDirs = entries.filter((entry) => entry.isDirectory() && entry.name !== 'playwright');
    
    let latestCrawlId: string | null = null;
    let latestTime = 0;

    for (const dir of crawlDirs) {
      const storiesFile = join(OUTPUT_DIR, dir.name, 'user-stories.json');
      try {
        const stats = await stat(storiesFile);
        if (stats.mtimeMs > latestTime) {
          latestTime = stats.mtimeMs;
          latestCrawlId = dir.name;
        }
      } catch {
        // File doesn't exist, skip this directory
        continue;
      }
    }

    return latestCrawlId;
  } catch {
    return null;
  }
};

/**
 * Loads dashboard data from a specific crawl ID or from the most recent crawl.
 * If crawlId is provided, loads from output/{crawlId}/.
 * If no crawlId is provided, finds and loads the most recent crawl.
 * Falls back to output/ (legacy mode) if no crawl directories are found.
 */
export const loadDashboardData = async (crawlId?: string): Promise<DashboardData> => {
  // If no crawlId provided, find the latest crawl
  let targetCrawlId = crawlId;
  if (!targetCrawlId) {
    targetCrawlId = await findLatestCrawlId() || undefined;
  }

  const crawlDir = targetCrawlId ? join(OUTPUT_DIR, targetCrawlId) : OUTPUT_DIR;
  const storiesFile = join(crawlDir, 'user-stories.json');
  const siteMapFile = join(crawlDir, 'site-map.json');

  const stories = (await readJson<UserStory[]>(storiesFile, 'stories')) ?? [];
  const siteMap =
    (await readJson<{ baseUrl: string; pages: Array<{ url: string }>; edges: Array<{ source: string; targets: string[] }>; }>(
      siteMapFile,
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

  // Group pages by URL prefix/category to reduce noise in the visualization
  const categoryGroups = new Map<string, number>();
  const allUrls = new Set<string>();
  
  // Include all pages
  siteMap.pages.forEach((page) => allUrls.add(page.url));
  
  // Include all edge targets to capture the full site structure
  siteMap.edges.forEach((edge) => {
    edge.targets.forEach((target) => allUrls.add(target));
  });
  
  // Count URLs by category
  allUrls.forEach((url) => {
    const urlObj = new URL(url);
    const pathSegments = urlObj.pathname.split('/').filter(Boolean);
    if (pathSegments.length === 0) {
      categoryGroups.set('home', (categoryGroups.get('home') || 0) + 1);
    } else if (pathSegments.length === 1) {
      categoryGroups.set(pathSegments[0], (categoryGroups.get(pathSegments[0]) || 0) + 1);
    } else {
      // Group by first path segment (e.g., /sparks/*, /hub/*)
      categoryGroups.set(pathSegments[0], (categoryGroups.get(pathSegments[0]) || 0) + 1);
    }
  });

  const sitemapNodes: SitemapNode[] = siteMap.pages
    .filter((page) => {
      // Filter out pages that are part of large categories to reduce noise
      const urlObj = new URL(page.url);
      const pathSegments = urlObj.pathname.split('/').filter(Boolean);
      if (pathSegments.length === 0) return true; // Always include home
      
      const category = pathSegments[0];
      const count = categoryGroups.get(category) || 0;
      // Only show individual pages if there are fewer than 3 in the category, or if it's top-level
      if (count < 3 || pathSegments.length === 1) {
        return true;
      }
      // For large categories, only show category nodes
      return false;
    })
    .map((page) => {
      const urlObj = new URL(page.url);
      const pathname = urlObj.pathname;
      const pathSegments = pathname.split('/').filter(Boolean);
      
      let label: string;
      if (pathSegments.length === 0) {
        label = 'Home';
      } else {
        const category = pathSegments[0];
        const count = categoryGroups.get(category) || 0;
        if (count >= 3 && pathSegments.length > 1) {
          // Create a category node for large groups
          return null;
        }
        label = pathSegments[pathSegments.length - 1];
      }
      
      return {
        id: page.url,
        label: label.substring(0, 40),
        url: page.url,
      };
    })
    .filter((node): node is SitemapNode => node !== null);

  // Add category nodes for large groups
  categoryGroups.forEach((count, category) => {
    if (count >= 3) {
      // Check if we already have a page representing this category
      const hasCategoryNode = sitemapNodes.some((node) => {
        const urlObj = new URL(node.url);
        const pathSegments = urlObj.pathname.split('/').filter(Boolean);
        return pathSegments[0] === category && pathSegments.length === 1;
      });
      
      if (!hasCategoryNode) {
        // Find a representative URL from either crawled pages or edge targets
        const representativeUrl = Array.from(allUrls).find((url) => {
          const urlObj = new URL(url);
          const pathSegments = urlObj.pathname.split('/').filter(Boolean);
          return pathSegments.length > 0 && pathSegments[0] === category;
        });
        
        if (representativeUrl) {
          sitemapNodes.push({
            id: `/${category}/`,
            label: `${category} (${count} pages)`,
            url: representativeUrl,
          });
        }
      }
    }
  });

  const sitemapEdges: SitemapEdge[] = siteMap.edges
    .flatMap((edge) =>
      edge.targets.map((target) => {
        const sourceCategory = getCategory(edge.source);
        const targetCategory = getCategory(target);
        
        // For large categories, collapse edges to category nodes
        if (sourceCategory && targetCategory && sourceCategory !== edge.source && targetCategory !== target) {
          return { from: sourceCategory, to: targetCategory };
        }
        return { from: edge.source, to: target };
      })
    )
    .filter((edge, index, self) => {
      // Deduplicate edges
      const edgeStr = `${edge.from}->${edge.to}`;
      return self.findIndex((e) => `${e.from}->${e.to}` === edgeStr) === index;
    });
  
  function getCategory(url: string): string | null {
    const urlObj = new URL(url);
    const pathSegments = urlObj.pathname.split('/').filter(Boolean);
    if (pathSegments.length === 0) return null;
    
    const category = pathSegments[0];
    const count = categoryGroups.get(category) || 0;
    if (count >= 3) {
      return `/${category}/`;
    }
    return null;
  }

  return {
    baseUrl: siteMap.baseUrl,
    storyCount: stories.length,
    generatedAtLabel: await getGeneratedAtLabel(crawlDir, storiesFile),
    summary,
    stories: sortedStories.map((story) => ({
      ...story,
      ...buildSpecMetadata(story),
    })),
    sitemapNodes,
    sitemapEdges,
  };
};
