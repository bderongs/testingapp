// This file streams generated Playwright spec skeletons from the filesystem for browser download.
import { promises as fs } from 'node:fs';
import { join } from 'node:path';

import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

const SPEC_DIR = join(process.cwd(), 'output', 'playwright');

export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string }> }): Promise<NextResponse> {
  const resolvedParams = await params;
  const slug = resolvedParams.slug.replace(/[^a-z0-9-]/g, '');
  const filePath = join(SPEC_DIR, `${slug}.spec.ts`);

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
