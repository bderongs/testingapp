// API endpoint to list custom stories for a crawl
import { NextResponse } from 'next/server';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { UserStory } from '@/types';

export const runtime = 'nodejs';

interface CustomStoriesFile {
    stories: UserStory[];
}

export async function GET(request: Request): Promise<NextResponse> {
    const { searchParams } = new URL(request.url);
    const crawlId = searchParams.get('crawlId');
    const domain = searchParams.get('domain');

    if (!crawlId || !domain) {
        return NextResponse.json(
            { success: false, message: 'Missing crawlId or domain' },
            { status: 400 }
        );
    }

    try {
        const crawlDir = join(process.cwd(), 'output', 'domains', domain, 'crawls', crawlId);
        const customStoriesPath = join(crawlDir, 'custom-stories.json');

        const content = await readFile(customStoriesPath, 'utf-8');
        const data = JSON.parse(content) as CustomStoriesFile;

        return NextResponse.json({
            success: true,
            customStories: data.stories || [],
        });
    } catch (error) {
        // File doesn't exist or can't be read - return empty array
        return NextResponse.json({
            success: true,
            customStories: [],
        });
    }
}
