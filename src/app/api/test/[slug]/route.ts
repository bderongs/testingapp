// This file provides an API endpoint to run individual Playwright tests from the generated spec files.
import { spawn } from 'node:child_process';

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export const runtime = 'nodejs';

const runPlaywrightTest = (specFile: string): Promise<{ code: number; output: string }> =>
  new Promise((resolve) => {
    // Use npx playwright test to run the specific spec file
    const child = spawn('npx', ['playwright', 'test', specFile, '--reporter=list'], {
      cwd: process.cwd(),
      shell: process.platform === 'win32',
      env: { ...process.env, CI: 'false' },
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

export async function POST(request: NextRequest, { params }: { params: Promise<{ slug: string }> }): Promise<NextResponse> {
  const resolvedParams = await params;
  const slug = resolvedParams.slug.replace(/[^a-z0-9-]/g, '');
  const specFile = `output/playwright/${slug}.spec.ts`;

  try {
    const { code, output } = await runPlaywrightTest(specFile);

    if (code !== 0) {
      return NextResponse.json(
        {
          success: false,
          message: `Test failed with exit code ${code}`,
          output,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: 'Test completed successfully!',
      output,
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        message: 'Failed to run test',
        error: (error as Error).message,
      },
      { status: 500 }
    );
  }
}
