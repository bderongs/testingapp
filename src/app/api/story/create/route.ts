// API endpoint for creating custom user stories from natural language intent
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

import type { UserStory, PageSummary } from '@/types';

export const runtime = 'nodejs';

const requestSchema = z.object({
    crawlId: z.string().min(1),
    domain: z.string().min(1),
    pageUrl: z.string().url(),
    userIntent: z.string().min(10),
    storyTitle: z.string().optional(),
});

interface CustomStoriesFile {
    stories: UserStory[];
}

const loadPageSummary = async (crawlId: string, domain: string, pageUrl: string): Promise<PageSummary | null> => {
    try {
        const crawlDir = join(process.cwd(), 'output', 'domains', domain, 'crawls', crawlId);
        const siteMapPath = join(crawlDir, 'site-map.json');
        const siteMapContent = await readFile(siteMapPath, 'utf-8');
        const siteMap = JSON.parse(siteMapContent) as {
            baseUrl: string;
            pages: PageSummary[];
            edges?: unknown;
            pendingUrls?: string[];
        };

        // Find the page by URL (normalize for comparison)
        const normalizedUrl = pageUrl.toLowerCase();
        const page = siteMap.pages.find(
            (p) => p.url.toLowerCase() === normalizedUrl
        );

        return page ?? null;
    } catch (error) {
        console.error(`Failed to load page summary: ${(error as Error).message}`);
        return null;
    }
};

const generateStoryFromIntent = async (
    intent: string,
    page: PageSummary,
    crawlId: string,
    customTitle?: string
): Promise<UserStory> => {
    const { generateStoryFromIntent: aiGenerator } = await import('@/lib/storyBuilder');
    return aiGenerator(intent, page, crawlId, customTitle);
};

const saveCustomStory = async (
    story: UserStory,
    crawlId: string,
    domain: string
): Promise<void> => {
    const crawlDir = join(process.cwd(), 'output', 'domains', domain, 'crawls', crawlId);
    await mkdir(crawlDir, { recursive: true });

    const customStoriesPath = join(crawlDir, 'custom-stories.json');

    let existingData: CustomStoriesFile = { stories: [] };
    try {
        const content = await readFile(customStoriesPath, 'utf-8');
        existingData = JSON.parse(content) as CustomStoriesFile;
    } catch {
        // File doesn't exist yet, use empty array
    }

    existingData.stories.push(story);

    await writeFile(customStoriesPath, JSON.stringify(existingData, null, 2), 'utf-8');
};

export async function POST(request: Request): Promise<NextResponse> {
    const json = await request.json().catch(() => ({}));
    const parse = requestSchema.safeParse(json);

    if (!parse.success) {
        return NextResponse.json(
            {
                success: false,
                message: 'Invalid payload provided.',
                issues: parse.error.issues,
            },
            { status: 400 }
        );
    }

    const { crawlId, domain, pageUrl, userIntent, storyTitle } = parse.data;

    // Load the page summary from the crawl
    const page = await loadPageSummary(crawlId, domain, pageUrl);
    if (!page) {
        return NextResponse.json(
            {
                success: false,
                message: 'Page not found in crawl data. Ensure the crawl completed successfully.',
            },
            { status: 404 }
        );
    }

    try {
        // Generate the story using AI
        const story = await generateStoryFromIntent(userIntent, page, crawlId, storyTitle);

        // Save to custom-stories.json
        await saveCustomStory(story, crawlId, domain);

        // Generate the Playwright spec file using the test generator
        const specDir = join(process.cwd(), 'output', 'domains', domain, 'crawls', crawlId, 'playwright');
        await mkdir(specDir, { recursive: true });

        const { sanitizeFileSlug } = await import('@/lib/sanitize');
        const specSlug = sanitizeFileSlug(story.suggestedScriptName, story.id);
        const specPath = join(specDir, `${specSlug}.spec.ts`);

        // Use the test generator to create proper Playwright code
        const { generatePlaywrightTest } = await import('@/lib/testGenerator');
        const playwrightCode = await generatePlaywrightTest(story, page);

        if (!playwrightCode) {
            throw new Error('Failed to generate Playwright test code');
        }

        await writeFile(specPath, playwrightCode, 'utf-8');

        return NextResponse.json({
            success: true,
            message: 'Custom story created successfully.',
            story,
        });
    } catch (error) {
        console.error(`Failed to generate story: ${(error as Error).message}`);
        return NextResponse.json(
            {
                success: false,
                message: 'Failed to generate story. Ensure OpenAI API key is configured.',
                error: (error as Error).message,
            },
            { status: 500 }
        );
    }
}
