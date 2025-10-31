// This file converts crawl metadata into heuristic user story suggestions grouped by story kind.

import { createHash } from 'node:crypto';

import type { CrawlResult, PageSummary, StoryKind, UserStory } from '../types';

const STORY_LIMIT_PER_KIND = 3;

const AUTH_KEYWORDS = ['login', 'log in', 'sign in', 'connexion'];

const toSlug = (input: string): string =>
  input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .trim()
    .replace(/-+/g, '-');

const pickStoryKind = (page: PageSummary): StoryKind => {
  const hasPasswordField = page.forms.some((form) => form.fields.some((field) => field.type === 'password'));
  const hasAuthKeyword = AUTH_KEYWORDS.some((keyword) => page.title.toLowerCase().includes(keyword));

  if (hasPasswordField || hasAuthKeyword) {
    return 'authentication';
  }

  const complexForm = page.forms.some(
    (form) => form.fields.length >= 4 || form.fields.some((field) => field.type === 'select' || field.type === 'textarea')
  );
  if (complexForm) {
    return 'complex';
  }

  if (page.interactiveElementCount >= 3 || page.hasScrollableSections) {
    return 'interaction';
  }

  return 'browsing';
};

const buildDescription = (page: PageSummary, kind: StoryKind): string => {
  switch (kind) {
    case 'authentication':
      return `Validate authentication flow on ${page.title || page.url}, ensuring login succeeds with provided test credentials.`;
    case 'complex':
      return `Exercise complex form interactions on ${page.title || page.url}, filling mandatory fields and submitting.`;
    case 'interaction':
      return `Confirm interactive elements work on ${page.title || page.url}, covering key buttons and scrolling experiences.`;
    case 'browsing':
    default:
      return `Traverse navigation on ${page.title || page.url}, verifying main links render without errors.`;
  }
};

const deriveScriptName = (page: PageSummary, kind: StoryKind): string => {
  const slugSource = page.title || page.url.split('/').filter(Boolean).pop() || 'story';
  const slug = toSlug(slugSource);
  return `${kind}-${slug || 'flow'}`;
};

const buildId = (page: PageSummary, kind: StoryKind): string => {
  const hash = createHash('sha1').update(`${page.url}-${kind}`).digest('hex').slice(0, 8);
  return `${kind}-${hash}`;
};

export const identifyUserStories = (crawl: CrawlResult): UserStory[] => {
  const grouped: Record<StoryKind, UserStory[]> = {
    authentication: [],
    browsing: [],
    complex: [],
    interaction: [],
  };

  for (const page of crawl.pages.values()) {
    const kind = pickStoryKind(page);
    if (grouped[kind].length >= STORY_LIMIT_PER_KIND) {
      continue;
    }

    const supporting = crawl.edges.get(page.url) ?? [];

    const story: UserStory = {
      id: buildId(page, kind),
      kind,
      title: page.title || page.url,
      entryUrl: page.url,
      description: buildDescription(page, kind),
      suggestedScriptName: deriveScriptName(page, kind),
      supportingPages: supporting.slice(0, 5),
    };

    grouped[kind].push(story);
  }

  return Object.values(grouped).flat();
};
