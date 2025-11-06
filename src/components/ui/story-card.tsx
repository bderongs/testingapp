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

export const StoryCard = ({ story }: StoryCardProps) => {
  const [isRunningTest, setIsRunningTest] = useState(false);
  const [testResult, setTestResult] = useState<TestResponse | null>(null);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);

  const handleRunTest = async () => {
    setIsRunningTest(true);
    setTestResult(null);

    try {
      // Use assertions endpoint to validate each assertion individually
      const response = await fetch(`/api/test/${story.specSlug}/assertions`, {
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

      <div className="mt-6 grid gap-6 md:grid-cols-2">
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
            {story.baselineAssertions.map((assertion) => (
              <li key={sanitizeFileSlug(assertion, assertion)} className="rounded-lg border border-slate-200 bg-slate-50 p-2">
                {assertion}
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="mt-6 grid gap-6 md:grid-cols-2">
        <div>
          <h4 className="mb-2 text-sm font-semibold text-slate-700">Playwright Outline</h4>
          <pre className="max-h-64 overflow-auto rounded-lg border border-slate-200 bg-slate-900/95 p-4 text-xs text-slate-100">
            {story.playwrightOutline.join('\n')}
          </pre>
        </div>
        <div>
          <h4 className="mb-2 text-sm font-semibold text-slate-700">Repeatability Notes</h4>
          <ul className="space-y-2 text-sm text-slate-700">
            {story.repeatabilityNotes.map((note) => (
              <li key={sanitizeFileSlug(note, note)} className="rounded-lg border border-dashed border-slate-200 bg-white p-3">
                {note}
              </li>
            ))}
          </ul>
        </div>
      </div>

      {testResult && (
        <div className="mt-6">
          <h4 className="mb-3 text-sm font-semibold text-slate-700">Test Results</h4>
          <div
            className={cn(
              'rounded-lg border p-4 text-sm',
              testResult.success ? 'border-emerald-300 bg-emerald-50 text-emerald-700' : 'border-rose-300 bg-rose-50 text-rose-700'
            )}
          >
            <p className="font-semibold">{testResult.message}</p>
            {testResult.error && <p className="mt-2 text-xs">{testResult.error}</p>}
            
            {testResult.assertionResults && testResult.assertionResults.length > 0 && (
              <div className="mt-4 space-y-2">
                <p className="text-xs font-medium uppercase tracking-wide opacity-75">Assertion Results</p>
                {testResult.assertionResults.map((result, index) => (
                  <div
                    key={index}
                    className={cn(
                      'flex items-start gap-3 rounded-lg border p-3',
                      result.passed
                        ? 'border-emerald-200 bg-emerald-100/50'
                        : 'border-rose-200 bg-rose-100/50'
                    )}
                  >
                    <div className="flex-shrink-0 mt-0.5">
                      {result.passed ? (
                        <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                      ) : (
                        <AlertCircle className="h-4 w-4 text-rose-600" />
                      )}
                    </div>
                    <div className="flex-1">
                      <p className={cn('text-xs', result.passed ? 'text-emerald-800' : 'text-rose-800')}>
                        {result.assertion}
                      </p>
                      {result.error && <p className="mt-1 text-xs text-rose-600">{result.error}</p>}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {testResult.output && (
              <pre className="mt-3 max-h-72 overflow-auto rounded bg-white/80 p-3 text-xs text-slate-800">
                {testResult.output.trim()}
              </pre>
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
      />
    </article>
  );
};
