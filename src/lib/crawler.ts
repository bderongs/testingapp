// This file implements the Playwright-powered crawler that maps a website into structured page summaries.

import { chromium, HTTPResponse, Page } from 'playwright';

import type { CrawlOptions, CrawlResult, FormSummary, PageLink, PageSummary } from '../types';
import { logger } from '../utils/logger';
import { isSameOrigin, normalizeUrl, safeResolve } from '../utils/url';

interface DomExtractionResult {
  readonly title: string;
  readonly links: readonly PageLink[];
  readonly forms: readonly FormSummary[];
  readonly interactiveElementCount: number;
  readonly hasScrollableSections: boolean;
}

const DEFAULT_MAX_PAGES = 40;
const DEFAULT_TIMEOUT_MS = 15000;

const extractDomMetadata = async (page: Page) =>
  page.evaluate<DomExtractionResult>(() => {
    const anchors = Array.from(document.querySelectorAll('a[href]')) as HTMLAnchorElement[];
    const links = anchors
      .filter((anchor) => anchor.href && !anchor.href.startsWith('javascript:'))
      .map((anchor) => ({
        url: anchor.href,
        text: anchor.innerText.trim() || anchor.getAttribute('aria-label') || '',
      }));

    const forms = Array.from(document.querySelectorAll('form')) as HTMLFormElement[];

    const formSummaries = forms.map<FormSummary>((form) => {
      const fields = Array.from(form.elements)
        .map((element) => {
          if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement)) {
            return null;
          }

          const label = element.labels?.[0]?.innerText.trim();
          return {
            name: element.name || element.id || '',
            type: element instanceof HTMLInputElement ? element.type : element.tagName.toLowerCase(),
            label,
            required: element.hasAttribute('required'),
          };
        })
        .filter((field): field is FormSummary['fields'][number] => field !== null);

      return {
        action: form.action || '',
        method: form.method.toUpperCase() || 'GET',
        fields,
      };
    });

    const interactiveElements = document.querySelectorAll(
      'button, [role="button"], a[role="button"], input[type="button"], input[type="submit"], [data-action]'
    );

    const scrollableSections = Array.from(document.querySelectorAll('section, main, article, div')).filter((element) =>
      element.scrollHeight > window.innerHeight * 1.2
    );

    return {
      title: document.title || '',
      links,
      forms: formSummaries,
      interactiveElementCount: interactiveElements.length,
      hasScrollableSections: scrollableSections.length > 0,
    };
  });

export const crawlSite = async ({
  baseUrl,
  maxPages = DEFAULT_MAX_PAGES,
  sameOriginOnly = true,
  navigationTimeoutMs = DEFAULT_TIMEOUT_MS,
}: CrawlOptions): Promise<CrawlResult> => {
  const normalizedBase = normalizeUrl(baseUrl);
  const pending: string[] = [normalizedBase];
  const visited = new Set<string>();
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
      let response: HTTPResponse | null = null;

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
        const pageSummary: PageSummary = {
          url,
          title: domData.title,
          statusCode,
          links: domData.links,
          forms: domData.forms,
          interactiveElementCount: domData.interactiveElementCount,
          hasScrollableSections: domData.hasScrollableSections,
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

          if (!visited.has(resolved) && !pending.includes(resolved) && visited.size + pending.length < maxPages) {
            pending.push(resolved);
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
