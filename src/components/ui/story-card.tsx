// This file renders individual user story cards with regression metadata and Playwright details.
'use client';

import { useState } from 'react';
import { ArrowUpRight, ClipboardCheck, FileCode, Flag, Play, Loader2, Wand2, CheckCircle2, AlertCircle } from 'lucide-react';
import Link from 'next/link';

import type { UserStory } from '@/types';
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
}

const cardAccent: Record<UserStory['kind'], string> = {
  interaction: 'border-sparkier-primary/60 shadow-sparkier-primary/20',
  browsing: 'border-slate-200 shadow-slate-200',
  authentication: 'border-amber-300 shadow-amber-200',
  complex: 'border-rose-300 shadow-rose-200',
};

interface AssertionResult {
  assertion: string;
  passed: boolean;
  error?: string;
  duration: number;
}

interface TestResponse {
  success: boolean;
  message: string;
  output?: string;
  error?: string;
  assertionResults?: AssertionResult[];
}

export const StoryCard = ({ story, crawlId }: StoryCardProps) => {
  const [isRunningTest, setIsRunningTest] = useState(false);
  const [testResult, setTestResult] = useState<TestResponse | null>(null);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);

  const handleRunTest = async () => {
    setIsRunningTest(true);
    setTestResult(null);

    try {
      // Use assertions endpoint to validate each assertion individually
      const url = new URL(`/api/test/${story.specSlug}/assertions`, window.location.origin);
      if (crawlId) {
        url.searchParams.set('crawlId', crawlId);
      }
      const response = await fetch(url.toString(), {
        method: 'POST',
      });

      const payload = (await response.json()) as TestResponse;
      setTestResult(payload);
    } catch (error) {
      setTestResult({ success: false, message: 'Failed to run test', error: (error as Error).message });
    } finally {
      setIsRunningTest(false);
    }
  };

  return (
    <article
      className={cn(
        'rounded-2xl border bg-white p-6 shadow-sm transition hover:shadow-card',
        cardAccent[story.kind],
        'shadow-sm'
      )}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <span className="rounded-full bg-sparkier-primary/10 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-sparkier-primary">
              {story.kind}
            </span>
            <StatusBadge status={story.verificationStatus} />
          </div>
          <h3 className="mt-3 text-2xl font-semibold text-slate-900">{story.title}</h3>
          <p className="mt-2 text-sm text-slate-600">{story.description}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsEditModalOpen(true)}
            className="inline-flex items-center gap-2 rounded-full bg-sparkier-primary px-3 py-1 text-xs font-medium text-white shadow-sm transition hover:bg-sparkier-primary/90"
          >
            <Wand2 className="h-3.5 w-3.5" aria-hidden />
            Edit with AI
          </button>
          <button
            onClick={handleRunTest}
            disabled={isRunningTest}
            className={cn(
              'inline-flex items-center gap-2 rounded-full bg-emerald-600 px-3 py-1 text-xs font-medium text-white shadow-sm transition hover:bg-emerald-700',
              isRunningTest && 'cursor-not-allowed opacity-60'
            )}
          >
            {isRunningTest ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Play className="h-3.5 w-3.5" aria-hidden />}
            {isRunningTest ? 'Running...' : 'Run Test'}
          </button>
          <Link
            href={story.specHref}
            className="inline-flex items-center gap-2 rounded-full border border-slate-200 px-3 py-1 text-xs font-medium text-slate-600 hover:border-sparkier-primary hover:text-sparkier-primary"
            target="_blank"
            rel="noreferrer"
          >
            <FileCode className="h-3.5 w-3.5" aria-hidden />
            View Spec Skeleton
          </Link>
          <a
            href={story.entryUrl}
            className="inline-flex items-center gap-2 rounded-full border border-slate-200 px-3 py-1 text-xs font-medium text-slate-600 hover:border-sparkier-primary hover:text-sparkier-primary"
            target="_blank"
            rel="noreferrer"
          >
            <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
            Source Page
          </a>
        </div>
      </div>

      <div className="mt-6 space-y-6">
        <div className="space-y-3">
          <h4 className="flex items-center gap-2 text-sm font-semibold text-slate-700">
            <Flag className="h-4 w-4 text-sparkier-primary" aria-hidden /> Expected Outcome
          </h4>
          <p className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">{story.expectedOutcome}</p>
          {story.primaryCtaLabel ? (
            <p className="text-xs uppercase tracking-wide text-slate-500">Primary CTA: {story.primaryCtaLabel}</p>
          ) : null}
        </div>

        <div className="space-y-3">
          <h4 className="flex items-center gap-2 text-sm font-semibold text-slate-700">
            <ClipboardCheck className="h-4 w-4 text-sparkier-secondary" aria-hidden /> Baseline Assertions
          </h4>
          <ul className="space-y-2 text-sm text-slate-700">
            {story.baselineAssertions.map((assertion, index) => {
              // Find matching assertion result if test has run
              // Match by index (assertion results are in the same order as baseline assertions)
              const assertionResult = testResult?.assertionResults?.[index];
              
              return (
                <li
                  key={sanitizeFileSlug(assertion, assertion)}
                  className={cn(
                    'flex items-start gap-3 rounded-lg border p-3',
                    assertionResult
                      ? assertionResult.passed
                        ? 'border-emerald-200 bg-emerald-50/50'
                        : 'border-rose-200 bg-rose-50/50'
                      : 'border-slate-200 bg-slate-50'
                  )}
                >
                  {assertionResult && (
                    <div className="flex-shrink-0 mt-0.5">
                      {assertionResult.passed ? (
                        <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                      ) : (
                        <AlertCircle className="h-5 w-5 text-rose-600" />
                      )}
                    </div>
                  )}
                  <div className="flex-1">
                    <p className={cn(
                      'text-sm',
                      assertionResult
                        ? assertionResult.passed
                          ? 'text-emerald-800'
                          : 'text-rose-800'
                        : 'text-slate-700'
                    )}>
                      {assertion}
                    </p>
                    {assertionResult && assertionResult.error && (
                      <details className="mt-2">
                        <summary className="cursor-pointer text-xs text-rose-600 hover:text-rose-700">
                          View error details
                        </summary>
                        <p className="mt-1 rounded bg-rose-100/50 p-2 text-xs text-rose-800">
                          {assertionResult.error}
                        </p>
                      </details>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      </div>

      {testResult && testResult.message && (
        <div className="mt-6">
          <div
            className={cn(
              'rounded-lg border p-3 text-sm',
              testResult.success ? 'border-emerald-300 bg-emerald-50 text-emerald-700' : 'border-rose-300 bg-rose-50 text-rose-700'
            )}
          >
            <p className="font-semibold">{testResult.message}</p>
            {testResult.error && !testResult.assertionResults && (
              <p className="mt-2 text-xs">{testResult.error}</p>
            )}
          </div>
        </div>
      )}

      <TestEditModal
        isOpen={isEditModalOpen}
        onClose={() => setIsEditModalOpen(false)}
        specSlug={story.specSlug}
        storyTitle={story.title}
        baselineAssertions={story.baselineAssertions}
        crawlId={crawlId}
      />
    </article>
  );
};
