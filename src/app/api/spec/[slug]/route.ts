// This file streams generated Playwright spec skeletons from the filesystem for browser download.
import { promises as fs } from 'node:fs';
import { join } from 'node:path';

import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { findDomainForCrawl } from '@/lib/websites';

const OUTPUT_DIR = join(process.cwd(), 'output');
const DOMAINS_ROOT = join(OUTPUT_DIR, 'domains');
const LEGACY_SPEC_DIR = join(OUTPUT_DIR, 'playwright');

const sanitizeSlug = (value: string): string => value.replace(/[^a-z0-9-]/g, '');

const sanitizeCrawlId = (value: string | null): string | null => {
  if (!value) {
    return null;
  }
  const trimmed = value.trim().toLowerCase().replace(/[^a-z0-9-]/g, '');
  return trimmed.length > 0 ? trimmed : null;
};

const sanitizeDomain = (value: string | null): string | null => {
  if (!value) {
    return null;
  }
  const trimmed = value.trim().toLowerCase();
  return /^[a-z0-9.-]+$/.test(trimmed) ? trimmed : null;
};

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
): Promise<NextResponse> {
  const resolvedParams = await params;
  const slug = sanitizeSlug(resolvedParams.slug);

  const crawlId = sanitizeCrawlId(request.nextUrl.searchParams.get('crawlId'));
  let domain = sanitizeDomain(request.nextUrl.searchParams.get('domain'));

  if (!domain && crawlId) {
    domain = await findDomainForCrawl(crawlId);
  }

  let specDir: string;
  if (domain) {
    specDir = crawlId
      ? join(DOMAINS_ROOT, domain, 'crawls', crawlId, 'playwright')
      : join(DOMAINS_ROOT, domain, 'latest', 'playwright');
  } else if (crawlId) {
    // Legacy fallback: crawls stored at output/<crawlId>
    specDir = join(OUTPUT_DIR, crawlId, 'playwright');
  } else {
    specDir = LEGACY_SPEC_DIR;
  }

  const filePath = join(specDir, `${slug}.spec.ts`);

  try {
    const content = await fs.readFile(filePath, 'utf8');
    return new NextResponse(content, {
      status: 200,
      headers: {
        'content-type': 'text/plain; charset=utf-8',
        'cache-control': 'no-store',
      },
    });
  } catch {
    return NextResponse.json({ message: 'Spec file not found.' }, { status: 404 });
  }
}
