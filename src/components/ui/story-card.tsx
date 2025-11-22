// This file renders individual user story cards with regression metadata and Playwright details.
'use client';

import { useEffect, useState } from 'react';
import { ArrowUpRight, Compass, FileCode, Flag, Play, Loader2, Wand2, CheckCircle2, Cookie as CookieIcon, AlertTriangle, X, ChevronUp, ChevronDown, Layers } from 'lucide-react';
import Link from 'next/link';

import type { UserStory, Cookie } from '@/types';
import { cn } from '@/lib/utils';
import { sanitizeFileSlug } from '@/lib/sanitize';
import { StatusBadge } from '@/components/ui/status-badge';
import { TestEditModal } from '@/components/ui/test-edit-modal';

interface StoryWithSpec extends UserStory {
  specSlug: string;
  specHref: string;
}

interface StoryCardProps {
  story: StoryWithSpec;
  crawlId?: string;
  domain?: string | null;
  savedCookieCount?: number;
}

const cardAccent: Record<UserStory['kind'], string> = {
  interaction: 'border-sparkier-primary/60 shadow-sparkier-primary/20',
  browsing: 'border-slate-200 shadow-slate-200',
  authentication: 'border-amber-300 shadow-amber-200',
  complex: 'border-rose-300 shadow-rose-200',
};

interface ExecuteResponse {
  success: boolean;
  message: string;
  output: string;
  code: number;
  artifacts?: {
    trace?: string;
    video?: string;
    screenshot?: string;
  };
}

export const StoryCard = ({ story, crawlId, domain, savedCookieCount }: StoryCardProps) => {
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isRunModalOpen, setIsRunModalOpen] = useState(false);
  const [isLiveRunning, setIsLiveRunning] = useState(false);
  const [liveResult, setLiveResult] = useState<ExecuteResponse | null>(null);
  const [liveError, setLiveError] = useState<string | null>(null);
  const [isCrawling, setIsCrawling] = useState(false);
  const [crawlResult, setCrawlResult] = useState<string | null>(null);
  const [crawlError, setCrawlError] = useState<string | null>(null);
  const [activeCookieCount, setActiveCookieCount] = useState<number>(savedCookieCount ?? 0);
  const headingFromAssertions = story.baselineAssertions
    .map((assertion) => assertion.match(/Primary heading displays "(.+?)"/))
    .find((match): match is RegExpMatchArray => Boolean(match));
  useEffect(() => {
    setActiveCookieCount(savedCookieCount ?? 0);
  }, [savedCookieCount]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    const handleCookieUpdate = (event: Event) => {
      const detail = (event as CustomEvent<{ domain: string; cookies: Cookie[] }>).detail;
      if (!detail) {
        return;
      }
      if (!domain || detail.domain !== domain) {
        return;
      }
      setActiveCookieCount(detail.cookies.length);
    };

    window.addEventListener('sparkier:cookies-updated', handleCookieUpdate as EventListener);
    return () => window.removeEventListener('sparkier:cookies-updated', handleCookieUpdate as EventListener);
  }, [domain]);

  const cookiesActive = activeCookieCount > 0;

  const primaryActions = Array.isArray(story.primaryActions) ? story.primaryActions.slice(0, 3) : [];
  const recommendedLinks = Array.isArray(story.recommendedLinks) ? story.recommendedLinks.slice(0, 3) : [];
  const primaryActionOutcomeDescription = (() => {
    const outcome = story.primaryActionOutcome;
    if (!outcome) {
      return null;
    }
    switch (outcome.kind) {
      case 'navigation':
        return outcome.targetUrl
          ? `Redirects to ${outcome.targetUrl}.`
          : 'Redirects to a follow-up page.';
      case 'inline-form':
        return 'Reveals an inline form when triggered.';
      case 'modal':
        return 'Opens a modal dialog after the action.';
      case 'inline-content':
        return 'Expands inline content after the action.';
      case 'no-change':
        return 'Keeps the user on the current URL after the action.';
      default:
        return 'Outcome observed during crawl: unknown.';
    }
  })();

  const pageTitle = (() => {
    if (headingFromAssertions) {
      return headingFromAssertions[1];
    }
    const trimmedTitle = story.title?.trim();
    if (trimmedTitle && trimmedTitle.length > 0) {
      return trimmedTitle;
    }
    try {
      const url = new URL(story.entryUrl);
      return url.pathname === '/' ? url.hostname : `${url.hostname}${url.pathname}`;
    } catch {
      return story.entryUrl;
    }
  })();

  const handleOpenRunModal = () => {
    setLiveResult(null);
    setLiveError(null);
    setIsRunModalOpen(true);
  };

  const handleExecuteTest = async () => {
    if (isLiveRunning) {
      return;
    }
    setIsLiveRunning(true);
    setLiveResult(null);
    setLiveError(null);

    try {
      const url = new URL(`/api/test/${story.specSlug}/execute`, window.location.origin);
      if (crawlId) {
        url.searchParams.set('crawlId', crawlId);
      }
      if (domain) {
        url.searchParams.set('domain', domain);
      }
      const response = await fetch(url.toString(), { method: 'POST' });
      const payload = (await response.json()) as ExecuteResponse & { error?: string };
      if (response.ok) {
        setLiveResult(payload);
        setLiveError(payload.success ? null : payload.error ?? null);
      } else {
        setLiveError(payload.error || payload.message || 'Failed to execute Playwright run.');
      }
    } catch (error) {
      setLiveError((error as Error).message);
    } finally {
      setIsLiveRunning(false);
    }
  };

  const handleCrawlFromHere = async () => {
    if (isCrawling) {
      return;
    }
    setIsCrawling(true);
    setCrawlResult(null);
    setCrawlError(null);

    try {
      const response = await fetch('/api/crawl', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: story.entryUrl,
          maxPages: 10,
          sameOriginOnly: true,
        }),
      });
      const payload = await response.json();
      if (response.ok && payload.success) {
        setCrawlResult(payload.message ?? 'Crawl started.');
      } else {
        setCrawlError(payload.message ?? 'Failed to start crawl.');
      }
    } catch (error) {
      setCrawlError((error as Error).message);
    } finally {
      setIsCrawling(false);
    }
  };

  const [isAdvancedOpen, setIsAdvancedOpen] = useState(false);

  // ... (existing code)

  return (
    <article
      className={cn(
        'rounded-3xl border border-slate-200 bg-white p-6 shadow-sm transition-all hover:shadow-lg lg:p-8',
        cardAccent[story.kind]
      )}
    >
      {/* ... (header and body remain mostly the same, skipping to modal) */}
      <header className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2 text-xs uppercase tracking-wide text-slate-500">
            <span className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1 font-medium text-slate-600">
              <span className="block h-2 w-2 rounded-full bg-sparkier-primary" />
              {story.kind}
            </span>
            <StatusBadge status={story.verificationStatus} />
            <span
              className={cn(
                'inline-flex items-center gap-2 rounded-full px-3 py-1 font-medium',
                cookiesActive ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'
              )}
            >
              <CookieIcon className="h-3.5 w-3.5" aria-hidden />
              {cookiesActive ? `${activeCookieCount} cookies active` : 'No cookies saved'}
            </span>
          </div>
          <div className="space-y-2">
            <h3 className="text-2xl font-semibold text-slate-900">{pageTitle}</h3>
            <p className="text-sm leading-relaxed text-slate-600">{story.description}</p>
          </div>
          <a
            href={story.entryUrl}
            className="group inline-flex items-center gap-2 text-sm font-medium text-sparkier-primary transition hover:text-sparkier-secondary"
            target="_blank"
            rel="noreferrer"
          >
            <ArrowUpRight className="h-3.5 w-3.5 transition group-hover:translate-x-0.5 group-hover:-translate-y-0.5" aria-hidden />
            <span className="font-mono text-xs leading-relaxed text-slate-500 group-hover:text-slate-600 break-all">
              {story.entryUrl}
            </span>
          </a>
          {story.pageGoal || primaryActions.length > 0 ? (
            <div className="flex flex-wrap gap-2 text-xs text-slate-600">
              {story.pageGoal ? (
                <span className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1">
                  <Flag className="h-3.5 w-3.5 text-sparkier-primary" aria-hidden />
                  Page goal: <span className="font-medium text-slate-700">{story.pageGoal}</span>
                </span>
              ) : null}
              {primaryActions.map((action) => (
                <span key={action} className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-1 shadow-sm">
                  <Compass className="h-3.5 w-3.5 text-indigo-500" aria-hidden />
                  {action}
                </span>
              ))}
            </div>
          ) : null}
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
          <button
            onClick={() => setIsEditModalOpen(true)}
            className="inline-flex items-center gap-2 rounded-full border border-slate-200 px-4 py-2 text-xs font-medium text-slate-600 transition hover:border-sparkier-primary hover:text-sparkier-primary"
          >
            <Wand2 className="h-3.5 w-3.5" aria-hidden />
            Edit with AI
          </button>
          <button
            onClick={handleOpenRunModal}
            disabled={isLiveRunning}
            className={cn(
              'inline-flex items-center gap-2 rounded-full bg-emerald-600 px-4 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-emerald-700',
              isLiveRunning && 'cursor-not-allowed opacity-60'
            )}
          >
            {isLiveRunning ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Play className="h-3.5 w-3.5" aria-hidden />}
            {isLiveRunning ? 'Running…' : 'Run live test'}
          </button>
          <button
            onClick={handleCrawlFromHere}
            disabled={isCrawling}
            className={cn(
              'inline-flex items-center gap-2 rounded-full border border-slate-200 px-4 py-2 text-xs font-medium text-slate-600 transition hover:border-sparkier-primary hover:text-sparkier-primary',
              isCrawling && 'cursor-not-allowed opacity-60'
            )}
          >
            {isCrawling ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Play className="h-3.5 w-3.5" aria-hidden />}
            {isCrawling ? 'Crawl running…' : 'Crawl from page'}
          </button>
          <Link
            href={story.specHref}
            className="inline-flex items-center gap-2 rounded-full border border-slate-200 px-4 py-2 text-xs font-medium text-slate-600 transition hover:border-sparkier-primary hover:text-sparkier-primary"
            target="_blank"
            rel="noreferrer"
          >
            <FileCode className="h-3.5 w-3.5" aria-hidden />
            View spec skeleton
          </Link>
        </div>
      </header>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1.6fr,1fr]">
        <div className="space-y-4">
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
            <h4 className="flex items-center gap-2 text-sm font-semibold text-slate-800">
              <Flag className="h-4 w-4 text-sparkier-primary" aria-hidden />
              Expected outcome
            </h4>
            <p className="mt-2 text-sm text-slate-700">{story.expectedOutcome}</p>
            {story.primaryCtaLabel ? (
              <p className="mt-3 text-xs uppercase tracking-wide text-slate-500">Primary CTA: {story.primaryCtaLabel}</p>
            ) : null}
          </div>
          {(story.pageGoal ||
            primaryActions.length > 0 ||
            story.primaryActionLabel ||
            story.primaryActionCategory ||
            (story.actionSupportingEvidence && story.actionSupportingEvidence.length > 0)) && (
              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                {story.pageGoal ? (
                  <p className="text-sm text-slate-700">
                    <span className="font-semibold text-slate-900">Page goal:</span> {story.pageGoal}
                  </p>
                ) : null}
                {primaryActions.length > 0 ? (
                  <div className="mt-3 space-y-2">
                    <p className="text-xs uppercase tracking-wide text-slate-500">Primary actions</p>
                    <ul className="flex flex-wrap gap-2">
                      {primaryActions.map((action) => (
                        <li key={action} className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
                          {action}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {story.primaryActionLabel || story.primaryActionCategory ? (
                  <p className="mt-3 text-xs text-slate-500">
                    <span className="uppercase tracking-wide text-slate-500">Primary action</span>{' '}
                    {story.primaryActionCategory ? `${story.primaryActionCategory} · ` : ''}
                    {story.primaryActionLabel}
                  </p>
                ) : null}
                {story.actionSupportingEvidence && story.actionSupportingEvidence.length > 0 ? (
                  <p className="mt-2 text-xs text-slate-500">
                    Context clues: {story.actionSupportingEvidence.join(' · ')}
                  </p>
                ) : null}
                {primaryActionOutcomeDescription ? (
                  <p className="mt-2 text-xs text-slate-500">{primaryActionOutcomeDescription}</p>
                ) : null}
              </div>
            )}
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h4 className="flex items-center gap-2 text-sm font-semibold text-slate-800">
            <CheckCircle2 className="h-4 w-4 text-slate-400" aria-hidden />
            Baseline assertions
          </h4>
          <ul className="mt-3 space-y-2 text-sm text-slate-700">
            {story.baselineAssertions.map((assertion) => (
              <li
                key={sanitizeFileSlug(assertion, assertion)}
                className="flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3"
              >
                <CheckCircle2 className="mt-0.5 h-5 w-5 text-slate-300" aria-hidden />
                <p className="text-sm text-slate-700">{assertion}</p>
              </li>
            ))}
          </ul>
          <button
            onClick={() => setIsEditModalOpen(true)}
            className="mt-4 inline-flex items-center gap-2 text-xs font-medium text-sparkier-primary transition hover:text-sparkier-secondary"
          >
            <Wand2 className="h-3.5 w-3.5" aria-hidden />
            Refine with AI
          </button>
        </div>
      </div>

      {recommendedLinks.length > 0 ? (
        <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-5">
          <h4 className="flex items-center gap-2 text-sm font-semibold text-slate-800">
            <Compass className="h-4 w-4 text-indigo-500" aria-hidden />
            Suggested next pages
          </h4>
          <ul className="mt-3 space-y-2 text-xs text-slate-600">
            {recommendedLinks.map((link) => (
              <li key={link} className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-3 py-2">
                <span className="truncate pr-3">{link}</span>
                <a
                  href={link}
                  target="_blank"
                  rel="noreferrer"
                  className="text-sparkier-primary transition hover:text-sparkier-secondary"
                >
                  Visit
                </a>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {(liveResult || liveError) && !isRunModalOpen ? (
        <div
          className={cn(
            'mt-6 rounded-2xl border p-4 text-sm',
            liveResult?.success ? 'border-emerald-300 bg-emerald-50 text-emerald-700' : 'border-rose-300 bg-rose-50 text-rose-700'
          )}
        >
          <p className="font-semibold">{liveResult?.message ?? liveError ?? 'Playwright run completed.'}</p>
          {liveResult?.artifacts && (liveResult.artifacts.trace || liveResult.artifacts.video || liveResult.artifacts.screenshot) ? (
            <div className="mt-2 space-y-1 text-xs text-slate-600">
              <p className="font-semibold text-slate-800">Artifacts</p>
              {liveResult.artifacts.trace ? <p>Trace: <span className="font-mono text-[10px]">{liveResult.artifacts.trace}</span></p> : null}
              {liveResult.artifacts.video ? <p>Video: <span className="font-mono text-[10px]">{liveResult.artifacts.video}</span></p> : null}
              {liveResult.artifacts.screenshot ? (
                <p>
                  Screenshot: <span className="font-mono text-[10px]">{liveResult.artifacts.screenshot}</span>
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {(crawlResult || crawlError) && (
        <div
          className={cn(
            'mt-4 rounded-2xl border p-4 text-sm',
            crawlError ? 'border-rose-300 bg-rose-50 text-rose-700' : 'border-slate-200 bg-slate-50 text-slate-700'
          )}
        >
          <p className="font-semibold">{crawlError ?? crawlResult}</p>
        </div>
      )}

      <TestEditModal
        isOpen={isEditModalOpen}
        onClose={() => setIsEditModalOpen(false)}
        specSlug={story.specSlug}
        storyTitle={story.title}
        baselineAssertions={story.baselineAssertions}
        crawlId={crawlId}
        domain={domain}
        entryUrl={story.entryUrl}
        playwrightOutline={story.playwrightOutline}
        primaryCtaLabel={story.primaryCtaLabel}
        primaryActionLabel={story.primaryActionLabel}
        primaryActionOutcome={story.primaryActionOutcome}
        formFieldLabels={story.detectedFormFieldLabels}
      />

      {isRunModalOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => {
            if (!isLiveRunning) {
              setIsRunModalOpen(false);
            }
          }}
        >
          <div
            className="relative w-full max-w-xl rounded-2xl border border-slate-200 bg-white shadow-xl max-h-[90vh] flex flex-col"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-amber-500" aria-hidden />
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">Run live Playwright test</h2>
                  <p className="text-xs text-slate-600">Executes the full spec against the selected environment.</p>
                </div>
              </div>
              <button
                onClick={() => {
                  if (!isLiveRunning) {
                    setIsRunModalOpen(false);
                  }
                }}
                className="rounded-lg p-1 text-slate-400 transition hover:bg-slate-200 hover:text-slate-600"
              >
                <X className="h-5 w-5" aria-hidden />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-5 text-sm text-slate-700 space-y-6">
              <div className="space-y-2">
                <p>
                  This will run the complete Playwright script for <span className="font-mono text-xs">{story.entryUrl}</span>{' '}
                  using the saved cookies for <span className="font-medium">{domain ?? 'the current domain'}</span>.
                </p>
                <p className="text-xs text-slate-500">
                  The scenario may create, modify, or delete data as part of the flow.
                </p>
              </div>

              {/* Assertion Checklist */}
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <h4 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <CheckCircle2 className="h-4 w-4" aria-hidden />
                  Verification Checklist
                </h4>
                <ul className="space-y-2">
                  {story.baselineAssertions.map((assertion, index) => {
                    let icon = <div className="h-4 w-4 rounded-full border-2 border-slate-300" />;
                    let textClass = "text-slate-600";

                    if (isLiveRunning) {
                      icon = <Loader2 className="h-4 w-4 animate-spin text-indigo-500" />;
                      textClass = "text-indigo-700 font-medium";
                    } else if (liveResult) {
                      if (liveResult.success) {
                        icon = <CheckCircle2 className="h-4 w-4 text-emerald-500" />;
                        textClass = "text-emerald-700";
                      } else {
                        // For now, if the test fails, we mark all assertions as failed/unknown since we don't parse individual assertion results yet
                        icon = <X className="h-4 w-4 text-rose-500" />;
                        textClass = "text-rose-700";
                      }
                    }

                    return (
                      <li key={index} className="flex items-start gap-3 text-sm">
                        <div className="mt-0.5 shrink-0">{icon}</div>
                        <span className={textClass}>{assertion}</span>
                      </li>
                    );
                  })}
                </ul>
              </div>

              {liveError ? (
                <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">
                  <p className="font-semibold">Execution Error</p>
                  {liveError}
                </div>
              ) : null}

              {liveResult ? (
                <div className="space-y-4">
                  <div
                    className={cn(
                      'rounded-lg border p-3 text-xs',
                      liveResult.success ? 'border-emerald-300 bg-emerald-50 text-emerald-700' : 'border-rose-300 bg-rose-50 text-rose-700'
                    )}
                  >
                    <p className="font-semibold text-sm">{liveResult.message}</p>
                  </div>

                  {/* Advanced Details Toggle */}
                  <div className="rounded-lg border border-slate-200">
                    <button
                      onClick={() => setIsAdvancedOpen(!isAdvancedOpen)}
                      className="flex w-full items-center justify-between bg-slate-50 px-4 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100"
                    >
                      <span>Advanced details (Traces & Logs)</span>
                      {isAdvancedOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    </button>

                    {isAdvancedOpen && (
                      <div className="border-t border-slate-200 p-4 space-y-4">
                        {liveResult.artifacts && (liveResult.artifacts.trace || liveResult.artifacts.video || liveResult.artifacts.screenshot) ? (
                          <div className="space-y-2 text-slate-700">
                            <p className="font-semibold text-xs uppercase tracking-wide text-slate-500">Artifacts</p>
                            {liveResult.artifacts.trace ? (
                              <div className="flex items-center gap-2 text-xs">
                                <Layers className="h-3 w-3 text-slate-400" />
                                <span className="font-mono">{liveResult.artifacts.trace}</span>
                              </div>
                            ) : null}
                            {liveResult.artifacts.video ? (
                              <div className="flex items-center gap-2 text-xs">
                                <Play className="h-3 w-3 text-slate-400" />
                                <span className="font-mono">{liveResult.artifacts.video}</span>
                              </div>
                            ) : null}
                            {liveResult.artifacts.screenshot ? (
                              <div className="flex items-center gap-2 text-xs">
                                <FileCode className="h-3 w-3 text-slate-400" />
                                <span className="font-mono">{liveResult.artifacts.screenshot}</span>
                              </div>
                            ) : null}
                          </div>
                        ) : null}

                        <div className="space-y-2">
                          <p className="font-semibold text-xs uppercase tracking-wide text-slate-500">Console Output</p>
                          <div className="max-h-64 overflow-auto rounded-lg border border-slate-200 bg-slate-900 p-3 font-mono text-xs text-slate-300">
                            <pre className="whitespace-pre-wrap">{liveResult.output}</pre>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ) : null}
            </div>

            <div className="flex items-center justify-end gap-3 border-t border-slate-200 bg-slate-50 px-6 py-4">
              <button
                onClick={() => {
                  if (!isLiveRunning) {
                    setIsRunModalOpen(false);
                  }
                }}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100"
                disabled={isLiveRunning}
              >
                Cancel
              </button>
              {liveResult ? (
                <button
                  onClick={() => {
                    setIsRunModalOpen(false);
                  }}
                  className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700"
                >
                  Close
                </button>
              ) : (
                <button
                  onClick={handleExecuteTest}
                  className={cn(
                    'inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700',
                    isLiveRunning && 'cursor-not-allowed opacity-60'
                  )}
                  disabled={isLiveRunning}
                >
                  {isLiveRunning ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Play className="h-4 w-4" aria-hidden />}
                  {isLiveRunning ? 'Running…' : 'Yes, execute'}
                </button>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </article>
  );
};
