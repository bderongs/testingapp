// This file exposes an API endpoint that runs the Sparkier CLI crawler from the Next.js UI.
import { spawn } from 'node:child_process';
import { writeFile, unlink, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

import { NextResponse } from 'next/server';
import { z } from 'zod';

import {
  createCrawlSession,
  completeCrawlSession,
} from '@/lib/crawlManager';
import type { Cookie } from '@/types';

export const runtime = 'nodejs';

const cookieSchema = z.object({
  name: z.string().min(1),
  value: z.string(),
  domain: z.string().min(1),
  path: z.string().optional(),
  expires: z.number().optional(),
  httpOnly: z.boolean().optional(),
  secure: z.boolean().optional(),
  sameSite: z.enum(['Strict', 'Lax', 'None']).optional(),
});

const requestSchema = z.object({
  url: z.string().url(),
  maxPages: z.number().int().positive().max(200).optional(),
  sameOriginOnly: z.boolean().optional(),
  cookies: z.array(cookieSchema).optional(),
});

const runCrawler = (
  args: string[],
  crawlId: string,
  cookies?: readonly Cookie[]
): Promise<{ code: number; output: string }> =>
  new Promise(async (resolve) => {
    let cookiesFilePath: string | null = null;

    try {
      // If cookies are provided, write them to a temporary file
      if (cookies && cookies.length > 0) {
        const tmpDir = join(process.cwd(), 'tmp');
        try {
          await mkdir(tmpDir, { recursive: true });
        } catch {
          // Directory might already exist, ignore
        }
        cookiesFilePath = join(tmpDir, `cookies-${crawlId}.json`);
        await writeFile(cookiesFilePath, JSON.stringify(cookies), 'utf-8');
        args.push(`--cookies-file=${cookiesFilePath}`);
      }

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

      child.on('close', async (code) => {
        // Clean up cookies file
        if (cookiesFilePath) {
          try {
            await unlink(cookiesFilePath);
          } catch {
            // Ignore cleanup errors
          }
        }
        resolve({ code: code ?? 1, output });
      });
    } catch (error) {
      // Clean up cookies file on error
      if (cookiesFilePath) {
        try {
          await unlink(cookiesFilePath);
        } catch {
          // Ignore cleanup errors
        }
      }
      resolve({ code: 1, output: (error as Error).message });
    }
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

  const { url, maxPages = 10, sameOriginOnly = true, cookies } = parse.data;

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
    session.id,
    cookies
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
