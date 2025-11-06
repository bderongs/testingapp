// This file implements the Playwright-powered crawler that maps a website into structured page summaries.
import { chromium } from 'playwright';
import { logger } from '../utils/logger';
import { isSameOrigin, normalizeUrl, safeResolve } from '../utils/url';
import { DOM_EXTRACTION_SOURCE } from './domExtractionScript';
const DEFAULT_MAX_PAGES = 40;
const DEFAULT_TIMEOUT_MS = 15000;
const extractDomMetadata = async (page) => page.evaluate(DOM_EXTRACTION_SOURCE);
export const crawlSite = async ({ baseUrl, maxPages = DEFAULT_MAX_PAGES, sameOriginOnly = true, navigationTimeoutMs = DEFAULT_TIMEOUT_MS, }) => {
    const normalizedBase = normalizeUrl(baseUrl);
    const pending = [normalizedBase];
    const visited = new Set();
    const discovered = new Set([normalizedBase]);
    const pages = new Map();
    const edges = new Map();
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    try {
        while (pending.length > 0 && visited.size < maxPages) {
            const url = pending.shift();
            if (visited.has(url)) {
                continue;
            }
            visited.add(url);
            logger.info(`Crawling ${url}`);
            const page = await context.newPage();
            let response = null;
            try {
                response = await page.goto(url, {
                    waitUntil: 'domcontentloaded',
                    timeout: navigationTimeoutMs,
                });
            }
            catch (error) {
                logger.warn(`Failed to load ${url}: ${error.message}`);
                await page.close();
                continue;
            }
            try {
                await page.waitForLoadState('networkidle', { timeout: 2500 });
            }
            catch {
                // Soft timeout for long-polling pages; ignore.
            }
            const statusCode = response?.status() ?? 0;
            let domData = null;
            try {
                domData = await extractDomMetadata(page);
            }
            catch (error) {
                logger.warn(`Could not extract DOM for ${url}: ${error.message}`);
            }
            const outgoing = [];
            if (domData) {
                logger.info(`Found ${domData.links.length} link(s) on ${url}`);
                const pageSummary = {
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
    }
    finally {
        await context.close();
        await browser.close();
    }
    return {
        baseUrl: normalizedBase,
        pages,
        edges,
    };
};
