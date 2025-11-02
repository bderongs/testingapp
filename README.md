<!-- This README introduces the Sparkier Web Auditor prototype and explains how to run the crawler. -->

# testingapp

## Overview

Sparkier Web Auditor is an early prototype that crawls a target website, builds a structured map of its pages, and infers initial user story candidates. Each story can later be converted into a Playwright regression script to protect against regressions introduced by large-scale edits.

## Getting Started

1. Install dependencies (Playwright requires additional browser binaries on first run):
   ```bash
   npm install
   npx playwright install
   ```
2. Run the CLI crawler manually (optional):
   ```bash
   npm run dev:cli -- --url=https://example.com --max-pages=30
   ```
   Adjust flags as needed:
   - `--max-pages` (default 40) controls crawl breadth.
   - `--same-origin-only=false` allows stepping into sub-domains or external links.
   - `--navigation-timeout=15000` sets the load timeout in milliseconds.
3. Launch the web dashboard:
   ```bash
   npm run dev
   ```
   Open http://localhost:3000/brand to view regression analytics, trigger new crawls, and download Playwright spec skeletons.

## Outputs

- `output/site-map.json`: flattened page summaries with link relationships, navigation hierarchies, heading outlines, schema.org hints, and keyword cues for each URL.
- `output/user-stories.json`: heuristically ranked user story suggestions grouped into browsing, interaction, authentication, and complex categories; each story highlights the navigation path, target persona cues, the key CTA label (`primaryCtaLabel`), an auto-generated Playwright outline (`playwrightOutline`), and primary goal when detected.
- `output/playwright/*.spec.ts`: Playwright Test skeletons built from `playwrightOutline`, `expectedOutcome`, `baselineAssertions`, and `repeatabilityNotes`, ready for refinement and verification.

## Next Steps

- Record approved stories as Playwright scripts and plug them into CI.
- Collect developer feedback to refine story heuristics and add workspace-specific overrides (e.g., login credentials, data seeds).
- Layer visual diffing and performance checks on top of the crawl results.
