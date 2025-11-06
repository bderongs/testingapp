// This file exposes an API endpoint that runs the Sparkier CLI crawler from the Next.js UI.
import { spawn } from 'node:child_process';

import { revalidatePath } from 'next/cache';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import {
  createCrawlSession,
  completeCrawlSession,
  getCrawlSession,
} from '@/lib/crawlManager';

export const runtime = 'nodejs';

const requestSchema = z.object({
  url: z.string().url(),
  maxPages: z.number().int().positive().max(200).optional(),
  sameOriginOnly: z.boolean().optional(),
});

const runCrawler = (
  args: string[],
  crawlId: string
): Promise<{ code: number; output: string }> =>
  new Promise((resolve) => {
    const child = spawn('npm', ['run', 'dev:cli', '--', ...args, `--crawl-id=${crawlId}`], {
      cwd: process.cwd(),
      shell: process.platform === 'win32',
    });
    let output = '';

    child.stdout.on('data', (chunk) => {
      output += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      output += chunk.toString();
    });

    child.on('close', (code) => {
      resolve({ code: code ?? 1, output });
    });
  });

export async function POST(request: Request): Promise<NextResponse> {
  const json = await request.json().catch(() => ({}));
  const parse = requestSchema.safeParse(json);

  if (!parse.success) {
    return NextResponse.json(
      {
        success: false,
        message: 'Invalid payload provided. Ensure url, maxPages, and sameOriginOnly are set correctly.',
        issues: parse.error.issues,
      },
      { status: 400 }
    );
  }

  const { url, maxPages = 10, sameOriginOnly = true } = parse.data;

  // Create crawl session and check if queued
  const sessionResult = createCrawlSession(url, maxPages, sameOriginOnly);

  if (!sessionResult) {
    return NextResponse.json(
      {
        success: false,
        message: 'Unable to create crawl session. Please try again later.',
      },
      { status: 503 }
    );
  }

  const { session, queued } = sessionResult;

  // If queued, return immediately with the crawl ID
  if (queued) {
    return NextResponse.json({
      success: true,
      message: 'Crawl queued. It will start automatically when a slot becomes available.',
      crawlId: session.id,
      queued: true,
      status: 'pending',
    });
  }

  // Run crawler asynchronously
  runCrawler(
    [`--url=${url}`, `--max-pages=${maxPages}`, `--same-origin-only=${sameOriginOnly}`],
    session.id
  )
    .then(({ code, output }) => {
      if (code !== 0) {
        completeCrawlSession(session.id, false, output);
      } else {
        completeCrawlSession(session.id, true);
      }
    })
    .catch((error) => {
      completeCrawlSession(session.id, false, (error as Error).message);
    });

  return NextResponse.json({
    success: true,
    message: 'Crawl started successfully.',
    crawlId: session.id,
    queued: false,
    status: 'running',
  });
}
