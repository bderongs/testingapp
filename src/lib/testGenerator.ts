import type OpenAI from 'openai';
import { logger } from '../utils/logger';
import type { PageSummary, UserStory } from '../types';

let openAiClientPromise: Promise<OpenAI> | null = null;

const loadOpenAiClient = async (): Promise<OpenAI | null> => {
  if (!process.env.OPENAI_API_KEY) {
    return null;
  }
  if (!openAiClientPromise) {
    openAiClientPromise = import('openai').then(
      ({ default: OpenAIClient }) => new OpenAIClient({ apiKey: process.env.OPENAI_API_KEY! })
    );
  }
  try {
    return await openAiClientPromise;
  } catch (error) {
    logger.warn(`Failed to initialize OpenAI client: ${(error as Error).message}`);
    return null;
  }
};

export const generatePlaywrightTest = async (
  story: UserStory,
  page: PageSummary
): Promise<string | null> => {
  const client = await loadOpenAiClient();
  if (!client) {
    logger.warn('OpenAI client not available, skipping test generation.');
    return null;
  }

  const prompt = `You are an expert Playwright test generator.
I will provide you with a "User Story" and the "Page Summary" (metadata about the page).
Your task is to write a complete, runnable Playwright test file (.spec.ts) for this story.

User Story:
Title: ${story.title}
Description: ${story.description}
Kind: ${story.kind}
Suggested Script Name: ${story.suggestedScriptName}
Expected Outcome: ${story.expectedOutcome}
Suggested Steps (Heuristic):
${story.playwrightOutline?.map(step => `- ${step}`).join('\n') ?? 'None'}

Page Summary:
URL: ${page.url}
Title: ${page.title}
Primary CTAs: ${JSON.stringify(page.primaryCtas)}
Forms: ${JSON.stringify(page.forms)}
Headings: ${JSON.stringify(page.headingOutline.slice(0, 5))}

Instructions:
1. Import { test, expect } from '@playwright/test'.
2. Write a single test('...') block.
3. Use the provided URL to navigate: await page.goto('${page.url}', { waitUntil: 'networkidle' });
4. **CRITICAL**: The PRIMARY CTA is the main action for this test. Focus on reaching and clicking the PRIMARY CTA.
   - Primary CTA from Page Summary: ${JSON.stringify(page.primaryCtas?.[0]?.label || 'Unknown')}
   - Any buttons with "another", "more", or "additional" are OPTIONAL secondary actions - do NOT include them unless absolutely necessary.
5. Fill in ONLY the REQUIRED form fields (marked as required: true in Forms data).
   - For select fields, use the exact value or label from the "options" array provided in Forms data.
   - Example: If options are [{"value": "USD", "label": "USD - US Dollar"}], use: selectOption('USD') or selectOption({ label: 'USD - US Dollar' })
6. Use robust, accessible locators based strictly on the Page Summary data.
   - PREFER: page.getByLabel('...'), page.getByRole('button', { name: '...' }), page.getByPlaceholder('...')
   - AVOID: input[name="..."] unless the name is explicitly listed in the Forms data.
   - AVOID: generic CSS selectors like .class or #id unless necessary.
7. ALWAYS await expect(locator).toBeVisible() before clicking or interacting with elements.
8. After form submission, verify that navigation occurred (URL changed from the starting page).
   - Use flexible URL matching: await expect(page).not.toHaveURL('${page.url}') to confirm navigation happened.
   - Do NOT assert exact URLs unless you have explicit information about where the form redirects.
   - For create/submit actions, the app may redirect to a detail page with a dynamic ID (e.g., /groups/[id]).
9. Keep the test simple and focused - do NOT add optional steps that aren't required to reach the primary CTA.
10. Return ONLY the code, no markdown formatting, no explanation.
`;

  try {
    const completion = await client.chat.completions.create({
      model: 'gpt-4o',
      temperature: 0.2,
      messages: [
        { role: 'system', content: 'You are a code generator for Playwright tests.' },
        { role: 'user', content: prompt },
      ],
    });

    let code = completion.choices[0]?.message?.content?.trim();
    if (!code) return null;

    // Strip markdown code blocks if present
    if (code.startsWith('```')) {
      code = code.replace(/^```(?:typescript|ts)?\n/, '').replace(/\n```$/, '');
    }

    return code;
  } catch (error) {
    logger.error(`Failed to generate test for story ${story.id}: ${(error as Error).message}`);
    return null;
  }
};
