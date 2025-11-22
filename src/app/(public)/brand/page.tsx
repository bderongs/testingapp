// This file renders the Sparkier regression dashboard, highlighting discovery insights, user stories, and live testing controls.
import {
  Activity,
  Compass,
  Cookie,
  Layers,
  ShieldCheck,
  Sparkles,
  Target,
  Timer,
  Users,
} from 'lucide-react';
import Link from 'next/link';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { loadDashboardData } from '@/lib/storyData';
import { CrawlLauncher } from '@/components/ui/crawl-launcher';
import { StoryCard } from '@/components/ui/story-card';
import { StoryList } from '@/components/ui/story-list';
import { SitemapVisualizer } from '@/components/ui/sitemap-visualizer';
import { DomainSwitcher } from '@/components/ui/domain-switcher';
import { CookieManager } from '@/components/ui/cookie-manager';
import { SessionCookiesPanel } from '@/components/ui/session-cookies-panel';

const metricTone = (value: number) => (value > 0 ? 'text-slate-900' : 'text-slate-500');

export default async function BrandPage({
  searchParams,
}: {
  searchParams: Promise<{ domain?: string; crawlId?: string }>;
}) {
  const resolvedParams = await searchParams;
  const data = await loadDashboardData({
    domain: resolvedParams.domain,
    crawlId: resolvedParams.crawlId,
  });
  const effectiveCrawlId = data.activeCrawlId ?? undefined;

  return (
    <main className="min-h-screen bg-slate-50">
      <header className="relative overflow-hidden border-b border-slate-200 bg-white">
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-indigo-100/80 via-white to-slate-100/70" />
        <div className="relative mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:px-8">
          <div className="grid gap-10 lg:grid-cols-[1.6fr,1fr]">
            <div className="space-y-6">
              <span className="inline-flex items-center gap-2 rounded-full bg-indigo-100 px-4 py-1 text-xs font-semibold uppercase tracking-wide text-indigo-700">
                <Sparkles className="h-3 w-3" aria-hidden />
                Sparkier Test Lab
              </span>
              <div className="space-y-3">
                <h1 className="text-3xl font-bold leading-tight text-slate-900 sm:text-4xl">
                  Understand every critical flow before you ship
                </h1>
                <p className="text-sm leading-relaxed text-slate-600 sm:text-base">
                  Sparkier inspects your live app, maps the primary actions, drafts Playwright tests, and lets you execute
                  them with real session cookies. Focus on the product, we keep the regression suite honest.
                </p>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white/70 p-4 shadow-sm">
                  <Timer className="h-5 w-5 text-indigo-500" aria-hidden />
                  <div>
                    <p className="text-xs uppercase tracking-wide text-slate-500">Latest crawl</p>
                    <p className="text-sm font-semibold text-slate-800">{data.generatedAtLabel}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white/70 p-4 shadow-sm">
                  <ShieldCheck className="h-5 w-5 text-emerald-500" aria-hidden />
                  <div>
                    <p className="text-xs uppercase tracking-wide text-slate-500">Stories tracked</p>
                    <p className="text-sm font-semibold text-slate-800">{data.storyCount}</p>
                  </div>
                </div>
              </div>
            </div>
            <div className="rounded-3xl border border-indigo-100 bg-white/80 p-6 shadow-lg backdrop-blur">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-indigo-600">Your website</h2>
              <p className="mt-2 text-sm text-slate-600">
                Pick the environment you want to explore. Sparkier keeps the crawl history and cookies in sync.
              </p>
              <div className="mt-4">
                <DomainSwitcher
                  domains={data.availableDomains}
                  selectedDomain={data.selectedDomain}
                  crawlHistory={data.crawlHistory}
                  activeCrawlId={data.activeCrawlId}
                />
              </div>
              <dl className="mt-6 grid gap-4 text-sm text-slate-600 sm:grid-cols-2">
                <div>
                  <dt className="text-xs uppercase tracking-wide text-slate-500">Base URL</dt>
                  <dd className="mt-1 font-mono text-xs leading-relaxed text-slate-500 break-all">{data.baseUrl}</dd>
                </div>
                {effectiveCrawlId ? (
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-slate-500">Active crawl</dt>
                    <dd className="mt-1 rounded-full bg-slate-100 px-3 py-1 font-mono text-[11px] text-slate-600">
                      {effectiveCrawlId}
                    </dd>
                  </div>
                ) : null}
                <div>
                  <dt className="text-xs uppercase tracking-wide text-slate-500">Mapped pages</dt>
                  <dd className="mt-1 flex items-center gap-2 font-semibold text-slate-800">
                    <Activity className="h-4 w-4 text-indigo-500" aria-hidden />
                    {data.summary.pageCount}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-wide text-slate-500">Saved cookies</dt>
                  <dd className="mt-1 flex items-center gap-2 font-semibold text-slate-800">
                    <Cookie className="h-4 w-4 text-amber-500" aria-hidden />
                    {data.cookieSnapshot.cookies.length}
                  </dd>
                </div>
              </dl>
            </div>
          </div>
          <div className="mt-12 rounded-3xl border border-slate-200 bg-white/90 p-6 shadow-md">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Coverage snapshot</h2>
                <p className="text-sm text-slate-600">
                  Measure how much of the experience Sparkier already understands.
                </p>
              </div>
              <span className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1 text-[11px] font-medium text-slate-600">
                <ShieldCheck className="h-3 w-3 text-emerald-500" aria-hidden />
                {data.summary.byKind.interaction + data.summary.byKind.authentication > 0
                  ? 'Key flows under watch'
                  : 'Run a crawl to get started'}
              </span>
            </div>
            <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="flex items-center justify-between text-sm font-medium text-slate-500">
                  <span>Total stories</span>
                  <Layers className="h-4 w-4 text-indigo-500" aria-hidden />
                </div>
                <p className="mt-2 text-3xl font-semibold text-slate-900">{data.storyCount}</p>
                <p className="mt-1 text-xs text-slate-500">Across browsing, interaction, auth, and complex journeys</p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex items-center justify-between text-sm font-medium text-slate-500">
                  <span>Awaiting validation</span>
                  <Target className="h-4 w-4 text-amber-500" aria-hidden />
                </div>
                <p className={`mt-2 text-3xl font-semibold ${metricTone(data.summary.unverified)}`}>
                  {data.summary.unverified}
                </p>
                <p className="mt-1 text-xs text-slate-500">Stories to run live before they can be trusted</p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex items-center justify-between text-sm font-medium text-slate-500">
                  <span>Complex flows w/ forms</span>
                  <Users className="h-4 w-4 text-emerald-500" aria-hidden />
                </div>
                <p className={`mt-2 text-3xl font-semibold ${metricTone(data.summary.complexWithForms)}`}>
                  {data.summary.complexWithForms}
                </p>
                <p className="mt-1 text-xs text-slate-500">Ready for mocked data or end-to-end runs</p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex items-center justify-between text-sm font-medium text-slate-500">
                  <span>Pending pages</span>
                  <Compass className="h-4 w-4 text-sky-500" aria-hidden />
                </div>
                <p className={`mt-2 text-3xl font-semibold ${metricTone(data.pendingUrlCount)}`}>
                  {data.pendingUrlCount}
                </p>
                <p className="mt-1 text-xs text-slate-500">Discovered but not yet explored by the crawler</p>
              </div>
            </div>
          </div>
        </div>
      </header>

      <div className="-mt-8 space-y-12 pb-16">
        <section className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Crawling & sessions</h2>
              <p className="text-sm text-slate-600">
                Launch intelligent crawls and control how cookies are injected into Playwright.
              </p>
            </div>
            <span className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1 text-[11px] font-medium text-slate-600">
              <Cookie className="h-3 w-3 text-amber-500" aria-hidden />
              {data.cookieSnapshot.updatedAtLabel}
            </span>
          </div>
          <div className="mt-6 grid gap-6 lg:grid-cols-2 xl:grid-cols-[1.5fr,1fr]">
            <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-slate-900">Targeted crawl</h3>
                  <p className="mt-1 text-xs text-slate-500">
                    Launch a fresh crawl from any URL. Sparkier inspects the DOM, identifies page goals, and queues the CTAs that matter.
                  </p>
                </div>
                <div className="flex flex-col gap-1 text-[11px] uppercase tracking-wide text-slate-500">
                  <span className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1 text-[10px] font-medium">
                    <Compass className="h-3 w-3 text-indigo-500" aria-hidden />
                    AI-guided traversal
                  </span>
                  <span className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1 text-[10px] font-medium">
                    <Activity className="h-3 w-3 text-emerald-500" aria-hidden />
                    {data.pendingUrlCount} pending links
                  </span>
                </div>
              </div>
              <div className="mt-6 rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-4">
                <dl className="grid gap-4 text-xs text-slate-600 sm:grid-cols-2">
                  <div>
                    <dt className="uppercase tracking-wide text-slate-500">Start URL</dt>
                    <dd className="mt-1 font-mono text-[11px] leading-relaxed text-slate-500 break-all">
                      {data.baseUrl === 'Unknown source' ? 'https://www.sparkier.io' : data.baseUrl}
                    </dd>
                  </div>
                  <div>
                    <dt className="uppercase tracking-wide text-slate-500">Max depth</dt>
                    <dd className="mt-1 text-sm font-semibold text-slate-800">10 pages</dd>
                  </div>
                </dl>
              </div>
              <div className="mt-6">
                <CrawlLauncher
                  defaultUrl={data.baseUrl === 'Unknown source' ? 'https://www.sparkier.io' : data.baseUrl}
                  domain={data.selectedDomain}
                  cookieSnapshot={data.cookieSnapshot}
                />
              </div>
            </div>
            <SessionCookiesPanel
              domain={data.selectedDomain}
              cookieSnapshot={data.cookieSnapshot}
            />
          </div>
        </section>

        <section className="mx-auto max-w-6xl space-y-6 px-4 sm:px-6 lg:px-8">
          <StoryList
            initialStories={data.stories}
            crawlId={effectiveCrawlId}
            domain={data.selectedDomain}
            savedCookieCount={data.cookieSnapshot.cookies.length}
            availablePages={data.availablePages}
          />
        </section>

        <section className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Exploration map</h2>
                <p className="text-sm text-slate-600">
                  Visualise where Sparkier has been and which CTAs we recommend exploring next.
                </p>
              </div>
              <span className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1 text-[11px] font-medium text-slate-600">
                <Activity className="h-3 w-3" aria-hidden />
                {data.summary.pageCount} pages mapped
              </span>
            </div>
            <div className="mt-6">
              <SitemapVisualizer nodes={data.sitemapNodes} edges={data.sitemapEdges} />
            </div>
          </div>
        </section>

        <footer className="border-t border-slate-200 bg-white/80">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-6 text-xs text-slate-500 sm:px-6 lg:px-8">
            <span>
              Crawl source:{' '}
              <span className="font-medium text-slate-700">{data.baseUrl}</span>
            </span>
            <span>
              Need deeper coverage?{' '}
              <Link href="https://sparkier.io" className="font-medium text-indigo-600 hover:text-indigo-500">
                Talk to Sparkier
              </Link>
            </span>
          </div>
        </footer>
      </div>
    </main>
  );
}
