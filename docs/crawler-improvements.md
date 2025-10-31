<!-- This document tracks future enhancements for the Sparkier web auditor's story inference engine. -->

# Crawler & Story Inference Enhancements

## Richer Site Modeling
- Capture navigation hierarchies (menus, breadcrumbs) and semantic landmarks to infer page roles.
- Extract keyword summaries per page to identify product areas and target audiences.

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
