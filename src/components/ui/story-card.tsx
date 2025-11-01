// This file renders individual user story cards with regression metadata and Playwright details.
import { ArrowUpRight, ClipboardCheck, FileCode, Flag } from 'lucide-react';
import Link from 'next/link';

import type { UserStory } from '@/types';
import { cn } from '@/lib/utils';
import { sanitizeFileSlug } from '@/lib/sanitize';
import { StatusBadge } from '@/components/ui/status-badge';

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

export const StoryCard = ({ story }: StoryCardProps): JSX.Element => (
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
  </article>
);
