// This file converts crawl metadata into heuristic user story suggestions grouped by story kind.

import { createHash } from 'node:crypto';

import type { CrawlResult, PageSummary, StoryKind, UserStory } from '../types';
import { normalizeUrl, safeResolve } from '../utils/url';

const STORY_LIMIT_PER_KIND = 3;

const AUTH_KEYWORDS = ['login', 'log in', 'sign in', 'connexion'];
const CTA_KEYWORDS = ['pricing', 'price', 'contact', 'demo', 'start', 'signup', 'sign up', 'book', 'trial', 'quote'];
const PERSONA_KEYWORDS: Record<string, readonly string[]> = {
  builders: ['developer', 'engineer', 'technical', 'api'],
  design: ['designer', 'ui', 'ux', 'creative'],
  marketing: ['marketing', 'growth', 'campaign'],
  operations: ['operations', 'workflow', 'automation'],
  leadership: ['executive', 'founder', 'leadership', 'strategy'],
};

const SCHEMA_KIND_MAP: Record<string, StoryKind> = {
  authentication: 'authentication',
  loginpage: 'authentication',
  contactpage: 'interaction',
  product: 'interaction',
  faqpage: 'browsing',
  aboutpage: 'browsing',
  collectionpage: 'browsing',
};

interface NavReference {
  readonly path: string;
  readonly itemLabel: string;
  readonly sectionLabel?: string;
  readonly depth: number;
}

interface StoryCandidate {
  readonly page: PageSummary;
  readonly kind: StoryKind;
  readonly score: number;
  readonly navRefs: readonly NavReference[];
  readonly personaTag?: string;
  readonly goalSummary?: string;
}

const toSlug = (input: string): string =>
  input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .trim()
    .replace(/-+/g, '-');

const buildNavigationIndex = (crawl: CrawlResult): Map<string, NavReference[]> => {
  const index = new Map<string, NavReference[]>();

  for (const page of crawl.pages.values()) {
    page.navigationSections.forEach((section) => {
      section.items.forEach((item) => {
        const resolved = safeResolve(page.url, item.url);
        if (!resolved) {
          return;
        }

        const normalized = normalizeUrl(resolved);
        const entry: NavReference = {
          path: [section.label, item.text].filter(Boolean).join(' -> ') || item.text,
          itemLabel: item.text,
          sectionLabel: section.label,
          depth: item.depth,
        };

        const existing = index.get(normalized);
        if (existing) {
          existing.push(entry);
        } else {
          index.set(normalized, [entry]);
        }
      });
    });
  }

  return index;
};

const detectPersona = (page: PageSummary): string | undefined => {
  const haystack = `${page.title} ${page.metaDescription ?? ''} ${page.primaryKeywords.join(' ')}`.toLowerCase();
  return Object.entries(PERSONA_KEYWORDS).find(([, keywords]) => keywords.some((keyword) => haystack.includes(keyword)))?.[0];
};

const detectGoal = (page: PageSummary, navRefs: readonly NavReference[]): string | undefined => {
  const textSources = [page.title, page.metaDescription ?? '', ...page.primaryKeywords, ...navRefs.map((ref) => ref.itemLabel)];
  const haystack = textSources.join(' ').toLowerCase();

  if (haystack.includes('pricing') || haystack.includes('plans')) {
    return 'compare pricing and plan options';
  }
  if (haystack.includes('contact') || haystack.includes('support')) {
    return 'contact the team for support or sales';
  }
  if (haystack.includes('demo') || haystack.includes('book')) {
    return 'request a product demonstration';
  }
  if (haystack.includes('docs') || haystack.includes('documentation')) {
    return 'explore product documentation';
  }
  if (haystack.includes('blog') || haystack.includes('news')) {
    return 'read recent updates and insights';
  }

  const schemaGoal = page.schemaOrgTypes
    .map((entry) => entry.toLowerCase())
    .find((schema) => {
      if (schema.includes('contactpage')) {
        return true;
      }
      if (schema.includes('product')) {
        return true;
      }
      if (schema.includes('faqpage')) {
        return true;
      }
      return false;
    });

  if (schemaGoal) {
    if (schemaGoal.includes('contactpage')) {
      return 'submit a contact request';
    }
    if (schemaGoal.includes('product')) {
      return 'evaluate the product offering';
    }
    if (schemaGoal.includes('faqpage')) {
      return 'review frequently asked questions';
    }
  }

  return undefined;
};

const pickStoryKind = (page: PageSummary, navRefs: readonly NavReference[]): StoryKind => {
  const normalizedTitle = page.title.toLowerCase();
  const hasPasswordField = page.forms.some((form) => form.fields.some((field) => field.type === 'password'));
  const hasAuthKeyword = AUTH_KEYWORDS.some((keyword) => normalizedTitle.includes(keyword));
  if (hasPasswordField || hasAuthKeyword) {
    return 'authentication';
  }

  const schemaOverride = page.schemaOrgTypes
    .map((type) => SCHEMA_KIND_MAP[type.toLowerCase()])
    .find((kind): kind is StoryKind => Boolean(kind));
  if (schemaOverride) {
    return schemaOverride;
  }

  const forms = page.forms.filter((form) => form.fields.length > 0);
  const complexForm = forms.some(
    (form) => form.fields.length >= 4 || form.fields.some((field) => field.type === 'select' || field.type === 'textarea')
  );
  if (complexForm) {
    return 'complex';
  }

  const ctaTextCandidates = [normalizedTitle, ...page.primaryKeywords.map((keyword) => keyword.toLowerCase()), ...navRefs.map((ref) => ref.itemLabel.toLowerCase())];
  const hasCtaCue = CTA_KEYWORDS.some((keyword) => ctaTextCandidates.some((candidate) => candidate.includes(keyword)));

  if (hasCtaCue || page.interactiveElementCount >= 3 || forms.length > 0) {
    return 'interaction';
  }

  return 'browsing';
};

const computeScore = (page: PageSummary, kind: StoryKind, navRefs: readonly NavReference[], personaTag?: string): number => {
  let score = 0;

  if (navRefs.length > 0) {
    score += 40;
    if (navRefs.some((ref) => ref.depth === 0)) {
      score += 20;
    }
  }

  if (kind === 'authentication') {
    score += 35;
  }
  if (kind === 'complex') {
    score += 25;
  }
  if (kind === 'interaction') {
    score += 15;
  }

  if (page.forms.length > 0) {
    score += 10;
  }

  if (page.schemaOrgTypes.length > 0) {
    score += 12;
  }

  const ctaMatches = CTA_KEYWORDS.filter((keyword) =>
    [page.title, ...page.primaryKeywords].some((value) => value.toLowerCase().includes(keyword))
  );
  if (ctaMatches.length > 0) {
    score += 18;
  }

  if (personaTag) {
    score += 8;
  }

  score += Math.min(page.interactiveElementCount, 10);

  return score;
};

const buildDescription = (
  page: PageSummary,
  kind: StoryKind,
  navRefs: readonly NavReference[],
  personaTag: string | undefined,
  goal: string | undefined
): string => {
  const navHint = navRefs[0]
    ? ` via ${navRefs[0].path}`
    : '';
  const personaHint = personaTag ? ` for ${personaTag} personas` : '';
  const goalHint = goal ? ` to ${goal}` : '';

  const pageLabel = page.title || page.url;

  switch (kind) {
    case 'authentication':
      return `Validate authentication on ${pageLabel}${navHint}${personaHint}, ensuring login works with provided test credentials${goalHint}.`;
    case 'complex':
      return `Complete the key form on ${pageLabel}${navHint}${personaHint}, filling mandatory fields and submitting${goalHint}.`;
    case 'interaction':
      return `Exercise the primary CTA on ${pageLabel}${navHint}${personaHint}${goalHint}, confirming interactive elements behave as expected.`;
    case 'browsing':
    default:
      return `Navigate through ${pageLabel}${navHint}${personaHint}${goalHint}, verifying the content loads and links resolve.`;
  }
};

const deriveScriptName = (page: PageSummary, kind: StoryKind, navRefs: readonly NavReference[]): string => {
  const fallback = page.title || page.url.split('/').filter(Boolean).pop() || 'story';
  const primaryLabel = navRefs[0]?.itemLabel ?? fallback;
  const slug = toSlug(primaryLabel);
  return `${kind}-${slug || 'flow'}`;
};

const buildId = (page: PageSummary, kind: StoryKind): string => {
  const hash = createHash('sha1').update(`${page.url}-${kind}`).digest('hex').slice(0, 8);
  return `${kind}-${hash}`;
};

export const identifyUserStories = (crawl: CrawlResult): UserStory[] => {
  const navigationIndex = buildNavigationIndex(crawl);

  const candidates: StoryCandidate[] = [];

  for (const page of crawl.pages.values()) {
    const normalizedUrl = normalizeUrl(page.url);
    const navRefs = navigationIndex.get(normalizedUrl) ?? [];
    const kind = pickStoryKind(page, navRefs);
    const persona = detectPersona(page);
    const goal = detectGoal(page, navRefs);
    const score = computeScore(page, kind, navRefs, persona);

    candidates.push({
      page,
      kind,
      score,
      navRefs,
      personaTag: persona,
      goalSummary: goal,
    });
  }

  candidates.sort((a, b) => b.score - a.score);

  const grouped: Record<StoryKind, UserStory[]> = {
    authentication: [],
    browsing: [],
    complex: [],
    interaction: [],
  };

  const selectedUrls = new Set<string>();

  for (const candidate of candidates) {
    const { page, kind, navRefs, personaTag, goalSummary } = candidate;
    const normalizedUrl = normalizeUrl(page.url);

    if (selectedUrls.has(`${normalizedUrl}-${kind}`)) {
      continue;
    }

    if (grouped[kind].length >= STORY_LIMIT_PER_KIND) {
      continue;
    }

    const supporting = crawl.edges.get(page.url) ?? [];

    const story: UserStory = {
      id: buildId(page, kind),
      kind,
      title: page.title || page.url,
      entryUrl: page.url,
      description: buildDescription(page, kind, navRefs, personaTag, goalSummary),
      suggestedScriptName: deriveScriptName(page, kind, navRefs),
      supportingPages: supporting.slice(0, 5),
    };

    grouped[kind].push(story);
    selectedUrls.add(`${normalizedUrl}-${kind}`);
  }

  return Object.values(grouped).flat();
};
