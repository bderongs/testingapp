// This file implements the Playwright-powered crawler that maps a website into structured page summaries.

import { chromium, HTTPResponse, Page } from 'playwright';

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
}

const DEFAULT_MAX_PAGES = 40;
const DEFAULT_TIMEOUT_MS = 15000;

const extractDomMetadata = async (page: Page) =>
  page.evaluate<DomExtractionResult>(() => {
    const __name = (target: Function, value: string): void => {
      try {
        Object.defineProperty(target, 'name', { value, configurable: true });
      } catch {
        // Ignore environments where function names are not configurable.
      }
    };

    const anchors = Array.from(document.querySelectorAll('a[href]')) as HTMLAnchorElement[];
    const links = anchors
      .filter((anchor) => anchor.href && !anchor.href.startsWith('javascript:'))
      .map((anchor) => ({
        url: anchor.href,
        text: anchor.innerText.trim() || anchor.getAttribute('aria-label') || anchor.textContent?.trim() || '',
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

    const landmarks = new Set<LandmarkKind>();
    if (document.querySelector('header, [role="banner"]')) {
      landmarks.add('banner');
    }
    if (document.querySelector('nav, [role="navigation"]')) {
      landmarks.add('navigation');
    }
    if (document.querySelector('main, [role="main"]')) {
      landmarks.add('main');
    }
    if (document.querySelector('aside, [role="complementary"]')) {
      landmarks.add('complementary');
    }
    if (document.querySelector('footer, [role="contentinfo"]')) {
      landmarks.add('contentinfo');
    }
    if (document.querySelector('[role="search"], form[role="search"], input[type="search"]')) {
      landmarks.add('search');
    }

    const navElements = Array.from(new Set(document.querySelectorAll('nav, [role="navigation"]')));
    const navigationSections = navElements.map<NavigationSection>((element) => {
      const label = element.getAttribute('aria-label') || element.getAttribute('data-testid') || undefined;
      const navLinks = Array.from(element.querySelectorAll('a[href]')) as HTMLAnchorElement[];

      const seen = new Set<string>();
      const items = navLinks
        .map((link) => {
          const depth = (() => {
            let current: Element | null = link.parentElement;
            let depthValue = 0;
            while (current && current !== element) {
              if (current.tagName === 'UL' || current.tagName === 'OL' || current.tagName === 'NAV') {
                depthValue += 1;
              }
              current = current.parentElement;
            }
            return depthValue;
          })();

          return {
            url: link.href,
            text: link.innerText.trim() || link.getAttribute('aria-label') || link.textContent?.trim() || '',
            depth,
          };
        })
        .filter((item) => {
          const signature = `${item.depth}|${item.url}|${item.text}`;
          if (seen.has(signature)) {
            return false;
          }
          seen.add(signature);
          return item.text.length > 0 && item.url.length > 0;
        });

      return {
        label,
        items,
      };
    });

    const headingElements = Array.from(document.querySelectorAll('h1, h2, h3, h4')) as HTMLHeadingElement[];
    const headingOutline = headingElements
      .map<HeadingEntry>((heading) => ({
        level: Number.parseInt(heading.tagName.replace('H', ''), 10),
        text: heading.innerText.trim(),
        id: heading.id || undefined,
      }))
      .filter((entry) => entry.text.length > 0);

    const breadcrumbContainer = (() => {
      const candidates = Array.from(
        document.querySelectorAll(
          'nav[aria-label*="breadcrumb"], [role="navigation"][aria-label*="breadcrumb"], nav.breadcrumb, ol.breadcrumb, ul.breadcrumb'
        )
      );
      return candidates[0] ?? null;
    })();

    const breadcrumbTrail = breadcrumbContainer
      ? (() => {
          const crumbs: BreadcrumbEntry[] = [];
          const crumbLinks = Array.from(breadcrumbContainer.querySelectorAll('a[href]')) as HTMLAnchorElement[];
          crumbLinks.forEach((link) => {
            const text = link.innerText.trim() || link.textContent?.trim() || '';
            if (!text) {
              return;
            }
            crumbs.push({ url: link.href, text });
          });

          if (crumbs.length === 0) {
            const listItems = Array.from(breadcrumbContainer.querySelectorAll('li')) as HTMLLIElement[];
            listItems.forEach((item) => {
              const text = item.innerText.trim();
              if (text.length > 0) {
                crumbs.push({ url: '', text });
              }
            });
          }

          return crumbs;
        })()
      : [];

    const schemaOrgTypes = (() => {
      const collected = new Set<string>();
      const scripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));
      const recordType = (value: unknown) => {
        if (typeof value === 'string') {
          collected.add(value);
        } else if (Array.isArray(value)) {
          value.forEach(recordType);
        }
      };

      const walk = (node: unknown) => {
        if (!node || typeof node !== 'object') {
          return;
        }
        const candidate = node as Record<string, unknown>;
        if (candidate['@type']) {
          recordType(candidate['@type']);
        }
        Object.values(candidate).forEach(walk);
      };

      scripts.forEach((script) => {
        try {
          const data = JSON.parse(script.textContent || '{}');
          walk(data);
        } catch {
          // Ignore malformed JSON-LD entries.
        }
      });

      return Array.from(collected);
    })();

    const metaDescription = document.querySelector('meta[name="description"]')?.getAttribute('content')?.trim() || undefined;

    const keywordsFromMeta = (() => {
      const metaKeywords = document.querySelector('meta[name="keywords"]')?.getAttribute('content');
      if (!metaKeywords) {
        return [] as string[];
      }
      return metaKeywords
        .split(',')
        .map((keyword) => keyword.trim())
        .filter((keyword) => keyword.length > 0)
        .slice(0, 12);
    })();

    const headingKeywords = headingOutline.slice(0, 5).map((entry) => entry.text).filter((text) => text.length > 0);

    const primaryKeywords = keywordsFromMeta.length > 0 ? keywordsFromMeta : headingKeywords;

    return {
      title: document.title || '',
      links,
      forms: formSummaries,
      interactiveElementCount: interactiveElements.length,
      hasScrollableSections: scrollableSections.length > 0,
      landmarks: Array.from(landmarks),
      navigationSections,
      headingOutline,
      breadcrumbTrail,
      schemaOrgTypes,
      metaDescription,
      primaryKeywords,
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
          landmarks: domData.landmarks,
          navigationSections: domData.navigationSections,
          headingOutline: domData.headingOutline,
          breadcrumbTrail: domData.breadcrumbTrail,
          schemaOrgTypes: domData.schemaOrgTypes,
          metaDescription: domData.metaDescription,
          primaryKeywords: domData.primaryKeywords,
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
