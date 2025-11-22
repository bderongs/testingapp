// This file runs full Playwright specs on demand, injecting saved cookies to mirror authenticated sessions.
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile, unlink, access, readdir, stat } from 'node:fs/promises';
import { join, relative, dirname } from 'node:path';

import { NextResponse } from 'next/server';

import { loadDomainCookies } from '@/storage/cookieStore';
import { findDomainForCrawl } from '@/lib/websites';
import { sanitizeFileSlug } from '@/lib/sanitize';
import type { Cookie } from '@/types';
import { sanitizeCookieList } from '@/lib/cookieTools';
import { chromium } from 'playwright';
import { DOM_EXTRACTION_SOURCE } from '@/lib/domExtractionScript';

interface PlaywrightResult {
  readonly code: number;
  readonly output: string;
}

const OUTPUT_DIR = join(process.cwd(), 'output');
const DOMAINS_ROOT = join(OUTPUT_DIR, 'domains');
const LEGACY_SPEC_DIR = join(OUTPUT_DIR, 'playwright');
const TMP_DIR = join(process.cwd(), 'tmp');

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

const toStorageStateCookie = (cookie: Cookie) => {
  const storageCookie: Record<string, unknown> = {
    name: cookie.name,
    value: cookie.value,
    domain: cookie.domain,
    path: cookie.path ?? '/',
    httpOnly: Boolean(cookie.httpOnly),
    secure: Boolean(cookie.secure),
  };

  if (cookie.sameSite) {
    storageCookie.sameSite = cookie.sameSite;
  }

  if (typeof cookie.expires === 'number' && Number.isFinite(cookie.expires)) {
    storageCookie.expires = cookie.expires;
  }

  return storageCookie;
};

const runPlaywright = (configPath: string): Promise<PlaywrightResult> =>
  new Promise((resolve) => {
    const child = spawn('npx', ['playwright', 'test', '--config', configPath, '--reporter=list'], {
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

const fileExists = async (path: string): Promise<boolean> => {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
};

const findTraceArtifacts = async (dir: string): Promise<{ trace?: string; video?: string; screenshot?: string }> => {
  const artifacts: { trace?: string; video?: string; screenshot?: string } = {};
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        const nested = await findTraceArtifacts(fullPath);
        artifacts.trace = artifacts.trace ?? nested.trace;
        artifacts.video = artifacts.video ?? nested.video;
        artifacts.screenshot = artifacts.screenshot ?? nested.screenshot;
      } else {
        if (!artifacts.trace && entry.name.endsWith('trace.zip')) {
          artifacts.trace = fullPath;
        } else if (!artifacts.video && (entry.name.endsWith('.webm') || entry.name.endsWith('.mp4'))) {
          artifacts.video = fullPath;
        } else if (!artifacts.screenshot && entry.name.endsWith('.png')) {
          artifacts.screenshot = fullPath;
        }
      }
    }
  } catch {
    // Ignore lookup failures
  }
  return artifacts;
};

interface DomExtractionResult {
  readonly forms: Array<{
    readonly fields: Array<{
      readonly label?: string;
      readonly placeholder?: string;
      readonly name: string;
      readonly type: string;
    }>;
  }>;
}

const captureFormLabels = async (
  entryUrl: string,
  storageStatePath: string | null,
  cookies: Cookie[]
): Promise<string[]> => {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = storageStatePath && (await fileExists(storageStatePath))
      ? await browser.newContext({ storageState: storageStatePath })
      : await browser.newContext();

    if ((!storageStatePath || !(await fileExists(storageStatePath))) && cookies.length > 0) {
      await context.addCookies(
        cookies.map((cookie) => ({
          name: cookie.name,
          value: cookie.value,
          domain: cookie.domain,
          path: cookie.path ?? '/',
          httpOnly: Boolean(cookie.httpOnly),
          secure: Boolean(cookie.secure),
          expires:
            typeof cookie.expires === 'number' && Number.isFinite(cookie.expires)
              ? Math.floor(cookie.expires)
              : undefined,
          sameSite: cookie.sameSite,
        }))
      );
    }

    const page = await context.newPage();
    await page.goto(entryUrl, { waitUntil: 'networkidle' });

    const domData = (await page.evaluate(DOM_EXTRACTION_SOURCE)) as DomExtractionResult;

    const labels =
      domData.forms?.[0]?.fields
        ?.map((field) => field.label?.trim() || field.placeholder?.trim() || field.name || field.type)
        ?.filter((label): label is string => Boolean(label)) ?? [];

    return Array.from(new Set(labels)).slice(0, 8);
  } catch {
    return [];
  } finally {
    await browser.close();
  }
};

const removeFormAssertionsIfNeeded = (assertions: readonly string[], hasForm: boolean): string[] => {
  if (hasForm) {
    return Array.from(new Set(assertions));
  }

  const FORM_PATTERNS = [/form/i, /input/i, /field/i];
  return Array.from(
    new Set(
      assertions.filter((assertion) => !FORM_PATTERNS.some((regex) => regex.test(assertion)))
    )
  );
};

const updateStoryMetadata = async ({
  slug,
  specDir,
  domain,
  crawlId,
  storageStatePath,
  cookies,
}: {
  slug: string;
  specDir: string;
  domain: string | null;
  crawlId: string | null;
  storageStatePath: string | null;
  cookies: Cookie[];
}): Promise<{ entryUrl?: string; updated: boolean }> => {
  const storiesPath = join(specDir, '..', 'user-stories.json');
  let stories: Array<Record<string, any>>;

  try {
    const raw = await readFile(storiesPath, 'utf8');
    stories = JSON.parse(raw) as Array<Record<string, any>>;
  } catch {
    return { updated: false };
  }

  const storyIndex = stories.findIndex(
    (story) =>
      sanitizeFileSlug(story.suggestedScriptName, story.id ?? story.suggestedScriptName) === slug
  );

  if (storyIndex === -1) {
    return { updated: false };
  }

  const story = stories[storyIndex];
  const entryUrl: string = story.entryUrl;
  const labels = await captureFormLabels(entryUrl, storageStatePath, cookies);
  const hasForm = labels.length > 0;

  stories[storyIndex] = {
    ...story,
    detectedFormFieldLabels: labels,
    baselineAssertions: removeFormAssertionsIfNeeded(
      story.baselineAssertions ?? [],
      hasForm
    ),
  };

  await writeFile(storiesPath, `${JSON.stringify(stories, null, 2)}\n`, 'utf8');

  if (domain) {
    const latestStoriesPath = join(DOMAINS_ROOT, domain, 'latest', 'user-stories.json');
    try {
      const rawLatest = await readFile(latestStoriesPath, 'utf8');
      const latestStories = JSON.parse(rawLatest) as Array<Record<string, any>>;
      const latestIndex = latestStories.findIndex(
        (s) =>
          sanitizeFileSlug(s.suggestedScriptName, s.id ?? s.suggestedScriptName) === slug
      );
      if (latestIndex !== -1) {
        latestStories[latestIndex] = {
          ...latestStories[latestIndex],
          detectedFormFieldLabels: labels,
          baselineAssertions: removeFormAssertionsIfNeeded(
            latestStories[latestIndex].baselineAssertions ?? [],
            hasForm
          ),
        };
        await writeFile(latestStoriesPath, `${JSON.stringify(latestStories, null, 2)}\n`, 'utf8');
      }
    } catch {
      // Ignore failure to update latest snapshot
    }
  }

  return { entryUrl, updated: true };
};

export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string }> }
): Promise<NextResponse> {
  const resolvedParams = await params;
  const slug = resolvedParams.slug; // Trust the slug from the URL, it should already be sanitized by the UI/Link component

  const url = new URL(request.url);
  const crawlId = sanitizeCrawlId(url.searchParams.get('crawlId'));
  let domain = sanitizeDomain(url.searchParams.get('domain'));

  if (!domain && crawlId) {
    domain = await findDomainForCrawl(crawlId);
  }

  let specDir: string;
  if (domain) {
    specDir = crawlId
      ? join(DOMAINS_ROOT, domain, 'crawls', crawlId, 'playwright')
      : join(DOMAINS_ROOT, domain, 'latest', 'playwright');
  } else if (crawlId) {
    specDir = join(OUTPUT_DIR, crawlId, 'playwright');
  } else {
    specDir = LEGACY_SPEC_DIR;
  }

  const filePath = join(specDir, `${slug}.spec.ts`);

  try {
    await readFile(filePath, 'utf8');
  } catch {
    return NextResponse.json(
      {
        success: false,
        message: `Spec file not found at ${filePath}. Tests may not have been generated (check OpenAI API key).`,
      },
      { status: 404 }
    );
  }

  await mkdir(TMP_DIR, { recursive: true });

  const runId = randomUUID();
  const storagePath = join(TMP_DIR, `sparkier-storage-${runId}.json`);
  const configPath = join(TMP_DIR, `sparkier-config-${runId}.cjs`);
  const resultsDir = join(TMP_DIR, `sparkier-results-${runId}`);

  let mergedCookies: Cookie[] = [];

  if (domain) {
    const snapshot = await loadDomainCookies(domain);
    mergedCookies = snapshot.cookies;
  }

  mergedCookies = sanitizeCookieList(mergedCookies);

  const storiesPath = join(specDir, '..', 'user-stories.json');

  try {
    await mkdir(resultsDir, { recursive: true });

    if (mergedCookies.length > 0) {
      const storageState = {
        cookies: mergedCookies.map(toStorageStateCookie),
      };
      await writeFile(storagePath, JSON.stringify(storageState, null, 2), 'utf8');
    }

    const configContents = [
      "const { defineConfig, devices } = require('@playwright/test');",
      "const path = require('node:path');",
      '',
      'module.exports = defineConfig({',
      `  testDir: ${JSON.stringify(process.cwd())},`,
      `  testMatch: [${JSON.stringify(relative(process.cwd(), filePath).split('\\').join('/'))}],`,
      '  reporter: \'list\',',
      `  outputDir: ${JSON.stringify(resultsDir)},`,
      '  workers: 1,',
      '  projects: [',
      '    {',
      "      name: 'chromium',",
      '      use: {',
      "        ...devices['Desktop Chrome'],",
      mergedCookies.length > 0
        ? `        storageState: ${JSON.stringify(storagePath)},`
        : undefined,
      "        trace: 'on',",
      "        video: 'retain-on-failure',",
      "        screenshot: 'only-on-failure',",
      '      },',
      '    },',
      '  ],',
      '});',
      '',
    ]
      .filter(Boolean)
      .join('\n');

    await writeFile(configPath, configContents, 'utf8');

    const { code, output } = await runPlaywright(configPath);
    const artifacts = await findTraceArtifacts(resultsDir);

    let refreshed: { updated: boolean; entryUrl: string | undefined } = { updated: false, entryUrl: undefined };

    if (code === 0) {
      refreshed = await updateStoryMetadata({
        slug,
        specDir,
        domain,
        crawlId,
        storageStatePath: mergedCookies.length > 0 ? storagePath : null,
        cookies: mergedCookies,
      });
    }

    const message = code === 0
      ? refreshed.updated
        ? 'Playwright run completed successfully. Story metadata refreshed from live DOM.'
        : 'Playwright run completed successfully.'
      : 'Playwright run failed.';

    return NextResponse.json({
      success: code === 0,
      message,
      output,
      code,
      refreshed: refreshed.updated,
      artifacts,
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        message: 'Failed to execute Playwright run.',
        error: (error as Error).message,
      },
      { status: 500 }
    );
  } finally {
    await Promise.allSettled([
      unlink(configPath).catch(() => { }),
      unlink(storagePath).catch(() => { }),
    ]);
  }
}

