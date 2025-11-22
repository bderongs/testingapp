// This file exposes an API endpoint that runs the Sparkier CLI crawler from the Next.js UI.
import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import type { WriteStream } from 'node:fs';
import { writeFile, unlink, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

import { NextResponse } from 'next/server';
import { z } from 'zod';

import {
  createCrawlSession,
  completeCrawlSession,
  persistCrawlSessionSnapshot,
} from '@/lib/crawlManager';
import type { Cookie } from '@/types';
import { sanitizeCookieList } from '@/lib/cookieTools';
import { loadDomainCookies } from '@/storage/cookieStore';

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
  generateTests: z.boolean().optional(),
  cookies: z.array(cookieSchema).optional(),
});

const runCrawler = (
  args: string[],
  session: { id: string; domain: string },
  cookies?: readonly Cookie[]
): Promise<{ code: number; output: string }> =>
  new Promise(async (resolve) => {
    let cookiesFilePath: string | null = null;
    let logStream: WriteStream | null = null;

    try {
      // If cookies are provided, write them to a temporary file
      if (cookies && cookies.length > 0) {
        const tmpDir = join(process.cwd(), 'tmp');
        try {
          await mkdir(tmpDir, { recursive: true });
        } catch {
          // Directory might already exist, ignore
        }
        cookiesFilePath = join(tmpDir, `cookies-${session.id}.json`);
        await writeFile(cookiesFilePath, JSON.stringify(cookies), 'utf-8');
        args.push(`--cookies-file=${cookiesFilePath}`);
      }

      const crawlDir = join(process.cwd(), 'output', 'domains', session.domain, 'crawls', session.id);
      await mkdir(crawlDir, { recursive: true });
      const logPath = join(crawlDir, 'crawl.log');
      try {
        logStream = createWriteStream(logPath, { flags: 'a' });
      } catch (error) {
        console.warn(`[crawl route] Failed to open log stream for ${logPath}: ${(error as Error).message}`);
        logStream = null;
      }
      const appendLog = (chunk: unknown): void => {
        if (!logStream) {
          return;
        }
        const payload = typeof chunk === 'string' ? chunk : chunk instanceof Buffer ? chunk.toString('utf8') : '';
        if (!payload) {
          return;
        }
        logStream.write(`${new Date().toISOString()} ${payload}`);
      };

      const child = spawn('npm', ['run', 'dev:cli', '--', ...args, `--crawl-id=${session.id}`], {
        cwd: process.cwd(),
        shell: process.platform === 'win32',
      });
      let output = '';

      child.stdout.on('data', (chunk) => {
        output += chunk.toString();
        appendLog(chunk);
      });

      child.stderr.on('data', (chunk) => {
        output += chunk.toString();
        appendLog(chunk);
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
        if (logStream) {
          logStream.end(`${new Date().toISOString()} Crawl process exited with code ${code ?? 1}\n`);
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
      if (logStream) {
        logStream.end(`${new Date().toISOString()} Failed to launch crawler: ${(error as Error).message}\n`);
      } else {
        try {
          const fallbackDir = join(process.cwd(), 'output', 'domains', session.domain, 'crawls', session.id);
          await mkdir(fallbackDir, { recursive: true });
          const logPath = join(fallbackDir, 'crawl.log');
          const fallbackStream = createWriteStream(logPath, { flags: 'a' });
          fallbackStream.end(`${new Date().toISOString()} Failed to launch crawler: ${(error as Error).message}\n`);
        } catch {
          // Ignore log persistence failures
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

  const { url, maxPages = 10, sameOriginOnly = true, generateTests = false, cookies } = parse.data;

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

  const mergeCookies = async (): Promise<Cookie[] | undefined> => {
    const savedSnapshot = await loadDomainCookies(session.domain);
    const saved = savedSnapshot.cookies ?? [];
    const provided = cookies ?? [];

    if (saved.length === 0 && provided.length === 0) {
      return undefined;
    }

    const merged = sanitizeCookieList([...saved, ...provided]);
    return merged.length > 0 ? merged : undefined;
  };

  const mergedCookies = await mergeCookies();

  try {
    await persistCrawlSessionSnapshot(session);
  } catch (error) {
    console.warn(`[crawl route] Failed to persist session snapshot for ${session.id}: ${(error as Error).message}`);
  }

  // If queued, return immediately with the crawl ID
  if (queued) {
    return NextResponse.json({
      success: true,
      message: 'Crawl queued. It will start automatically when a slot becomes available.',
      crawlId: session.id,
      domain: session.domain,
      queued: true,
      status: 'pending',
    });
  }

  // Run crawler asynchronously
  const cliArgs = [
    `--url=${url}`,
    `--max-pages=${maxPages}`,
    `--same-origin-only=${sameOriginOnly}`,
  ];

  // Add test generation flags if requested
  if (generateTests) {
    cliArgs.push('--generate-tests', '--run-tests');
  }

  runCrawler(cliArgs, session, mergedCookies)
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
    domain: session.domain,
    queued: false,
    status: 'running',
    cookiesInjected: mergedCookies?.length ?? 0,
  });
}
