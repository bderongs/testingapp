<!-- This document tracks future enhancements for the Sparkier web auditor's story inference engine. -->

# Crawler & Story Inference Enhancements

## Richer Site Modeling
- Capture navigation hierarchies (menus, breadcrumbs) and semantic landmarks to infer page roles.
- Extract keyword summaries per page to identify product areas and target audiences.

### Research Notes
- **Leverage accessibility tooling**: `@axe-core/playwright` or `axe-core` can already extract ARIA landmarks (nav, main, header, footer) and report on missing roles, giving us structured navigation hints without reinventing selectors. Documentation: https://www.deque.com/axe/
- **ARIA roles dataset**: `aria-query` exposes mappings between HTML elements and implicit ARIA roles, useful for tagging elements during crawl rather than hard-coding selectors. Repo: https://github.com/A11yance/aria-query
- **Semantic summarization**: `@mozilla/readability` and `metascraper` can parse article-like pages and metadata (titles, descriptions, authors), helping us describe what a page is about. Best for blog/docs sections.
- **Heading structure parsing**: libraries like `rehype` (with `hast` AST) or `unist-util-visit` can traverse headings to build an outline; this might be heavier but saves time versus manual DOM walking.
- **Navigation detection**: No turnkey library focused on navigation hierarchy extraction surfaced; most teams roll their own heuristics using `<nav>`, menus, and list structures. We likely need custom logic using the datasets above.
- **Knowledge graph hints**: Schema.org data (`application/ld+json`) can be parsed with lightweight JSON-LD parsers (e.g., `jsonld-streaming-parser`) to detect entities like `Product`, `FAQPage`, or `BreadcrumbList` that describe site structure.

## Form & CTA Profiling
- Classify forms based on field composition and CTA copy to detect onboarding, contact, checkout, or newsletter flows.
- Flag authentication-related forms (email/password, multi-factor hints) for prioritized stories.

## Journey Construction
- Traverse prominent navigation paths to propose multi-step stories instead of single-page summaries.
- Score paths using interaction depth and novelty, surfacing the top flows per user persona.

## Persona Tagging
- Analyze headings and copy to infer intended user segments (e.g., designers, enterprise teams) and group stories accordingly.
- Allow developers to link personas with must-have regression flows.

## Content-Driven Story Labels
- Combine heuristics with LLM summarization to draft descriptive user stories grounded in site messaging.
- Ensure stories capture goals such as evaluating pricing, booking demos, or exploring documentation.

## Signal Weighting & Deduplication
- Assign scores to candidate stories based on CTA prominence, form uniqueness, and coverage gaps.
- Cluster similar flows (shared form action or CTA text) to avoid redundant stories.

## Developer Feedback Loop
- Prompt for additional context (credentials, data seeds) when flows appear gated or ambiguous.
- Persist developer annotations so future crawls respect confirmed or dismissed stories.

## Historical Comparison
- Track changes to story candidates between runs to highlight missing CTAs or new feature flows.
- Notify developers when critical journeys fade or new ones emerge.

## LLM-Assisted Synthesis
- Use LLMs to transform structured signals into natural-language stories while keeping heuristic guardrails.
- Provide rationale snippets that explain why each story matters to the target persona.
