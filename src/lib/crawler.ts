// This file implements the Playwright-powered crawler that maps a website into structured page summaries.

import { chromium, Page, Response as PlaywrightResponse } from 'playwright';

import type {
  BreadcrumbEntry,
  CrawlOptions,
  CrawlResult,
  FormSummary,
  HeadingEntry,
  LandmarkKind,
  NavigationSection,
  PageLink,
  PageSummary,
} from '../types';
import { logger } from '../utils/logger';
import { isSameOrigin, normalizeUrl, safeResolve } from '../utils/url';
import { DOM_EXTRACTION_SOURCE } from './domExtractionScript';

interface DomExtractionResult {
  readonly title: string;
  readonly links: readonly PageLink[];
  readonly forms: readonly FormSummary[];
  readonly interactiveElementCount: number;
  readonly hasScrollableSections: boolean;
  readonly landmarks: readonly LandmarkKind[];
  readonly navigationSections: readonly NavigationSection[];
  readonly headingOutline: readonly HeadingEntry[];
  readonly breadcrumbTrail: readonly BreadcrumbEntry[];
  readonly schemaOrgTypes: readonly string[];
  readonly metaDescription?: string;
  readonly primaryKeywords: readonly string[];
  readonly primaryCtas: Array<{
    readonly label: string;
    readonly elementType: 'button' | 'link' | 'unknown';
    readonly isInMainContent: boolean;
    readonly priority: number;
  }>;
}

const DEFAULT_MAX_PAGES = 40;
const DEFAULT_TIMEOUT_MS = 15000;

const extractDomMetadata = async (page: Page) =>
  page.evaluate(DOM_EXTRACTION_SOURCE) as Promise<DomExtractionResult>;

export const crawlSite = async ({
  baseUrl,
  maxPages = DEFAULT_MAX_PAGES,
  sameOriginOnly = true,
  navigationTimeoutMs = DEFAULT_TIMEOUT_MS,
}: CrawlOptions): Promise<CrawlResult> => {
  const normalizedBase = normalizeUrl(baseUrl);
  const pending: string[] = [normalizedBase];
  const visited = new Set<string>();
  const discovered = new Set<string>([normalizedBase]);
  const pages = new Map<string, PageSummary>();
  const edges = new Map<string, string[]>();

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();

  try {
    while (pending.length > 0 && visited.size < maxPages) {
      const url = pending.shift() as string;
      if (visited.has(url)) {
        continue;
      }
      visited.add(url);

      logger.info(`Crawling ${url}`);

      const page = await context.newPage();
      let response: PlaywrightResponse | null = null;

      try {
        response = await page.goto(url, {
          waitUntil: 'domcontentloaded',
          timeout: navigationTimeoutMs,
        });
      } catch (error) {
        logger.warn(`Failed to load ${url}: ${(error as Error).message}`);
        await page.close();
        continue;
      }

      try {
        await page.waitForLoadState('networkidle', { timeout: 2500 });
      } catch {
        // Soft timeout for long-polling pages; ignore.
      }

      const statusCode = response?.status() ?? 0;

      let domData: DomExtractionResult | null = null;
      try {
        domData = await extractDomMetadata(page);
      } catch (error) {
        logger.warn(`Could not extract DOM for ${url}: ${(error as Error).message}`);
      }

      const outgoing: string[] = [];
      if (domData) {
        logger.info(`Found ${domData.links.length} link(s) on ${url}`);
        const pageSummary: PageSummary = {
          url,
          title: domData.title,
          statusCode,
          links: domData.links,
          forms: domData.forms,
          interactiveElementCount: domData.interactiveElementCount,
          hasScrollableSections: domData.hasScrollableSections,
          landmarks: domData.landmarks,
          navigationSections: domData.navigationSections,
          headingOutline: domData.headingOutline,
          breadcrumbTrail: domData.breadcrumbTrail,
          schemaOrgTypes: domData.schemaOrgTypes,
          metaDescription: domData.metaDescription,
          primaryKeywords: domData.primaryKeywords,
          primaryCtas: domData.primaryCtas,
        };
        pages.set(url, pageSummary);

        domData.links.forEach((link) => {
          const resolved = safeResolve(url, link.url);
          if (!resolved) {
            return;
          }

          if (sameOriginOnly && !isSameOrigin(normalizedBase, resolved)) {
            return;
          }

          outgoing.push(resolved);

          if (!discovered.has(resolved) && discovered.size < maxPages) {
            pending.push(resolved);
            discovered.add(resolved);
            logger.info(`Queued ${resolved}`);
          }
        });
      }

      edges.set(url, outgoing);
      await page.close();
    }
  } finally {
    await context.close();
    await browser.close();
  }

  return {
    baseUrl: normalizedBase,
    pages,
    edges,
  };
};
