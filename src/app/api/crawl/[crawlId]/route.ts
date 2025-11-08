// This file provides an API endpoint to retrieve crawl results by crawl ID.

import { readFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import { getCrawlSession } from '@/lib/crawlManager';
import type { CrawlSession } from '@/lib/crawlManager';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const OUTPUT_DIR = join(process.cwd(), 'output');

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ crawlId: string }> }
): Promise<NextResponse> {
  const resolvedParams = await params;
  const crawlId = resolvedParams.crawlId;

  // Get session info from memory
  let session = getCrawlSession(crawlId);
  
  // If session not found in memory, check if results exist on filesystem
  // This handles cases where the server restarted or session is in another instance
  if (!session) {
    const crawlDir = join(OUTPUT_DIR, crawlId);
    try {
      const [sessionSnapshot, siteMapExists, storiesExists] = await Promise.all([
        readFile(join(crawlDir, 'session.json'), 'utf8').catch(() => null),
        readFile(join(crawlDir, 'site-map.json'), 'utf8').catch(() => null),
        readFile(join(crawlDir, 'user-stories.json'), 'utf8').catch(() => null),
      ]);

      // If files exist, create a synthetic session
      if (sessionSnapshot) {
        try {
          const allowedStatuses: CrawlSession['status'][] = ['pending', 'running', 'completed', 'failed'];
        const parsed = JSON.parse(sessionSnapshot) as {
          id?: string;
          url?: string;
          maxPages?: number;
          sameOriginOnly?: boolean;
          status?: string;
          createdAt?: string;
          completedAt?: string | null;
          error?: string | null;
        };
        const normalisedStatus = allowedStatuses.includes(parsed.status as CrawlSession['status'])
          ? (parsed.status as CrawlSession['status'])
          : 'running';
        session = {
          id: parsed.id ?? crawlId,
          url: parsed.url ?? 'Unknown',
          maxPages: parsed.maxPages ?? 0,
          sameOriginOnly: parsed.sameOriginOnly ?? true,
          status: normalisedStatus,
          createdAt: parsed.createdAt ? new Date(parsed.createdAt) : new Date(),
          completedAt: parsed.completedAt ? new Date(parsed.completedAt) : undefined,
          error: parsed.error ?? undefined,
        };
        if (session.status === 'completed') {
          const [siteMapContent, storiesContent] = await Promise.all([
            readFile(join(crawlDir, 'site-map.json'), 'utf8').catch(() => null),
            readFile(join(crawlDir, 'user-stories.json'), 'utf8').catch(() => null),
          ]);
          if (siteMapContent && storiesContent) {
            return NextResponse.json({
              success: true,
              session: {
                id: session.id,
                url: session.url,
                status: session.status,
                createdAt: session.createdAt.toISOString(),
                completedAt: session.completedAt?.toISOString(),
              },
              data: {
                siteMap: JSON.parse(siteMapContent),
                userStories: JSON.parse(storiesContent),
              },
            });
          }
        }
        } catch {
          // Ignore malformed snapshot and fall back to file heuristics
        }
      }

      if (!session && siteMapExists && storiesExists) {
        const siteMap = JSON.parse(siteMapExists);
        session = {
          id: crawlId,
          url: siteMap.baseUrl || 'Unknown',
          maxPages: 0,
          sameOriginOnly: true,
          status: 'completed',
          createdAt: new Date(),
          completedAt: new Date(),
        };
      } else {
        // Check if directory exists but files are missing (crawl in progress or failed)
        try {
          await access(crawlDir);
          // Directory exists, crawl might be in progress
          session = {
            id: crawlId,
            url: 'Unknown',
            maxPages: 0,
            sameOriginOnly: true,
            status: 'running', // Assume running if directory exists but files don't
            createdAt: new Date(),
          };
        } catch {
          // Directory doesn't exist
        }
      }
    } catch {
      // Directory doesn't exist, session truly not found
    }
  }

  if (!session) {
    return NextResponse.json(
      {
        success: false,
        message: 'Crawl session not found',
      },
      { status: 404 }
    );
  }

  // If crawl is still running or pending, return status only
  if (session.status === 'running' || session.status === 'pending') {
    return NextResponse.json({
      success: true,
      session: {
        id: session.id,
        url: session.url,
        status: session.status,
        createdAt: session.createdAt.toISOString(),
      },
      data: null,
    });
  }

  // Try to load crawl results
  const crawlDir = join(OUTPUT_DIR, crawlId);
  try {
    const [siteMapContent, storiesContent] = await Promise.all([
      readFile(join(crawlDir, 'site-map.json'), 'utf8').catch(() => null),
      readFile(join(crawlDir, 'user-stories.json'), 'utf8').catch(() => null),
    ]);

    if (!siteMapContent || !storiesContent) {
      return NextResponse.json(
        {
          success: false,
          message: 'Crawl results not found. The crawl may have failed or results were cleaned up.',
          session: {
            id: session.id,
            url: session.url,
            status: session.status,
            createdAt: session.createdAt.toISOString(),
            completedAt: session.completedAt?.toISOString(),
            error: session.error,
          },
        },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      session: {
        id: session.id,
        url: session.url,
        status: session.status,
        createdAt: session.createdAt.toISOString(),
        completedAt: session.completedAt?.toISOString(),
      },
      data: {
        siteMap: JSON.parse(siteMapContent),
        userStories: JSON.parse(storiesContent),
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        message: 'Failed to load crawl results',
        error: (error as Error).message,
        session: session
          ? {
              id: session.id,
              url: session.url,
              status: session.status,
              createdAt: session.createdAt.toISOString(),
              completedAt: session.completedAt?.toISOString(),
              error: session.error,
            }
          : undefined,
      },
      { status: 500 }
    );
  }
}

