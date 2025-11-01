// This file defines shared TypeScript types that describe crawl outputs and inferred user stories.

export type StoryKind = 'browsing' | 'interaction' | 'authentication' | 'complex';

export interface CrawlOptions {
  readonly baseUrl: string;
  readonly maxPages?: number;
  readonly sameOriginOnly?: boolean;
  readonly navigationTimeoutMs?: number;
}

export interface PageLink {
  readonly url: string;
  readonly text: string;
}

export interface FormFieldSummary {
  readonly name: string;
  readonly type: string;
  readonly label?: string;
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
  readonly primaryCtas: readonly string[];
}

export interface CrawlResult {
  readonly baseUrl: string;
  readonly pages: ReadonlyMap<string, PageSummary>;
  readonly edges: ReadonlyMap<string, readonly string[]>;
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
}

export interface AuditArtifacts {
  readonly crawl: CrawlResult;
  readonly userStories: readonly UserStory[];
}
