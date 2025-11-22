// This file defines shared TypeScript types that describe crawl outputs and inferred user stories.

export type StoryKind = 'browsing' | 'interaction' | 'authentication' | 'complex';

/**
 * Cookie format compatible with Playwright's cookie API.
 * Used to inject authentication cookies for crawling authenticated pages.
 */
export interface Cookie {
  readonly name: string;
  readonly value: string;
  readonly domain: string;
  readonly path?: string;
  readonly expires?: number;
  readonly httpOnly?: boolean;
  readonly secure?: boolean;
  readonly sameSite?: 'Strict' | 'Lax' | 'None';
}

export interface CrawlOptions {
  readonly baseUrl: string;
  readonly maxPages?: number;
  readonly sameOriginOnly?: boolean;
  readonly navigationTimeoutMs?: number;
  readonly cookies?: readonly Cookie[];
}

export interface PageLink {
  readonly url: string;
  readonly text: string;
}

export interface FormFieldSummary {
  readonly name: string;
  readonly type: string;
  readonly label?: string;
  readonly placeholder?: string;
  readonly required: boolean;
}

export interface FormSummary {
  readonly action: string;
  readonly method: string;
  readonly fields: readonly FormFieldSummary[];
}

export type LandmarkKind = 'banner' | 'navigation' | 'main' | 'complementary' | 'contentinfo' | 'search';

export interface NavigationItem {
  readonly url: string;
  readonly text: string;
  readonly depth: number;
}

export interface NavigationSection {
  readonly label?: string;
  readonly items: readonly NavigationItem[];
}

export interface HeadingEntry {
  readonly level: number;
  readonly text: string;
  readonly id?: string;
}

export interface BreadcrumbEntry {
  readonly url: string;
  readonly text: string;
}

export type ActionHintCategory =
  | 'create'
  | 'update'
  | 'delete'
  | 'view'
  | 'invite'
  | 'share'
  | 'settle'
  | 'search'
  | 'filter'
  | 'navigate'
  | 'other';

export type ActionHintLocation = 'main' | 'navigation' | 'header' | 'footer' | 'modal' | 'unknown';

export type ActionOutcomeKind =
  | 'navigation'
  | 'inline-form'
  | 'modal'
  | 'inline-content'
  | 'no-change'
  | 'unknown';

export interface ActionOutcome {
  readonly kind: ActionOutcomeKind;
  readonly targetUrl?: string;
  readonly evidence?: readonly string[];
  readonly notes?: string;
}

export interface ActionHint {
  readonly label: string;
  readonly category: ActionHintCategory;
  readonly elementType: 'button' | 'link' | 'input' | 'unknown';
  readonly confidence: number;
  readonly location: ActionHintLocation;
  readonly supportingText: readonly string[];
  readonly selector?: string;
  readonly outcome?: ActionOutcome;
}

export type CtaMetadata = {
  readonly label: string;
  readonly elementType: 'button' | 'link' | 'unknown';
  readonly isInMainContent: boolean;
  readonly priority: number;
};

export interface PageSummary {
  readonly url: string;
  readonly title: string;
  readonly statusCode: number;
  readonly links: readonly PageLink[];
  readonly forms: readonly FormSummary[];
  readonly interactiveElementCount: number;
  readonly hasScrollableSections: boolean;
  readonly landmarks: readonly LandmarkKind[];
  readonly navigationSections: readonly NavigationSection[];
  readonly headingOutline: readonly HeadingEntry[];
  readonly breadcrumbTrail: readonly BreadcrumbEntry[];
  readonly schemaOrgTypes: readonly string[];
  readonly metaDescription?: string;
  readonly primaryKeywords: readonly string[];
  readonly primaryCtas: readonly CtaMetadata[];
  readonly actionHints: readonly ActionHint[];
  readonly pageGoal?: string;
  readonly primaryActions?: readonly string[];
  readonly recommendedLinks?: readonly string[];
}

export interface CrawlResult {
  readonly baseUrl: string;
  readonly pages: ReadonlyMap<string, PageSummary>;
  readonly edges: ReadonlyMap<string, readonly string[]>;
  readonly pendingUrls: readonly string[];
  readonly crawlDir?: string;
}

export interface UserStory {
  readonly id: string;
  readonly kind: StoryKind;
  readonly title: string;
  readonly entryUrl: string;
  readonly description: string;
  readonly suggestedScriptName: string;
  readonly supportingPages: readonly string[];
  readonly primaryCtaLabel?: string;
  readonly primaryActionLabel?: string;
  readonly primaryActionCategory?: ActionHintCategory;
  readonly primaryActionOutcome?: ActionOutcome;
  readonly actionSupportingEvidence?: readonly string[];
  readonly detectedFormFieldLabels?: readonly string[];
  readonly playwrightOutline: readonly string[];
  readonly expectedOutcome: string;
  readonly baselineAssertions: readonly string[];
  readonly repeatabilityNotes: readonly string[];
  readonly verificationStatus: 'unverified' | 'baseline' | 'outdated';
  readonly pageGoal?: string;
  readonly primaryActions?: readonly string[];
  readonly recommendedLinks?: readonly string[];
}

export interface AuditArtifacts {
  readonly crawl: CrawlResult;
  readonly userStories: readonly UserStory[];
}
