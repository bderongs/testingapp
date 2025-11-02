// This file renders the Sparkier regression dashboard, summarising user stories and generated Playwright specs.
import { Activity, Layers, ShieldCheck, Timer } from 'lucide-react';
import Link from 'next/link';

import { loadDashboardData } from '@/lib/storyData';
import { CrawlLauncher } from '@/components/ui/crawl-launcher';
import { MetricsCard } from '@/components/ui/metrics-card';
import { SectionTitle } from '@/components/ui/section-title';
import { StoryCard } from '@/components/ui/story-card';

export default async function BrandPage(): Promise<JSX.Element> {
  const data = await loadDashboardData();

  return (
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col gap-8 px-4 pb-16 pt-12 sm:px-6 lg:px-8">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Sparkier Regression Dashboard</h1>
          <p className="mt-2 text-sm text-slate-600">
            Generated from the latest automated crawl. Review baseline assertions, CTA coverage, and Playwright skeletons before pushing your next deployment.
          </p>
        </div>
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Timer className="h-4 w-4" aria-hidden />
          <span>{data.generatedAtLabel}</span>
        </div>
      </header>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricsCard icon={Layers} label="Total Stories" value={data.storyCount} tone="primary" />
        <MetricsCard icon={ShieldCheck} label="Story Types" value={`${data.summary.byKind.interaction} INT / ${data.summary.byKind.browsing} BRW / ${data.summary.byKind.authentication} AUTH / ${data.summary.byKind.complex} CPLX`} tone="secondary" />
        <MetricsCard icon={Activity} label="Unverified" value={data.summary.unverified.toString()} tone="warning" />
        <MetricsCard icon={Layers} label="Pages Crawled" value={data.summary.pageCount.toString()} tone="muted" />
      </section>

      <SectionTitle title="Run a Crawl" subtitle="Trigger the CLI without leaving the dashboard. Results refresh automatically when the crawl completes." />
      <CrawlLauncher defaultUrl={data.baseUrl === 'Unknown source' ? 'https://www.sparkier.io' : data.baseUrl} />

      <SectionTitle title="User Stories" subtitle="Drill into each flow to view expected outcomes, assertions, and generated Playwright steps." />

      {data.stories.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center text-slate-500">
          No user stories were found. Run the crawler to generate fresh regression insights.
        </p>
      ) : (
        <div className="grid gap-6">
          {data.stories.map((story) => (
            <StoryCard key={story.id} story={story} />
          ))}
        </div>
      )}

      <footer className="mt-12 flex flex-wrap items-center justify-between gap-4 border-t border-slate-200 pt-6 text-sm text-slate-500">
        <span>Crawl source: {data.baseUrl}</span>
        <span>
          Need deeper coverage?{' '}
          <Link href="https://sparkier.io" className="font-medium text-sparkier-primary hover:text-sparkier-secondary">
            Talk to Sparkier
          </Link>
        </span>
      </footer>
    </main>
  );
}
