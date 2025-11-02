// This file exposes an API endpoint that runs the Sparkier CLI crawler from the Next.js UI.
import { spawn } from 'node:child_process';

import { NextResponse } from 'next/server';
import { z } from 'zod';

export const runtime = 'nodejs';

const requestSchema = z.object({
  url: z.string().url(),
  maxPages: z.number().int().positive().max(200).optional(),
  sameOriginOnly: z.boolean().optional(),
});

const runCrawler = (args: string[]): Promise<{ code: number; output: string }> =>
  new Promise((resolve) => {
    const child = spawn('npm', ['run', 'dev:cli', '--', ...args], { cwd: process.cwd(), shell: process.platform === 'win32' });
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
  const args = [`--url=${url}`, `--max-pages=${maxPages}`, `--same-origin-only=${sameOriginOnly}`];

  const { code, output } = await runCrawler(args);

  if (code !== 0) {
    return NextResponse.json(
      {
        success: false,
        message: 'Crawler failed. Review the output for details.',
        output,
      },
      { status: 500 }
    );
  }

  return NextResponse.json({
    success: true,
    message: 'Crawler completed successfully. Refreshing dashboard?',
    output,
  });
}
