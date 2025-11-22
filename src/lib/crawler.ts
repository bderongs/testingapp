// This file implements the Playwright-powered crawler that maps a website into structured page summaries.

import { chromium, Page, Response as PlaywrightResponse } from 'playwright';
import type OpenAI from 'openai';

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
  readonly actionHints: PageSummary['actionHints'];
}

const DEFAULT_MAX_PAGES = 40;
const DEFAULT_TIMEOUT_MS = 15000;

const extractDomMetadata = async (page: Page) =>
  page.evaluate(DOM_EXTRACTION_SOURCE) as Promise<DomExtractionResult>;

interface AiPageInsight {
  readonly goal?: string;
  readonly primaryActions?: string[];
  readonly recommendedLinks?: string[];
}

let openAiClientPromise: Promise<OpenAI> | null = null;
const loadOpenAiClient = async (): Promise<OpenAI | null> => {
  if (!process.env.OPENAI_API_KEY) {
    return null;
  }
  if (!openAiClientPromise) {
    openAiClientPromise = import('openai').then(
      ({ default: OpenAIClient }) => new OpenAIClient({ apiKey: process.env.OPENAI_API_KEY! })
    );
  }
  try {
    return await openAiClientPromise;
  } catch (error) {
    logger.warn(`Failed to initialize OpenAI client: ${(error as Error).message}`);
    return null;
  }
};

const summarizePageWithAi = async (
  pageUrl: string,
  dom: DomExtractionResult
): Promise<AiPageInsight | null> => {
  const client = await loadOpenAiClient();
  if (!client) {
    return null;
  }

  const headingSummary = dom.headingOutline
    .slice(0, 5)
    .map((heading) => `- H${heading.level}: ${heading.text}`)
    .join('\n');

  const ctaSummary = dom.primaryCtas
    .map(
      (cta, index) =>
        `${index + 1}. ${cta.label} (${cta.elementType}${cta.isInMainContent ? ', main' : ''})`
    )
    .join('\n');

  const linkSummary = dom.links
    .slice(0, 15)
    .map((link, index) => `${index + 1}. ${link.text || '(no text)'} -> ${link.url}`)
    .join('\n');

  const prompt = `You are assisting a web crawler. Analyze the page and return JSON with:
- "goal": a concise description of the page's main purpose.
- "primary_actions": up to three key actions a user should take on this page.
- "recommended_links": up to five URLs from the provided link list worth visiting next (use the exact URLs given, or relative forms if supplied).

Page URL: ${pageUrl}
Title: ${dom.title}
Meta description: ${dom.metaDescription ?? 'N/A'}
Top headings:
${headingSummary || 'None'}

Primary CTAs:
${ctaSummary || 'None'}

Available links:
${linkSummary || 'None'}

Return JSON like {"goal": "...", "primary_actions": ["..."], "recommended_links": ["url1", "..."]}.`;

  try {
    const completion = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.2,
      max_tokens: 400,
      messages: [
        { role: 'system', content: 'You summarize web pages for an automated crawler.' },
        { role: 'user', content: prompt },
      ],
    });

    const raw = completion.choices[0]?.message?.content?.trim();
    if (!raw) {
      return null;
    }

    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    const toParse = jsonMatch ? jsonMatch[0] : raw;
    const parsed = JSON.parse(toParse) as {
      goal?: string;
      primary_actions?: string[];
      recommended_links?: string[];
    };

    return {
      goal: parsed.goal,
      primaryActions: parsed.primary_actions ?? [],
      recommendedLinks: parsed.recommended_links ?? [],
    };
  } catch (error) {
    logger.warn(`Failed to summarize page ${pageUrl}: ${(error as Error).message}`);
    return null;
  }
};

export const crawlSite = async ({
  baseUrl,
  maxPages = DEFAULT_MAX_PAGES,
  sameOriginOnly = true,
  navigationTimeoutMs = DEFAULT_TIMEOUT_MS,
  cookies,
}: CrawlOptions): Promise<CrawlResult> => {
  const normalizedBase = normalizeUrl(baseUrl);
  const pending: string[] = [normalizedBase];
  const visited = new Set<string>();
  const discovered = new Set<string>([normalizedBase]);
  const pages = new Map<string, PageSummary>();
  const edges = new Map<string, string[]>();

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();

  // Inject cookies if provided (must be done before navigating to any pages)
  if (cookies && cookies.length > 0) {
    try {
      // Ensure cookies have required fields and set defaults
      const normalizedCookies = cookies.map((cookie) => ({
        name: cookie.name,
        value: cookie.value,
        domain: cookie.domain,
        path: cookie.path || '/',
        expires: cookie.expires,
        httpOnly: cookie.httpOnly ?? false,
        secure: cookie.secure ?? false,
        sameSite: cookie.sameSite || ('Lax' as const),
      }));

      await context.addCookies(normalizedCookies);
      logger.info(`Injected ${normalizedCookies.length} cookie(s) for authenticated crawling`);
    } catch (error) {
      logger.warn(`Failed to inject cookies: ${(error as Error).message}. Continuing without cookies.`);
    }
  }

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
        const aiInsight = await summarizePageWithAi(url, domData);
        const recommendedSet = new Set<string>();
        if (aiInsight?.recommendedLinks) {
          aiInsight.recommendedLinks.forEach((link) => {
            const resolved = safeResolve(url, link);
            if (resolved) {
              recommendedSet.add(resolved);
            }
          });
        }

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
          actionHints: domData.actionHints,
          pageGoal: aiInsight?.goal,
          primaryActions: aiInsight?.primaryActions,
          recommendedLinks: aiInsight ? Array.from(recommendedSet) : undefined,
        };
        pages.set(url, pageSummary);

        const prioritizedTargets: string[] = [];
        const normalTargets: string[] = [];

        domData.links.forEach((link) => {
          const resolved = safeResolve(url, link.url);
          if (!resolved) {
            return;
          }

          if (sameOriginOnly && !isSameOrigin(normalizedBase, resolved)) {
            return;
          }

          outgoing.push(resolved);

          const container = recommendedSet.has(resolved) ? prioritizedTargets : normalTargets;
          if (!container.includes(resolved)) {
            container.push(resolved);
          }
        });

        for (let i = prioritizedTargets.length - 1; i >= 0; i -= 1) {
          const target = prioritizedTargets[i];
          if (!discovered.has(target) && discovered.size < maxPages) {
            pending.unshift(target);
            discovered.add(target);
            logger.info(`Prioritized ${target}`);
          }
        }

        normalTargets.forEach((target) => {
          if (!discovered.has(target) && discovered.size < maxPages) {
            pending.push(target);
            discovered.add(target);
            logger.info(`Queued ${target}`);
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
    pendingUrls: Array.from(discovered).filter((candidate) => !visited.has(candidate)),
  };
};
