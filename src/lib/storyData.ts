// This file loads crawl output from the filesystem and prepares dashboard-ready data structures.
import { join } from 'node:path';

import type { StoryKind, UserStory, Cookie, PageSummary } from '@/types';
import { sanitizeFileSlug } from '@/lib/sanitize';
import {
  listWebsites,
  listCrawlsForDomain,
  loadCrawlArtifacts,
  loadWebsiteMetadata,
  findDomainForCrawl,
  type WebsiteSummary,
  type CrawlSummary,
} from '@/lib/websites';
import { loadDomainCookies } from '@/storage/cookieStore';

interface StorySummary {
  byKind: Record<StoryKind, number>;
  unverified: number;
  pageCount: number;
  complexWithForms: number;
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
  activeCrawlId: string | null;
  selectedDomain: string | null;
  availableDomains: WebsiteSummary[];
  crawlHistory: CrawlSummary[];
  cookieSnapshot: {
    cookies: Cookie[];
    updatedAtLabel: string;
  };
  pendingUrlCount: number;
  availablePages: PageSummary[];
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
  complexWithForms: 0,
});

const buildSpecMetadata = (
  story: UserStory,
  domain: string,
  crawlId: string | null
): { specSlug: string; specHref: string } => {
  const slug = sanitizeFileSlug(story.suggestedScriptName, story.id);
  const searchParams = new URLSearchParams({ domain });
  if (crawlId) {
    searchParams.set('crawlId', crawlId);
  }
  return {
    specSlug: slug,
    specHref: `/api/spec/${slug}?${searchParams.toString()}`,
  };
};

interface LoadDashboardOptions {
  domain?: string;
  crawlId?: string;
}

/**
 * Loads dashboard data for a domain, optionally scoped to a specific crawl.
 */
export const loadDashboardData = async (options: LoadDashboardOptions = {}): Promise<DashboardData> => {
  const websites = await listWebsites();

  let selectedDomain = options.domain ?? null;
  if (!selectedDomain && options.crawlId) {
    selectedDomain = await findDomainForCrawl(options.crawlId);
  }
  if (!selectedDomain && websites.length > 0) {
    selectedDomain = websites[0].domain;
  }

  if (!selectedDomain) {
    return {
      baseUrl: 'Unknown source',
      storyCount: 0,
      generatedAtLabel: 'No crawl artifacts detected',
      summary: defaultSummary(),
      stories: [],
      sitemapNodes: [],
      sitemapEdges: [],
      activeCrawlId: null,
      selectedDomain: null,
      availableDomains: websites,
      crawlHistory: [],
      cookieSnapshot: {
        cookies: [],
        updatedAtLabel: 'No cookies saved',
      },
      pendingUrlCount: 0,
      availablePages: [],
    };
  }

  const crawlHistory = await listCrawlsForDomain(selectedDomain, 25);
  const metadata = await loadWebsiteMetadata(selectedDomain);

  const requestedCrawlId = options.crawlId ?? null;
  const resolvedCrawlId = requestedCrawlId ?? metadata?.lastCrawlId ?? null;

  const { siteMap, userStories, generatedLabel, resolvedCrawlId: actualCrawlId } = await loadCrawlArtifacts(
    selectedDomain,
    resolvedCrawlId ?? undefined
  );

  const effectiveCrawlId = actualCrawlId ?? resolvedCrawlId ?? null;

  const stories = (userStories as UserStory[] | null) ?? [];
  const siteMapData =
    (siteMap as {
      baseUrl: string;
      pages: Array<{ url: string; pageGoal?: string; primaryActions?: string[] }>;
      edges: Array<{ source: string; targets: string[] }>;
      pendingUrls?: string[];
    } | null) ?? { baseUrl: metadata?.baseUrl ?? 'Unknown source', pages: [], edges: [], pendingUrls: [] };

  console.info('[storyData] Story count', stories.length);


  const summary = stories.reduce<StorySummary>((acc, story) => {
    acc.byKind[story.kind] += 1;
    if (story.verificationStatus !== 'baseline') {
      acc.unverified += 1;
    }
    if (story.kind === 'complex' && story.detectedFormFieldLabels && story.detectedFormFieldLabels.length > 0) {
      acc.complexWithForms += 1;
    }
    return acc;
  }, defaultSummary());

  summary.pageCount = siteMapData.pages.length;

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
  siteMapData.pages.forEach((page) => allUrls.add(page.url));

  // Include all edge targets to capture the full site structure
  siteMapData.edges.forEach((edge) => {
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

  const sitemapNodes: SitemapNode[] = siteMapData.pages
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

  const sitemapEdges: SitemapEdge[] = siteMapData.edges
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

  const savedCookies = await loadDomainCookies(selectedDomain);
  const cookieUpdatedAtLabel =
    savedCookies.cookies.length > 0 && savedCookies.updatedAt
      ? `Updated ${new Date(savedCookies.updatedAt).toLocaleString()}`
      : 'No cookies saved';
  const pendingUrlCount = Array.isArray(siteMapData.pendingUrls) ? siteMapData.pendingUrls.length : 0;

  return {
    baseUrl: siteMapData.baseUrl,
    storyCount: stories.length,
    generatedAtLabel: generatedLabel,
    summary,
    stories: sortedStories.map((story) => ({
      ...story,
      ...buildSpecMetadata(story, selectedDomain!, effectiveCrawlId),
    })),
    sitemapNodes,
    sitemapEdges,
    activeCrawlId: effectiveCrawlId,
    selectedDomain,
    availableDomains: websites,
    crawlHistory,
    cookieSnapshot: {
      cookies: savedCookies.cookies,
      updatedAtLabel: cookieUpdatedAtLabel,
    },
    pendingUrlCount,
    availablePages: siteMapData.pages as PageSummary[],
  };
};
