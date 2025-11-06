// This file converts crawl metadata into heuristic user story suggestions grouped by story kind.
import { createHash } from 'node:crypto';
import { normalizeUrl, safeResolve } from '../utils/url';
const STORY_LIMIT_PER_KIND = 3;
const AUTH_KEYWORDS = ['login', 'log in', 'sign in', 'connexion'];
const CTA_KEYWORDS = ['pricing', 'price', 'contact', 'demo', 'start', 'signup', 'sign up', 'book', 'trial', 'quote'];
const CTA_PREFERRED_KEYWORDS = [
    { terms: ['reserver', 'reserve', 'book'], score: 30 },
    { terms: ['commencer', 'start', 'get started'], score: 24 },
    { terms: ['essayer', 'try'], score: 22 },
    { terms: ['acheter', 'buy', 'purchase'], score: 20 },
    { terms: ['demander', 'request'], score: 18 },
    { terms: ['s\'inscrire', 'inscrire', 'sign up', 'signup', 'register'], score: 18 },
    { terms: ['continuer', 'continue'], score: 12 },
    { terms: ['connexion', 'login', 'sign in'], score: 8 },
];
const CTA_PENALTY_KEYWORDS = ['connexion', 'login', 'sign in', 'sign-in'];
const PERSONA_KEYWORDS = {
    builders: ['developer', 'engineer', 'technical', 'api'],
    design: ['designer', 'ui', 'ux', 'creative'],
    marketing: ['marketing', 'growth', 'campaign'],
    operations: ['operations', 'workflow', 'automation'],
    leadership: ['executive', 'founder', 'leadership', 'strategy'],
};
const SCHEMA_KIND_MAP = {
    authentication: 'authentication',
    loginpage: 'authentication',
    contactpage: 'interaction',
    product: 'interaction',
    faqpage: 'browsing',
    aboutpage: 'browsing',
    collectionpage: 'browsing',
};
const escapeForRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const escapeForSingleQuote = (value) => value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
const toSentenceCase = (value) => {
    if (!value) {
        return value;
    }
    const trimmed = value.trim();
    if (trimmed.length === 0) {
        return trimmed;
    }
    return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
};
const toSlug = (input) => input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .trim()
    .replace(/-+/g, '-');
const buildNavigationIndex = (crawl) => {
    const index = new Map();
    for (const page of crawl.pages.values()) {
        page.navigationSections.forEach((section) => {
            section.items.forEach((item) => {
                const resolved = safeResolve(page.url, item.url);
                if (!resolved) {
                    return;
                }
                const normalized = normalizeUrl(resolved);
                const entry = {
                    path: [section.label, item.text].filter(Boolean).join(' -> ') || item.text,
                    itemLabel: item.text,
                    sectionLabel: section.label,
                    depth: item.depth,
                };
                const existing = index.get(normalized);
                if (existing) {
                    existing.push(entry);
                }
                else {
                    index.set(normalized, [entry]);
                }
            });
        });
    }
    return index;
};
const detectPersona = (page) => {
    const haystack = `${page.title} ${page.metaDescription ?? ''} ${page.primaryKeywords.join(' ')}`.toLowerCase();
    return Object.entries(PERSONA_KEYWORDS).find(([, keywords]) => keywords.some((keyword) => haystack.includes(keyword)))?.[0];
};
const detectGoal = (page, navRefs) => {
    const textSources = [
        page.title,
        page.metaDescription ?? '',
        ...page.primaryKeywords,
        ...navRefs.map((ref) => ref.itemLabel),
        ...page.primaryCtas,
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
const pickStoryKind = (page, navRefs) => {
    const normalizedTitle = page.title.toLowerCase();
    const hasPasswordField = page.forms.some((form) => form.fields.some((field) => field.type === 'password'));
    const hasAuthKeyword = AUTH_KEYWORDS.some((keyword) => normalizedTitle.includes(keyword));
    if (hasPasswordField || hasAuthKeyword) {
        return 'authentication';
    }
    const schemaOverride = page.schemaOrgTypes
        .map((type) => SCHEMA_KIND_MAP[type.toLowerCase()])
        .find((kind) => Boolean(kind));
    if (schemaOverride) {
        return schemaOverride;
    }
    const forms = page.forms.filter((form) => form.fields.length > 0);
    const complexForm = forms.some((form) => form.fields.length >= 4 || form.fields.some((field) => field.type === 'select' || field.type === 'textarea'));
    if (complexForm) {
        return 'complex';
    }
    const ctaTextCandidates = [
        normalizedTitle,
        ...page.primaryKeywords.map((keyword) => keyword.toLowerCase()),
        ...navRefs.map((ref) => ref.itemLabel.toLowerCase()),
        ...page.primaryCtas.map((cta) => cta.toLowerCase()),
    ];
    const hasCtaCue = CTA_KEYWORDS.some((keyword) => ctaTextCandidates.some((candidate) => candidate.includes(keyword)));
    if (hasCtaCue || page.interactiveElementCount >= 3 || forms.length > 0) {
        return 'interaction';
    }
    return 'browsing';
};
const computeScore = (page, kind, navRefs, personaTag, primaryCtaLabel) => {
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
    const ctaMatches = CTA_KEYWORDS.filter((keyword) => [page.title, ...page.primaryKeywords, ...page.primaryCtas].some((value) => value.toLowerCase().includes(keyword)));
    if (ctaMatches.length > 0) {
        score += 18;
    }
    if (personaTag) {
        score += 8;
    }
    if (primaryCtaLabel) {
        score += 10;
    }
    score += Math.min(page.interactiveElementCount, 10);
    return score;
};
const buildDescription = (page, kind, navRefs, personaTag, goal, primaryCtaLabel) => {
    const navHint = navRefs[0]
        ? ` via ${navRefs[0].path}`
        : '';
    const personaHint = personaTag ? ` for ${personaTag} personas` : '';
    const goalHint = goal ? ` to ${goal}` : '';
    const ctaHint = primaryCtaLabel ? ` using the "${primaryCtaLabel}" CTA` : '';
    const pageLabel = page.title || page.url;
    switch (kind) {
        case 'authentication':
            return `Validate authentication on ${pageLabel}${navHint}${personaHint}, ensuring login works with provided test credentials${goalHint}.`;
        case 'complex':
            return `Complete the key form on ${pageLabel}${navHint}${personaHint}, filling mandatory fields and submitting${goalHint}${ctaHint}.`;
        case 'interaction':
            return `Exercise the primary CTA on ${pageLabel}${navHint}${personaHint}${goalHint}${ctaHint}, confirming interactive elements behave as expected.`;
        case 'browsing':
        default:
            return `Navigate through ${pageLabel}${navHint}${personaHint}${goalHint}, verifying the content loads and links resolve.`;
    }
};
const deriveScriptName = (page, kind, navRefs, primaryCtaLabel) => {
    const fallback = page.title || page.url.split('/').filter(Boolean).pop() || 'story';
    const primaryLabel = primaryCtaLabel ?? navRefs[0]?.itemLabel ?? fallback;
    const slug = toSlug(primaryLabel);
    return `${kind}-${slug || 'flow'}`;
};
const buildPlaywrightOutline = ({ page, kind, navRefs, primaryCtaLabel, personaTag, goalSummary, supportingPages, }) => {
    const steps = [];
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
        steps.push(`await expect(page.getByRole('link', { name: /${navRegex}/i })).toBeVisible();`);
    }
    if (personaTag) {
        steps.push(`// Persona focus: ${personaTag}.`);
    }
    if (goalSummary) {
        steps.push(`// Goal: ${toSentenceCase(goalSummary)}.`);
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
    if (primaryCtaLabel) {
        const ctaRegex = escapeForRegex(primaryCtaLabel);
        steps.push(`const cta = page.getByRole('button', { name: /${ctaRegex}/i }).or(page.getByRole('link', { name: /${ctaRegex}/i }));`);
        steps.push('await expect(cta).toBeVisible();');
        steps.push('await cta.click();');
    }
    if (kind === 'complex' && page.forms.length > 0) {
        steps.push('// TODO: Fill in the required form fields and submit the form.');
    }
    if (supportingPages.length > 0) {
        const targetUrl = supportingPages[0];
        const urlRegex = escapeForRegex(targetUrl);
        steps.push('// Verify navigation after performing the primary action.');
        steps.push(`await expect(page).toHaveURL(/${urlRegex}/); // adjust expected destination if necessary`);
    }
    return Array.from(new Set(steps));
};
const buildExpectedOutcome = (kind, goalSummary, primaryCtaLabel) => {
    if (goalSummary) {
        return toSentenceCase(goalSummary);
    }
    switch (kind) {
        case 'authentication':
            return 'Successful authentication using the provided test account without triggering MFA or lockout.';
        case 'complex':
            return 'Form submission succeeds with test data and displays the expected confirmation state.';
        case 'interaction': {
            const cta = primaryCtaLabel ? ` by activating "${primaryCtaLabel}"` : '';
            return `Primary interaction completes without errors${cta}.`;
        }
        case 'browsing':
        default:
            return 'Page content loads without errors and primary navigation remains accessible.';
    }
};
const buildBaselineAssertions = ({ page, navRefs, primaryCtaLabel, }) => {
    const assertions = [];
    if (page.title) {
        assertions.push(`Title matches "${page.title}".`);
    }
    if (page.headingOutline[0]?.text) {
        assertions.push(`Primary heading displays "${page.headingOutline[0]?.text}".`);
    }
    if (primaryCtaLabel) {
        assertions.push(`CTA "${primaryCtaLabel}" is visible and interactive.`);
    }
    if (navRefs[0]) {
        assertions.push(`Navigation link "${navRefs[0].itemLabel}" remains visible.`);
    }
    if (page.forms.length > 0) {
        assertions.push('Key form fields accept input and validation messages remain clear.');
    }
    return Array.from(new Set(assertions));
};
const buildRepeatabilityNotes = ({ kind, page, primaryCtaLabel, }) => {
    const notes = [];
    if (kind === 'authentication') {
        notes.push('Use dedicated non-production credentials; ensure account is reset between runs.');
    }
    if (page.forms.length > 0 && kind !== 'authentication') {
        notes.push('Provide deterministic test data for form fields and clear submissions after each run.');
    }
    if (primaryCtaLabel) {
        const ctaFolded = primaryCtaLabel.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
        if (/reserver|reserve|book|purchase|checkout/.test(ctaFolded)) {
            notes.push('Mock downstream booking/purchase side-effects or run against a sandbox environment.');
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
const selectPrimaryCtaLabel = (ctas) => {
    if (ctas.length === 0) {
        return undefined;
    }
    let bestLabel;
    let bestScore = Number.NEGATIVE_INFINITY;
    ctas.forEach((label, index) => {
        const repairLabel = (input) => {
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
        let canonicalLabel;
        const lower = normalized.toLowerCase();
        const accentFolded = lower.normalize('NFD').replace(/\p{M}/gu, '');
        const collapsed = accentFolded.replace(/\s+/g, '');
        const approxContains = (haystack, needle) => {
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
            let matchedTerm;
            const matched = terms.some((term) => {
                const termLower = term.toLowerCase();
                const foldedTerm = termLower.normalize('NFD').replace(/\p{M}/gu, '');
                const foldedCollapsedTerm = foldedTerm.replace(/\s+/g, '');
                const found = lower.includes(termLower) ||
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
            return (lower.includes(term.toLowerCase()) ||
                accentFolded.includes(folded) ||
                collapsed.includes(foldedCollapsed) ||
                approxContains(collapsed, foldedCollapsed));
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
        const prettify = (input) => input
            .split(' ')
            .filter(Boolean)
            .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
            .join(' ');
        const shouldOverride = canonicalLabel ? !lower.includes(canonicalLabel.toLowerCase()) : false;
        let displayLabel = shouldOverride && canonicalLabel ? prettify(canonicalLabel) : normalized;
        displayLabel = displayLabel.replace(/Reserver/g, '\u0052\u00E9server');
        if (score > bestScore) {
            bestScore = score;
            bestLabel = displayLabel;
        }
    });
    return bestLabel ?? ctas[0];
};
const buildId = (page, kind) => {
    const hash = createHash('sha1').update(`${page.url}-${kind}`).digest('hex').slice(0, 8);
    return `${kind}-${hash}`;
};
export const identifyUserStories = (crawl) => {
    const navigationIndex = buildNavigationIndex(crawl);
    const candidates = [];
    for (const page of crawl.pages.values()) {
        const normalizedUrl = normalizeUrl(page.url);
        const navRefs = navigationIndex.get(normalizedUrl) ?? [];
        const kind = pickStoryKind(page, navRefs);
        const persona = detectPersona(page);
        const goal = detectGoal(page, navRefs);
        const primaryCtaLabel = selectPrimaryCtaLabel(page.primaryCtas);
        const score = computeScore(page, kind, navRefs, persona, primaryCtaLabel);
        candidates.push({
            page,
            kind,
            score,
            navRefs,
            personaTag: persona,
            goalSummary: goal,
            primaryCtaLabel,
        });
    }
    candidates.sort((a, b) => b.score - a.score);
    const grouped = {
        authentication: [],
        browsing: [],
        complex: [],
        interaction: [],
    };
    const selectedUrls = new Set();
    for (const candidate of candidates) {
        const { page, kind, navRefs, personaTag, goalSummary, primaryCtaLabel } = candidate;
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
            primaryCtaLabel,
            personaTag,
            goalSummary,
            supportingPages: supporting,
        });
        const expectedOutcome = buildExpectedOutcome(kind, goalSummary, primaryCtaLabel);
        const baselineAssertions = buildBaselineAssertions({ page, navRefs, primaryCtaLabel });
        const repeatabilityNotes = buildRepeatabilityNotes({ kind, page, primaryCtaLabel });
        const story = {
            id: buildId(page, kind),
            kind,
            title: page.title || page.url,
            entryUrl: page.url,
            description: buildDescription(page, kind, navRefs, personaTag, goalSummary, primaryCtaLabel),
            suggestedScriptName: deriveScriptName(page, kind, navRefs, primaryCtaLabel),
            supportingPages: supporting.slice(0, 5),
            primaryCtaLabel,
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
