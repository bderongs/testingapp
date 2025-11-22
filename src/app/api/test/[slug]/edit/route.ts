// This file provides an API endpoint to modify Playwright tests by editing baseline assertions using AI.
import { readFile, writeFile, copyFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { z } from 'zod';

import { findDomainForCrawl } from '@/lib/websites';
import { logger } from '@/utils/logger';
import { sanitizeFileSlug } from '@/lib/sanitize';
import type { UserStory } from '@/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic'; // Prevent static generation at build time

// Check if we're in build mode (Next.js sets this during build)
const isBuildTime = process.env.NEXT_PHASE === 'phase-production-build' ||
  process.env.NODE_ENV === 'production' && !process.env.VERCEL && !process.env.RAILWAY_ENVIRONMENT;

const requestSchema = z.object({
  instruction: z.string().min(1, 'Instruction is required'),
  apply: z.boolean().optional().default(false),
  baselineAssertions: z.array(z.string()).optional(),
  playwrightOutline: z.array(z.string()).optional(),
  context: z
    .object({
      entryUrl: z.string().optional(),
      primaryCtaLabel: z.string().optional(),
      primaryActionLabel: z.string().optional(),
      formFieldLabels: z.array(z.string()).optional(),
      primaryActionOutcome: z
        .object({
          kind: z.string(),
          targetUrl: z.string().optional(),
          evidence: z.array(z.string()).optional(),
          notes: z.string().optional(),
        })
        .optional(),
    })
    .optional(),
});

// Dynamic import to avoid loading OpenAI module at build time
const getOpenAIClient = async () => {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not configured');
  }
  // Dynamic import prevents module from being loaded during build
  const { default: OpenAI } = await import('openai');
  return new OpenAI({ apiKey });
};

const OUTPUT_DIR = join(process.cwd(), 'output');
const DOMAINS_ROOT = join(OUTPUT_DIR, 'domains');
const LEGACY_SPEC_DIR = join(OUTPUT_DIR, 'playwright');
const LEGACY_STORIES_FILE = join(OUTPUT_DIR, 'user-stories.json');

/**
 * Finds the most recent crawl ID by scanning output directories.
 */
const findLatestCrawlId = async (): Promise<string | null> => {
  try {
    const { readdir, stat } = await import('node:fs/promises');
    const entries = await readdir(OUTPUT_DIR, { withFileTypes: true });
    const crawlDirs = entries.filter((entry) => entry.isDirectory() && entry.name !== 'playwright');

    let latestCrawlId: string | null = null;
    let latestTime = 0;

    for (const dir of crawlDirs) {
      const storiesFile = join(OUTPUT_DIR, dir.name, 'user-stories.json');
      try {
        const stats = await stat(storiesFile);
        if (stats.mtimeMs > latestTime) {
          latestTime = stats.mtimeMs;
          latestCrawlId = dir.name;
        }
      } catch {
        continue;
      }
    }

    return latestCrawlId;
  } catch {
    return null;
  }
};
const ensureDir = async (targetDir: string): Promise<void> => {
  try {
    await mkdir(targetDir, { recursive: true });
  } catch {
    // Directory might already exist, ignore
  }
};

const createBackup = async (specFile: string): Promise<string | null> => {
  try {
    // Check if the spec file exists
    const { access } = await import('node:fs/promises');
    await access(specFile);

    const backupDir = join(dirname(specFile), '.backups');
    await ensureDir(backupDir);
    const fileName = specFile.split('/').pop() || 'unknown.spec.ts';
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = join(backupDir, `${fileName}.${timestamp}.backup`);
    await copyFile(specFile, backupPath);
    return backupPath;
  } catch {
    // File doesn't exist, no backup needed
    return null;
  }
};

const readJson = async <T>(filePath: string, label: string): Promise<T | null> => {
  try {
    const content = await readFile(filePath, 'utf8');
    return JSON.parse(content) as T;
  } catch (error) {
    logger.error(`[test-edit] Failed to read ${label} from ${filePath}: ${(error as Error).message}`);
    return null;
  }
};

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

const getLatestDomainCrawlId = async (domain: string): Promise<string | null> => {
  const latestSession = join(DOMAINS_ROOT, domain, 'latest', 'session.json');
  const session = await readJson<{ id?: string }>(latestSession, 'latest session');
  return session?.id ?? null;
};

const resolvePaths = async (domain: string | null, crawlId: string | null) => {
  if (domain) {
    const baseDir = crawlId
      ? join(DOMAINS_ROOT, domain, 'crawls', crawlId)
      : join(DOMAINS_ROOT, domain, 'latest');
    return {
      baseDir,
      storiesFile: join(baseDir, 'user-stories.json'),
      specDir: join(baseDir, 'playwright'),
    };
  }

  if (crawlId) {
    const baseDir = join(OUTPUT_DIR, crawlId);
    return {
      baseDir,
      storiesFile: join(baseDir, 'user-stories.json'),
      specDir: join(baseDir, 'playwright'),
    };
  }

  return {
    baseDir: OUTPUT_DIR,
    storiesFile: LEGACY_STORIES_FILE,
    specDir: LEGACY_SPEC_DIR,
  };
};

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
): Promise<NextResponse> {
  // Prevent execution during build time
  if (isBuildTime) {
    return NextResponse.json(
      {
        success: false,
        message: 'This endpoint is not available during build time',
      },
      { status: 503 }
    );
  }

  const resolvedParams = await params;
  const slug = resolvedParams.slug.replace(/[^a-z0-9-]/g, '');
  const requestUrl = new URL(request.url);
  const requestedCrawlId = sanitizeCrawlId(requestUrl.searchParams.get('crawlId'));
  let domain = sanitizeDomain(requestUrl.searchParams.get('domain'));
  if (!domain && requestedCrawlId) {
    domain = await findDomainForCrawl(requestedCrawlId);
  }

  let crawlId = requestedCrawlId;
  if (domain && !crawlId) {
    crawlId = await getLatestDomainCrawlId(domain);
  }
  if (!domain && !crawlId) {
    crawlId = await findLatestCrawlId();
  }

  const paths = await resolvePaths(domain, crawlId);
  const specDir = paths.specDir;
  const specFile = join(specDir, `${slug}.spec.ts`);
  const storiesFilePath = paths.storiesFile;
  const baseDir = paths.baseDir;

  logger.info(
    `[test-edit] Received request slug=${slug} domain=${domain ?? 'legacy'} crawlId=${crawlId ?? 'latest'
    } specDir=${specDir}`
  );

  try {
    // Validate request body
    const json = await request.json().catch(() => ({}));
    const parse = requestSchema.safeParse(json);

    if (!parse.success) {
      return NextResponse.json(
        {
          success: false,
          message: 'Invalid payload',
          issues: parse.error.issues,
        },
        { status: 400 }
      );
    }

    const {
      instruction,
      apply,
      baselineAssertions: providedAssertions,
      playwrightOutline: providedOutline,
      context: providedContext,
    } = parse.data;

    // Get OpenAI client (will throw if API key is missing)
    // Use dynamic import to avoid build-time errors
    let openai: Awaited<ReturnType<typeof getOpenAIClient>>;
    try {
      openai = await getOpenAIClient();
    } catch (error) {
      return NextResponse.json(
        {
          success: false,
          message: 'OPENAI_API_KEY is not configured',
        },
        { status: 500 }
      );
    }

    // Load user stories to get current assertions
    const stories = (await readJson<UserStory[]>(
      storiesFilePath,
      'stories'
    )) ?? [];

    // Also load custom stories
    const customStoriesPath = join(baseDir, 'custom-stories.json');
    const customStoriesData = await readJson<{ stories: UserStory[] }>(
      customStoriesPath,
      'custom stories'
    );
    const customStories = customStoriesData?.stories ?? [];

    // Merge both story sources
    const allStories = [...stories, ...customStories];

    const story = allStories.find((s) => {
      const storySlug = sanitizeFileSlug(s.suggestedScriptName, s.id ?? s.suggestedScriptName);
      return storySlug === slug;
    });

    // Track if this is a custom story
    const isCustomStory = customStories.some((s) => {
      const storySlug = sanitizeFileSlug(s.suggestedScriptName, s.id ?? s.suggestedScriptName);
      return storySlug === slug;
    });

    if (!story) {
      return NextResponse.json(
        {
          success: false,
          message: 'Story not found',
        },
        { status: 404 }
      );
    }

    const currentAssertions = providedAssertions || story.baselineAssertions;

    // Create backup if applying changes
    let backupPath: string | null = null;
    if (apply) {
      backupPath = await createBackup(specFile);
      if (backupPath) {
        logger.info(`[test-edit] Backup created at ${backupPath}`);
      }
    }

    // Call OpenAI to modify the assertions
    const outline = providedOutline && providedOutline.length > 0 ? providedOutline : story.playwrightOutline;
    const formFieldLabels = providedContext?.formFieldLabels ?? story.detectedFormFieldLabels ?? [];
    const entryUrlHint = providedContext?.entryUrl ?? story.entryUrl;
    const primaryCtaHint = providedContext?.primaryCtaLabel ?? story.primaryCtaLabel ?? undefined;
    const primaryActionHint = providedContext?.primaryActionLabel ?? story.primaryActionLabel ?? undefined;
    const primaryOutcomeHint = providedContext?.primaryActionOutcome ?? story.primaryActionOutcome ?? undefined;

    const outlineSection =
      outline.length > 0
        ? `Existing outline steps:\n${outline.map((line) => `- ${line}`).join('\n')}\n`
        : '';

    const formHint =
      formFieldLabels.length > 0
        ? `Detected form field labels (prefer targeting these inputs directly): ${formFieldLabels.join(', ')}.`
        : 'No <form> elements were detected during the crawl; avoid assuming role="form" elements exist unless you add them manually.';

    const contextLines = [
      `Entry URL: ${entryUrlHint}`,
      primaryCtaHint ? `Primary CTA label: ${primaryCtaHint}` : null,
      primaryActionHint ? `Primary action label: ${primaryActionHint}` : null,
      primaryOutcomeHint
        ? primaryOutcomeHint.kind === 'navigation'
          ? `Observed outcome: navigation${primaryOutcomeHint.targetUrl ? ` to ${primaryOutcomeHint.targetUrl}` : ''}.`
          : `Observed outcome: ${primaryOutcomeHint.kind}.`
        : null,
      formHint,
    ]
      .filter(Boolean)
      .join('\n');

    const systemPrompt = `You are a test quality expert. Your task is to modify baseline assertions (user-friendly test requirements) based on user instructions.

Rules:
1. Return ONLY a JSON array of assertion strings, no explanations
2. Each assertion should be a clear, human-readable sentence describing what to check
3. Keep assertions concise and testable
4. Preserve assertions that are not being modified
5. Format: ["Assertion 1", "Assertion 2", ...]

The user will provide:
- Current baseline assertions
- A natural language instruction to modify them

Return the modified assertions as a JSON array.`;

    const userPrompt = `Context:
${contextLines}

${outlineSection}

Current baseline assertions:

${JSON.stringify(currentAssertions, null, 2)}

User instruction: "${instruction}"

Provide the modified baseline assertions as a JSON array:`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.2,
      max_tokens: 2000,
      response_format: { type: 'json_object' },
    });

    const responseContent = completion.choices[0]?.message?.content?.trim() || '{}';
    let modifiedAssertions: string[];

    try {
      const parsed = JSON.parse(responseContent);
      // Handle both {assertions: [...]} and direct array
      modifiedAssertions = Array.isArray(parsed) ? parsed : parsed.assertions || parsed.baselineAssertions || [];
    } catch {
      // Fallback: try to extract array from text
      const arrayMatch = responseContent.match(/\[[\s\S]*?\]/);
      if (arrayMatch) {
        modifiedAssertions = JSON.parse(arrayMatch[0]);
      } else {
        throw new Error('Failed to parse modified assertions from AI response');
      }
    }

    if (!Array.isArray(modifiedAssertions) || modifiedAssertions.length === 0) {
      throw new Error('AI did not return a valid array of assertions');
    }

    // Apply changes if requested
    if (apply) {
      // Update the story in the appropriate file
      let updatedStories: UserStory[];

      if (isCustomStory) {
        // Update custom-stories.json
        const updatedCustomStories = customStories.map((s) => {
          const storySlug = sanitizeFileSlug(s.suggestedScriptName, s.id ?? s.suggestedScriptName);
          if (storySlug === slug) {
            return { ...s, baselineAssertions: modifiedAssertions };
          }
          return s;
        });

        await ensureDir(dirname(customStoriesPath));
        await writeFile(
          customStoriesPath,
          JSON.stringify({ stories: updatedCustomStories }, null, 2) + '\n',
          'utf8'
        );
        logger.info(`[test-edit] Updated custom stories at ${customStoriesPath}`);
        updatedStories = updatedCustomStories;
      } else {
        // Update user-stories.json
        updatedStories = stories.map((s) => {
          const storySlug = sanitizeFileSlug(s.suggestedScriptName, s.id ?? s.suggestedScriptName);
          if (storySlug === slug) {
            return { ...s, baselineAssertions: modifiedAssertions };
          }
          return s;
        });

        await ensureDir(dirname(storiesFilePath));
        await writeFile(storiesFilePath, JSON.stringify(updatedStories, null, 2) + '\n', 'utf8');
        logger.info(`[test-edit] Updated user stories at ${storiesFilePath}`);
      }

      // Regenerate Playwright code from updated assertions
      // Note: This is a simplified version - in production, you'd want to call the full storyBuilder
      // For now, we'll read the current code and update it based on assertions
      let currentCode = '';
      try {
        currentCode = await readFile(specFile, 'utf8');
      } catch {
        // File doesn't exist yet, will generate from scratch
        currentCode = `import { test, expect } from '@playwright/test';

test.describe('${story.title}', () => {
  test('should validate baseline assertions', async ({ page }) => {
    await page.goto('${story.entryUrl}');
    // Assertions will be generated by AI
  });
});`;
      }

      // Use AI to regenerate the Playwright code from the assertions
      const codeContextLines = [
        `Entry URL: ${entryUrlHint}`,
        primaryCtaHint ? `Primary CTA label: ${primaryCtaHint}` : null,
        primaryActionHint ? `Primary action label: ${primaryActionHint}` : null,
        primaryOutcomeHint
          ? primaryOutcomeHint.kind === 'navigation'
            ? `Observed navigation outcome${primaryOutcomeHint.targetUrl ? ` to ${primaryOutcomeHint.targetUrl}` : ''}.`
            : `Observed outcome after action: ${primaryOutcomeHint.kind}.`
          : null,
        formHint,
      ]
        .filter(Boolean)
        .join('\n');

      const codePrompt = `You are a Playwright expert. Generate a complete Playwright test from these baseline assertions:

${JSON.stringify(modifiedAssertions, null, 2)}

Context:
${codeContextLines}

Current test code structure:
\`\`\`typescript
${currentCode}
\`\`\`

Generate the complete updated Playwright test code that validates all the assertions. Keep the same structure (describe block, test block) but update the assertions to match the new baseline assertions.

Return ONLY the complete code, wrapped in a markdown code block.`;

      const codeCompletion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: 'You are a Playwright test expert. Generate valid Playwright test code.',
          },
          { role: 'user', content: codePrompt },
        ],
        temperature: 0.2,
        max_tokens: 4000,
      });

      const modifiedCodeRaw = codeCompletion.choices[0]?.message?.content?.trim() || '';
      const codeBlockMatch = modifiedCodeRaw.match(/```(?:typescript|ts)?\n([\s\S]*?)\n```/);
      const modifiedCode = codeBlockMatch ? codeBlockMatch[1] : modifiedCodeRaw;

      await ensureDir(specDir);
      await writeFile(specFile, modifiedCode, 'utf8');

      if (domain) {
        const latestDir = join(DOMAINS_ROOT, domain, 'latest');
        const latestStories = join(latestDir, 'user-stories.json');
        const latestSpecDir = join(latestDir, 'playwright');
        await ensureDir(latestDir);
        await ensureDir(latestSpecDir);
        await writeFile(latestStories, JSON.stringify(updatedStories, null, 2) + '\n', 'utf8');
        const latestSpecFile = join(latestSpecDir, `${slug}.spec.ts`);
        await writeFile(latestSpecFile, modifiedCode, 'utf8');
        logger.info(`[test-edit] Synced changes to latest snapshot at ${latestDir}`);
      } else if (crawlId) {
        const legacyStories = join(OUTPUT_DIR, crawlId, 'user-stories.json');
        const legacySpecDir = join(OUTPUT_DIR, crawlId, 'playwright');
        await ensureDir(legacySpecDir);
        await writeFile(legacyStories, JSON.stringify(updatedStories, null, 2) + '\n', 'utf8');
        await writeFile(join(legacySpecDir, `${slug}.spec.ts`), modifiedCode, 'utf8');
        logger.info(`[test-edit] Synced changes to legacy crawl at ${legacySpecDir}`);
      }
    }

    logger.info(
      `[test-edit] ${apply ? 'Applied' : 'Previewed'} changes for slug=${slug} domain=${domain ?? 'legacy'
      } crawlId=${crawlId ?? 'latest'}`
    );

    return NextResponse.json({
      success: true,
      original: currentAssertions,
      modified: modifiedAssertions,
      message: apply ? 'Test modified successfully' : 'Preview generated',
      backupPath: apply ? backupPath : undefined,
    });
  } catch (error) {
    logger.error(
      `[test-edit] Failed to modify slug=${slug} domain=${domain ?? 'legacy'} crawlId=${crawlId ?? 'latest'
      }: ${(error as Error).message}`
    );
    return NextResponse.json(
      {
        success: false,
        message: 'Failed to modify test',
        error: (error as Error).message,
      },
      { status: 500 }
    );
  }
}
