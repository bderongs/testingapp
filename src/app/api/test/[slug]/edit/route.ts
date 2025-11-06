// This file provides an API endpoint to modify Playwright tests by editing baseline assertions using AI.
import { readFile, writeFile, copyFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { z } from 'zod';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic'; // Prevent static generation at build time

// Check if we're in build mode (Next.js sets this during build)
const isBuildTime = process.env.NEXT_PHASE === 'phase-production-build' || 
                     process.env.NODE_ENV === 'production' && !process.env.VERCEL && !process.env.RAILWAY_ENVIRONMENT;

const requestSchema = z.object({
  instruction: z.string().min(1, 'Instruction is required'),
  apply: z.boolean().optional().default(false),
  baselineAssertions: z.array(z.string()).optional(),
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
const SPEC_DIR = join(OUTPUT_DIR, 'playwright');
const STORIES_FILE = join(OUTPUT_DIR, 'user-stories.json');

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
const BACKUP_DIR = join(process.cwd(), 'output', 'playwright', '.backups');

const ensureBackupDir = async (): Promise<void> => {
  try {
    await mkdir(BACKUP_DIR, { recursive: true });
  } catch {
    // Directory might already exist, ignore
  }
};

const createBackup = async (specFile: string): Promise<string> => {
  await ensureBackupDir();
  const fileName = specFile.split('/').pop() || 'unknown.spec.ts';
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = join(BACKUP_DIR, `${fileName}.${timestamp}.backup`);
  await copyFile(specFile, backupPath);
  return backupPath;
};

const readJson = async <T>(filePath: string, label: string): Promise<T | null> => {
  try {
    const content = await readFile(filePath, 'utf8');
    return JSON.parse(content) as T;
  } catch (error) {
    console.error(`[edit] Failed to read ${label} from ${filePath}:`, error);
    return null;
  }
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
  
  // Get crawlId from query parameter or use latest crawl
  const url = new URL(request.url);
  const crawlIdParam = url.searchParams.get('crawlId');
  const crawlId = crawlIdParam || await findLatestCrawlId();
  
  // Determine which directory to use
  const crawlDir = crawlId ? join(OUTPUT_DIR, crawlId) : OUTPUT_DIR;
  const specDir = crawlId ? join(crawlDir, 'playwright') : SPEC_DIR;
  const specFile = join(specDir, `${slug}.spec.ts`);

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

    const { instruction, apply, baselineAssertions: providedAssertions } = parse.data;

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

    // Get crawlId from query parameter or use latest crawl
    const url = new URL(request.url);
    const crawlIdParam = url.searchParams.get('crawlId');
    const crawlId = crawlIdParam || await findLatestCrawlId();
    
    // Determine which directory to use
    const crawlDir = crawlId ? join(OUTPUT_DIR, crawlId) : OUTPUT_DIR;
    const storiesFile = crawlId ? join(crawlDir, 'user-stories.json') : STORIES_FILE;
    const specDir = crawlId ? join(crawlDir, 'playwright') : SPEC_DIR;

    // Load user stories to get current assertions
    const stories = (await readJson<Array<{ suggestedScriptName: string; baselineAssertions: string[] }>>(
      storiesFile,
      'stories'
    )) ?? [];
    
    const story = stories.find((s) => {
      const storySlug = s.suggestedScriptName.replace(/[^a-z0-9-]/g, '');
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
    let backupPath: string | undefined;
    if (apply) {
      backupPath = await createBackup(specFile);
    }

    // Call OpenAI to modify the assertions
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

    const userPrompt = `Current baseline assertions:

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
      // Update the story in user-stories.json
      const updatedStories = stories.map((s) => {
        const storySlug = s.suggestedScriptName.replace(/[^a-z0-9-]/g, '');
        if (storySlug === slug) {
          return { ...s, baselineAssertions: modifiedAssertions };
        }
        return s;
      });

      const storiesFile = crawlId ? join(crawlDir, 'user-stories.json') : STORIES_FILE;
      await writeFile(storiesFile, JSON.stringify(updatedStories, null, 2) + '\n', 'utf8');

      // Regenerate Playwright code from updated assertions
      // Note: This is a simplified version - in production, you'd want to call the full storyBuilder
      // For now, we'll read the current code and update it based on assertions
      const currentCode = await readFile(specFile, 'utf8');
      
      // Use AI to regenerate the Playwright code from the assertions
      const codePrompt = `You are a Playwright expert. Generate a complete Playwright test from these baseline assertions:

${JSON.stringify(modifiedAssertions, null, 2)}

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

      await writeFile(specFile, modifiedCode, 'utf8');
    }

    return NextResponse.json({
      success: true,
      original: currentAssertions,
      modified: modifiedAssertions,
      message: apply ? 'Test modified successfully' : 'Preview generated',
      backupPath: apply ? backupPath : undefined,
    });
  } catch (error) {
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
