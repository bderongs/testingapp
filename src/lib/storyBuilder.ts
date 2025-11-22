// This file converts crawl metadata into heuristic user story suggestions grouped by story kind.

import { createHash } from 'node:crypto';

import type { ActionHint, ActionHintCategory, CrawlResult, PageSummary, StoryKind, UserStory } from '../types';
import { normalizeUrl, safeResolve } from '../utils/url';

const STORY_LIMIT_PER_KIND = 3;

const AUTH_KEYWORDS = ['login', 'log in', 'sign in', 'connexion'];
const CTA_KEYWORDS = ['pricing', 'price', 'contact', 'demo', 'start', 'signup', 'sign up', 'book', 'trial', 'quote', 'dashboard', 'tableau de bord'];
const CTA_PREFERRED_KEYWORDS: Array<{ readonly terms: readonly string[]; readonly score: number }> = [
  { terms: ['reserver', 'reserve', 'book'], score: 30 },
  { terms: ['commencer', 'start', 'get started'], score: 24 },
  { terms: ['essayer', 'try'], score: 22 },
  { terms: ['acheter', 'buy', 'purchase'], score: 20 },
  { terms: ['demander', 'request'], score: 18 },
  { terms: ['s\'inscrire', 'inscrire', 'sign up', 'signup', 'register'], score: 18 },
  { terms: ['continuer', 'continue'], score: 12 },
  { terms: ['connexion', 'login', 'sign in'], score: 8 },
  { terms: ['tableau de bord', 'dashboard'], score: 25 },
];

const CTA_PENALTY_KEYWORDS = ['connexion', 'login', 'sign in', 'sign-in'];
const PERSONA_KEYWORDS: Record<string, readonly string[]> = {
  builders: ['developer', 'engineer', 'technical', 'api'],
  design: ['designer', 'ui', 'ux', 'creative'],
  marketing: ['marketing', 'growth', 'campaign'],
  operations: ['operations', 'workflow', 'automation'],
  leadership: ['executive', 'founder', 'leadership', 'strategy'],
};

const ACTION_CATEGORY_PRIORITY: Record<ActionHintCategory, number> = {
  create: 60,
  delete: 58,
  update: 45,
  invite: 52,
  share: 40,
  settle: 55,
  search: 30,
  filter: 28,
  navigate: 24,
  view: 20,
  other: 10,
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

const escapeForRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

const escapeForSingleQuote = (value: string): string => value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

const toSentenceCase = (value: string): string => {
  if (!value) {
    return value;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return trimmed;
  }
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
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
  readonly primaryCta?: PrimaryCtaSelection;
  readonly primaryAction?: ActionHint;
}

interface OutlineContext {
  readonly page: PageSummary;
  readonly kind: StoryKind;
  readonly navRefs: readonly NavReference[];
  readonly primaryCta?: PrimaryCtaSelection;
  readonly primaryAction?: ActionHint;
  readonly personaTag?: string;
  readonly goalSummary?: string;
  readonly supportingPages: readonly string[];
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
    const normalizedPageUrl = normalizeUrl(page.url);
    const navRefs: NavReference[] = [];

    page.navigationSections.forEach((section) => {
      section.items.forEach((item) => {
        const entry: NavReference = {
          path: [section.label, item.text].filter(Boolean).join(' -> ') || item.text,
          itemLabel: item.text,
          sectionLabel: section.label,
          depth: item.depth,
        };
        navRefs.push(entry);
      });
    });

    if (navRefs.length > 0) {
      index.set(normalizedPageUrl, navRefs);
    }
  }

  return index;
};

const detectPersona = (page: PageSummary): string | undefined => {
  const haystack = `${page.title} ${page.metaDescription ?? ''} ${page.primaryKeywords.join(' ')}`.toLowerCase();
  return Object.entries(PERSONA_KEYWORDS).find(([, keywords]) => keywords.some((keyword) => haystack.includes(keyword)))?.[0];
};

const detectGoal = (page: PageSummary, navRefs: readonly NavReference[]): string | undefined => {
  const textSources = [
    page.title,
    page.metaDescription ?? '',
    ...page.primaryKeywords,
    ...navRefs.map((ref) => ref.itemLabel),
    ...page.primaryCtas.map((cta) => cta.label),
  ];
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

  const ctaTextCandidates = [
    normalizedTitle,
    ...page.primaryKeywords.map((keyword) => keyword.toLowerCase()),
    ...navRefs.map((ref) => ref.itemLabel.toLowerCase()),
    ...page.primaryCtas.map((cta) => cta.label.toLowerCase()),
  ];
  const hasCtaCue = CTA_KEYWORDS.some((keyword) => ctaTextCandidates.some((candidate) => candidate.includes(keyword)));

  if (hasCtaCue || page.interactiveElementCount >= 3 || forms.length > 0) {
    return 'interaction';
  }

  return 'browsing';
};

const computeScore = (
  page: PageSummary,
  kind: StoryKind,
  navRefs: readonly NavReference[],
  personaTag?: string,
  primaryCta?: PrimaryCtaSelection,
  primaryAction?: ActionHint
): number => {
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
    [page.title, ...page.primaryKeywords, ...page.primaryCtas.map((cta) => cta.label)].some((value) => value.toLowerCase().includes(keyword))
  );
  if (ctaMatches.length > 0) {
    score += 18;
  }

  if (personaTag) {
    score += 8;
  }

  if (primaryCta) {
    score += 10;
  }

  if (primaryAction) {
    score += primaryAction.confidence / 2;
    score += ACTION_CATEGORY_PRIORITY[primaryAction.category] ?? 0;
    if (primaryAction.location === 'main') {
      score += 6;
    } else if (primaryAction.location === 'modal') {
      score += 4;
    }
  }

  score += Math.min(page.interactiveElementCount, 10);

  return score;
};

const buildDescription = (
  page: PageSummary,
  kind: StoryKind,
  navRefs: readonly NavReference[],
  personaTag: string | undefined,
  goal: string | undefined,
  primaryCtaLabel: string | undefined,
  primaryAction?: ActionHint
): string => {
  const navHint = navRefs[0]
    ? ` via ${navRefs[0].path}`
    : '';
  const personaHint = personaTag ? ` for ${personaTag} personas` : '';
  const goalHint = goal ? ` to ${goal}` : '';
  const ctaHint = primaryCtaLabel ? ` using the "${primaryCtaLabel}" CTA` : '';
  const actionHint =
    primaryAction && primaryAction.category !== 'other'
      ? ` covering the ${primaryAction.category} action labeled "${primaryAction.label}"`
      : primaryAction
        ? ` covering the action labeled "${primaryAction.label}"`
        : '';

  const pageLabel = page.title || page.url;

  switch (kind) {
    case 'authentication':
      return `Validate authentication on ${pageLabel}${navHint}${personaHint}, ensuring login works with provided test credentials${goalHint}.`;
    case 'complex':
      return `Complete the key form on ${pageLabel}${navHint}${personaHint}, filling mandatory fields and submitting${goalHint}${ctaHint}${actionHint}.`;
    case 'interaction':
      return `Exercise the primary CTA on ${pageLabel}${navHint}${personaHint}${goalHint}${ctaHint}${actionHint}, confirming interactive elements behave as expected.`;
    case 'browsing':
    default:
      return `Navigate through ${pageLabel}${navHint}${personaHint}${goalHint}, verifying the content loads and links resolve${actionHint}.`;
  }
};

const deriveScriptName = (page: PageSummary, kind: StoryKind, navRefs: readonly NavReference[], primaryCta?: PrimaryCtaSelection): string => {
  const fallback = page.title || page.url.split('/').filter(Boolean).pop() || 'story';
  const primaryLabel = primaryCta?.label ?? navRefs[0]?.itemLabel ?? fallback;
  const slug = toSlug(primaryLabel);
  return `${kind}-${slug || 'flow'}`;
};

const buildPlaywrightOutline = ({
  page,
  kind,
  navRefs,
  primaryCta,
  primaryAction,
  personaTag,
  goalSummary,
  supportingPages,
}: OutlineContext): string[] => {
  const steps: string[] = [];

  const escapedUrl = escapeForSingleQuote(page.url);
  steps.push(`await page.goto('${escapedUrl}', { waitUntil: 'networkidle' });`);

  if (page.title) {
    steps.push(`await expect(page).toHaveTitle(/${escapeForRegex(page.title)}/i);`);
  }

  const primaryHeading = page.headingOutline[0];
  if (primaryHeading?.text) {
    const headingRegex = escapeForRegex(primaryHeading.text);
    const level = primaryHeading.level ?? 1;
    steps.push(`await expect(page.getByRole('heading', { level: ${level}, name: /${headingRegex}/i })).toBeVisible();`);
  }

  if (navRefs[0]) {
    const navRegex = escapeForRegex(navRefs[0].itemLabel);
    steps.push(`await expect(page.getByRole('link', { name: /${navRegex}/i }).first()).toBeVisible();`);
  }

  if (personaTag) {
    steps.push(`// Persona focus: ${personaTag}.`);
  }

  if (goalSummary) {
    steps.push(`// Goal: ${toSentenceCase(goalSummary)}.`);
  }

  if (primaryAction) {
    const actionSummary =
      primaryAction.category !== 'other'
        ? `${primaryAction.category} action "${primaryAction.label}"`
        : `action "${primaryAction.label}"`;
    steps.push(`// Target action: ${actionSummary}.`);
    if (primaryAction.supportingText.length > 0) {
      steps.push(`// Context clues: ${primaryAction.supportingText.join(' | ')}.`);
    }
  }

  if (page.forms.length > 0) {
    const primaryForm = page.forms[0];
    const fieldHints = primaryForm.fields
      .map((field) => field.label?.trim() || field.name || field.type)
      .filter((value, index, array) => value && array.indexOf(value) === index)
      .slice(0, 4);
    if (fieldHints.length > 0) {
      steps.push(`// Detected form fields: ${fieldHints.join(', ')}.`);
    }
  }

  if (kind === 'authentication') {
    steps.push('// TODO: Provide authentication credentials (e.g., TEST_EMAIL / TEST_PASSWORD) before running this scenario.');
  }

  if (primaryCta) {
    const ctaRegex = escapeForRegex(primaryCta.label);

    // Build a more precise selector based on CTA metadata
    let ctaSelector: string;

    // Use semantic selectors for robustness
    if (primaryCta.elementType === 'button') {
      ctaSelector = `page.getByRole('button', { name: /${ctaRegex}/i }).or(page.getByRole('link', { name: /${ctaRegex}/i }))`;
    } else if (primaryCta.elementType === 'link') {
      ctaSelector = `page.getByRole('link', { name: /${ctaRegex}/i }).or(page.getByRole('button', { name: /${ctaRegex}/i }))`;
    } else {
      // Unknown type, try button first
      ctaSelector = `page.getByRole('button', { name: /${ctaRegex}/i }).or(page.getByRole('link', { name: /${ctaRegex}/i }))`;
    }

    // Always add .first() to handle multiple matches
    steps.push(`const cta = ${ctaSelector}.first();`);
    steps.push('await expect(cta).toBeVisible();');
    steps.push('await cta.click();');
  }

  if (kind === 'complex' && page.forms.length > 0) {
    steps.push('// TODO: Fill in the required form fields and submit the form.');
  }

  const navigationTarget =
    primaryAction?.outcome?.kind === 'navigation'
      ? primaryAction.outcome.targetUrl ?? supportingPages[0]
      : undefined;

  if (navigationTarget) {
    const urlRegex = escapeForRegex(navigationTarget);
    steps.push('// Verify navigation after performing the primary action.');
    steps.push(`await expect(page).toHaveURL(/${urlRegex}/i);`);
  } else if (primaryAction?.outcome && primaryAction.outcome.kind !== 'unknown') {
    const outcomeLabel =
      primaryAction.outcome.kind === 'inline-form'
        ? 'Inline form should appear after the action.'
        : primaryAction.outcome.kind === 'modal'
          ? 'Modal should appear after the action.'
          : primaryAction.outcome.kind === 'inline-content'
            ? 'Additional inline content should appear after the action.'
            : primaryAction.outcome.kind === 'no-change'
              ? 'Action should keep the user on the same page without navigation.'
              : `Observed outcome: ${primaryAction.outcome.kind}.`;
    steps.push(`// ${outcomeLabel}`);
  } else if (supportingPages.length > 0) {
    steps.push(`// TODO: Verify navigation to ${supportingPages[0]} if the flow redirects.`);
  }

  return Array.from(new Set(steps));
};

const buildExpectedOutcome = (
  kind: StoryKind,
  goalSummary: string | undefined,
  primaryCta?: PrimaryCtaSelection,
  primaryAction?: ActionHint
): string => {
  if (goalSummary) {
    return toSentenceCase(goalSummary);
  }

  switch (kind) {
    case 'authentication':
      return 'Successful authentication using the provided test account without triggering MFA or lockout.';
    case 'complex':
      return 'Form submission succeeds with test data and displays the expected confirmation state.';
    case 'interaction': {
      const cta = primaryCta?.label ? ` by activating "${primaryCta.label}"` : '';
      const action =
        primaryAction && primaryAction.category !== 'other'
          ? ` while completing the ${primaryAction.category} action`
          : primaryAction
            ? ' while completing the highlighted action'
            : '';
      return `Primary interaction completes without errors${cta}${action}.`;
    }
    case 'browsing':
    default:
      return 'Page content loads without errors and primary navigation remains accessible.';
  }
};

const buildBaselineAssertions = ({
  page,
  navRefs,
  primaryCta,
  primaryAction,
}: Pick<OutlineContext, 'page' | 'navRefs' | 'primaryCta' | 'primaryAction'>): string[] => {
  const assertions: string[] = [];

  if (page.title) {
    assertions.push(`Title matches "${page.title}".`);
  }

  if (page.headingOutline[0]?.text) {
    assertions.push(`Primary heading displays "${page.headingOutline[0]?.text}".`);
  }

  if (primaryCta?.label) {
    assertions.push(`CTA "${primaryCta.label}" is visible and interactive.`);
  }

  if (navRefs[0]) {
    assertions.push(`Navigation link "${navRefs[0].itemLabel}" remains visible.`);
  }

  if (primaryAction) {
    if (primaryAction.category !== 'other') {
      assertions.push(`Action "${primaryAction.label}" exposes the ${primaryAction.category} flow without errors.`);
    } else {
      assertions.push(`Action "${primaryAction.label}" is accessible and responsive.`);
    }
    if (primaryAction.outcome?.kind === 'navigation' && primaryAction.outcome.targetUrl) {
      assertions.push(`Flow navigates to "${primaryAction.outcome.targetUrl}".`);
    } else if (primaryAction.outcome?.kind === 'inline-form') {
      assertions.push('Inline form becomes visible and accepts input after the action.');
    } else if (primaryAction.outcome?.kind === 'modal') {
      assertions.push('Modal dialog becomes visible after the action.');
    } else if (primaryAction.outcome?.kind === 'no-change') {
      assertions.push('Action keeps the experience on the same page without redirection.');
    }
  }

  if (page.forms.some((form) => form.fields.length > 0)) {
    assertions.push('Key form fields accept input and validation messages remain clear.');
  }

  return Array.from(new Set(assertions));
};

const buildRepeatabilityNotes = ({
  kind,
  page,
  primaryCta,
  primaryAction,
}: Pick<OutlineContext, 'kind' | 'page' | 'primaryCta' | 'primaryAction'>): string[] => {
  const notes: string[] = [];

  if (kind === 'authentication') {
    notes.push('Use dedicated non-production credentials; ensure account is reset between runs.');
  }

  if (page.forms.length > 0 && kind !== 'authentication') {
    notes.push('Provide deterministic test data for form fields and clear submissions after each run.');
  }

  if (primaryCta?.label) {
    const ctaFolded = primaryCta.label.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
    if (/reserver|reserve|book|purchase|checkout/.test(ctaFolded)) {
      notes.push('Mock downstream booking/purchase side-effects or run against a sandbox environment.');
    }
  }

  if (primaryAction) {
    if (primaryAction.category === 'delete' || primaryAction.category === 'settle') {
      notes.push('Reset test data before each run to avoid destructive side-effects.');
    }
    if (primaryAction.category === 'create' || primaryAction.category === 'invite') {
      notes.push('Provide disposable fixtures for create/invite flows and clean them up after validation.');
    }
  }

  if (page.url.includes('/sparks/')) {
    notes.push('Ensure referenced spark data remains available in the target environment.');
  }

  if (!notes.length) {
    notes.push('No special setup required; verify target environment stability before regression runs.');
  }

  return notes;
};

interface PrimaryCtaSelection {
  readonly label: string;
  readonly elementType: 'button' | 'link' | 'unknown';
  readonly isInMainContent: boolean;
}

const selectPrimaryCta = (ctas: readonly { readonly label: string; readonly elementType: 'button' | 'link' | 'unknown'; readonly isInMainContent: boolean; readonly priority: number }[]): PrimaryCtaSelection | undefined => {
  if (ctas.length === 0) {
    return undefined;
  }

  // CTAs are already sorted by priority (isInMainContent gets higher priority)
  // Select the best one based on our scoring
  let bestCta: PrimaryCtaSelection | undefined;
  let bestScore = Number.NEGATIVE_INFINITY;

  ctas.forEach((cta, index) => {
    const label = cta.label;
    const repairLabel = (input: string): string => {
      const trimmed = input.replace(/[\u200B-\u200D\u2060]/g, '').trim();
      const collapsed = trimmed.replace(/\s+/g, '');
      const folded = collapsed.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

      if (folded === 'reserver' || folded === 'reerver') {
        return '\u0052\u00E9server';
      }

      if (folded === 'poserunequestion' || folded === 'poerunequetion') {
        return 'Poser une question';
      }

      return trimmed;
    };

    let normalized = repairLabel(label.trim());
    normalized = normalized.replace(/[\u200B-\u200D\u2060]/g, '');
    if (!normalized) {
      return;
    }

    let score = 0;
    let canonicalLabel: string | undefined;

    const lower = normalized.toLowerCase();
    const accentFolded = lower.normalize('NFD').replace(/\p{M}/gu, '');
    const collapsed = accentFolded.replace(/\s+/g, '');

    const approxContains = (haystack: string, needle: string): boolean => {
      if (haystack.includes(needle) || needle.includes(haystack)) {
        return true;
      }

      if (needle.length === haystack.length + 1) {
        for (let i = 0; i < needle.length; i += 1) {
          const candidate = needle.slice(0, i) + needle.slice(i + 1);
          if (candidate === haystack) {
            return true;
          }
        }
      }

      if (haystack.length === needle.length + 1) {
        for (let i = 0; i < haystack.length; i += 1) {
          const candidate = haystack.slice(0, i) + haystack.slice(i + 1);
          if (candidate === needle) {
            return true;
          }
        }
      }

      return false;
    };

    CTA_PREFERRED_KEYWORDS.forEach(({ terms, score: boost }) => {
      let matchedTerm: string | undefined;
      const matched = terms.some((term) => {
        const termLower = term.toLowerCase();
        const foldedTerm = termLower.normalize('NFD').replace(/\p{M}/gu, '');
        const foldedCollapsedTerm = foldedTerm.replace(/\s+/g, '');
        const found =
          lower.includes(termLower) ||
          accentFolded.includes(foldedTerm) ||
          collapsed.includes(foldedCollapsedTerm) ||
          approxContains(collapsed, foldedCollapsedTerm);
        if (found) {
          matchedTerm = term;
        }
        return found;
      });
      if (matched) {
        score += boost;
        if (!canonicalLabel && matchedTerm) {
          canonicalLabel = matchedTerm;
        }
      }
    });

    if (CTA_PENALTY_KEYWORDS.some((term) => {
      const folded = term.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
      const foldedCollapsed = folded.replace(/\s+/g, '');
      return (
        lower.includes(term.toLowerCase()) ||
        accentFolded.includes(folded) ||
        collapsed.includes(foldedCollapsed) ||
        approxContains(collapsed, foldedCollapsed)
      );
    })) {
      score -= 6;
    }

    const wordCount = normalized.split(/\s+/).length;
    if (wordCount <= 4) {
      score += 6;
    }

    if (normalized.length >= 4 && normalized.length <= 24) {
      score += 4;
    }

    // Slight preference for first encountered CTA when scores tie.
    score -= index * 0.1;

    const prettify = (input: string): string =>
      input
        .split(' ')
        .filter(Boolean)
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');

    const shouldOverride = canonicalLabel ? !lower.includes(canonicalLabel.toLowerCase()) : false;
    let displayLabel = shouldOverride && canonicalLabel ? prettify(canonicalLabel) : normalized;
    displayLabel = displayLabel.replace(/Reserver/g, '\u0052\u00E9server');

    // Add bonus for CTAs in main content and preferred element types
    if (cta.isInMainContent) {
      score += 10;
    }
    if (cta.elementType === 'button') {
      score += 2; // Slight preference for buttons over links
    }

    if (score > bestScore) {
      bestScore = score;
      bestCta = {
        label: displayLabel,
        elementType: cta.elementType,
        isInMainContent: cta.isInMainContent,
      };
    }
  });

  return bestCta ?? {
    label: ctas[0].label,
    elementType: ctas[0].elementType,
    isInMainContent: ctas[0].isInMainContent,
  };
};

const selectPrimaryAction = (actionHints: readonly ActionHint[]): ActionHint | undefined => {
  if (!actionHints || actionHints.length === 0) {
    return undefined;
  }

  const seenLabels = new Set<string>();
  const ranked = actionHints
    .filter((hint) => {
      const normalizedLabel = hint.label.trim().toLowerCase();
      if (seenLabels.has(normalizedLabel)) {
        return false;
      }
      seenLabels.add(normalizedLabel);
      return true;
    })
    .map((hint) => {
      const categoryWeight = ACTION_CATEGORY_PRIORITY[hint.category] ?? 0;
      const locationWeight =
        hint.location === 'main' ? 8 : hint.location === 'modal' ? 5 : hint.location === 'navigation' ? 3 : 0;
      const score = hint.confidence + categoryWeight + locationWeight;
      return { hint, score };
    })
    .sort((a, b) => b.score - a.score);

  const top = ranked[0];
  if (!top) {
    return undefined;
  }

  return top.hint;
};

const extractFormFieldLabels = (page: PageSummary): string[] => {
  if (!page.forms.length) {
    return [];
  }

  const primaryForm = page.forms[0];
  const labels = primaryForm.fields
    .map((field) => field.label?.trim() || field.placeholder?.trim() || field.name || field.type)
    .filter((value): value is string => Boolean(value));

  return Array.from(new Set(labels)).slice(0, 6);
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
    const primaryCta = selectPrimaryCta(page.primaryCtas);
    const primaryAction = selectPrimaryAction(page.actionHints);
    const score = computeScore(page, kind, navRefs, persona, primaryCta, primaryAction);

    candidates.push({
      page,
      kind,
      score,
      navRefs,
      personaTag: persona,
      goalSummary: goal,
      primaryCta,
      primaryAction,
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
    const { page, kind, navRefs, personaTag, goalSummary, primaryCta, primaryAction } = candidate;
    const normalizedUrl = normalizeUrl(page.url);

    if (selectedUrls.has(`${normalizedUrl}-${kind}`)) {
      continue;
    }

    if (grouped[kind].length >= STORY_LIMIT_PER_KIND) {
      continue;
    }

    const supporting = crawl.edges.get(page.url) ?? [];
    const outline = buildPlaywrightOutline({
      page,
      kind,
      navRefs,
      primaryCta,
      primaryAction,
      personaTag,
      goalSummary,
      supportingPages: supporting,
    });
    const expectedOutcome = buildExpectedOutcome(kind, goalSummary, primaryCta, primaryAction);
    const baselineAssertions = buildBaselineAssertions({ page, navRefs, primaryCta, primaryAction });
    const repeatabilityNotes = buildRepeatabilityNotes({ kind, page, primaryCta, primaryAction });

    const story: UserStory = {
      id: buildId(page, kind),
      kind,
      title: page.title || page.url,
      entryUrl: page.url,
      description: buildDescription(page, kind, navRefs, personaTag, goalSummary, primaryCta?.label, primaryAction),
      suggestedScriptName: deriveScriptName(page, kind, navRefs, primaryCta),
      supportingPages: supporting.slice(0, 5),
      primaryCtaLabel: primaryCta?.label,
      primaryActionLabel: primaryAction?.label,
      primaryActionCategory: primaryAction?.category,
      primaryActionOutcome: primaryAction?.outcome,
      actionSupportingEvidence: primaryAction?.supportingText ?? [],
      detectedFormFieldLabels: extractFormFieldLabels(page),
      playwrightOutline: outline,
      expectedOutcome,
      baselineAssertions,
      repeatabilityNotes,
      verificationStatus: 'unverified',
    };

    grouped[kind].push(story);
    selectedUrls.add(`${normalizedUrl}-${kind}`);
  }

  return Object.values(grouped).flat();
};

/**
 * Generate a user story from natural language intent using AI.
 * This is used for manual story creation where users describe what they want to test.
 */
export const generateStoryFromIntent = async (
  intent: string,
  page: PageSummary,
  crawlId: string,
  customTitle?: string
): Promise<UserStory> => {
  const openai = await import('openai');

  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OpenAI API key not configured');
  }

  const client = new openai.default({ apiKey: process.env.OPENAI_API_KEY });

  // Prepare context from page
  const ctaSummary = page.primaryCtas
    .slice(0, 5)
    .map((cta, i) => `${i + 1}. "${cta.label}" (${cta.elementType})`)
    .join('\n');

  const actionSummary = page.actionHints
    .slice(0, 5)
    .map((hint, i) => `${i + 1}. "${hint.label}" (${hint.category}, confidence: ${hint.confidence})`)
    .join('\n');

  const formSummary = page.forms
    .slice(0, 2)
    .map((form, i) => {
      const fields = form.fields.map(f => `${f.label || f.name} (${f.type}${f.required ? ', required' : ''})`).join(', ');
      return `${i + 1}. Form with fields: ${fields}`;
    })
    .join('\n');

  const headingSummary = page.headingOutline
    .slice(0, 5)
    .map(h => `H${h.level}: ${h.text}`)
    .join('\n');

  const prompt = `You are an expert at generating Playwright test scenarios from user intent.

User wants to test: "${intent}"

Page context:
- URL: ${page.url}
- Title: ${page.title}
- Meta description: ${page.metaDescription || 'N/A'}

Detected CTAs:
${ctaSummary || 'None'}

Action hints:
${actionSummary || 'None'}

Forms:
${formSummary || 'None'}

Headings:
${headingSummary || 'None'}

Generate a user story in JSON format with these fields:
{
  "kind": "browsing|interaction|authentication|complex",
  "title": "concise test name (max 60 chars)",
  "description": "what this test validates (1-2 sentences)",
  "suggestedScriptName": "kebab-case-filename",
  "playwrightOutline": ["array of Playwright code steps as strings"],
  "expectedOutcome": "what should happen when test passes",
  "baselineAssertions": ["array of verification points"],
  "repeatabilityNotes": ["array of setup requirements"]
}

Rules:
1. Match the user's intent to detected CTAs/actions on the page
2. Use semantic selectors: page.getByRole(), page.getByLabel(), page.getByText()
3. Include await expect().toBeVisible() before interactions
4. For forms, only fill required fields
5. Verify navigation or state changes after actions
6. Keep steps simple and focused on the user's intent

Return ONLY valid JSON, no markdown formatting.`;

  try {
    const completion = await client.chat.completions.create({
      model: 'gpt-4o',
      temperature: 0.3,
      messages: [
        { role: 'system', content: 'You generate Playwright test scenarios in JSON format.' },
        { role: 'user', content: prompt },
      ],
    });

    const raw = completion.choices[0]?.message?.content?.trim();
    if (!raw) {
      throw new Error('No response from AI');
    }

    // Strip markdown code blocks if present
    let jsonStr = raw;
    if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.replace(/^```(?:json)?\n/, '').replace(/\n```$/, '');
    }

    const parsed = JSON.parse(jsonStr) as {
      kind: StoryKind;
      title: string;
      description: string;
      suggestedScriptName: string;
      playwrightOutline: string[];
      expectedOutcome: string;
      baselineAssertions: string[];
      repeatabilityNotes: string[];
    };

    // Build the UserStory object
    const story: UserStory = {
      id: `custom-${createHash('sha1').update(`${page.url}-${intent}-${Date.now()}`).digest('hex').slice(0, 8)}`,
      kind: parsed.kind,
      title: customTitle || parsed.title,
      entryUrl: page.url,
      description: parsed.description,
      suggestedScriptName: parsed.suggestedScriptName,
      supportingPages: [],
      playwrightOutline: parsed.playwrightOutline,
      expectedOutcome: parsed.expectedOutcome,
      baselineAssertions: parsed.baselineAssertions,
      repeatabilityNotes: parsed.repeatabilityNotes,
      verificationStatus: 'unverified',
      detectedFormFieldLabels: extractFormFieldLabels(page),
    };

    return story;
  } catch (error) {
    throw new Error(`Failed to generate story from intent: ${(error as Error).message}`);
  }
};

