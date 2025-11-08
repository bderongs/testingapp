// This file renders a dual selector for switching between websites and historical crawls.
'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';

import type { CrawlSummary, WebsiteSummary } from '@/lib/websites';

interface DomainSwitcherProps {
  domains: WebsiteSummary[];
  selectedDomain: string | null;
  crawlHistory: CrawlSummary[];
  activeCrawlId: string | null;
}

export const DomainSwitcher = ({ domains, selectedDomain, crawlHistory, activeCrawlId }: DomainSwitcherProps) => {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const updateQuery = (domain: string | null, crawlId: string | null) => {
    const params = new URLSearchParams(searchParams.toString());
    if (domain) {
      params.set('domain', domain);
    } else {
      params.delete('domain');
    }

    if (crawlId) {
      params.set('crawlId', crawlId);
    } else {
      params.delete('crawlId');
    }

    const queryString = params.toString();
    startTransition(() => {
      router.push(queryString.length > 0 ? `${pathname}?${queryString}` : pathname);
    });
  };

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-end">
      <label className="flex flex-col text-xs font-medium uppercase tracking-wide text-slate-500">
        Website
        <select
          className="mt-1 min-w-[16rem] rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm focus:border-sparkier-primary focus:outline-none focus:ring-2 focus:ring-sparkier-primary/30"
          value={selectedDomain ?? ''}
          onChange={(event) => {
            const domain = event.target.value || null;
            updateQuery(domain, null);
          }}
          disabled={isPending || domains.length === 0}
        >
          {domains.length === 0 ? (
            <option value="">No websites yet</option>
          ) : null}
          {domains.map((domain) => (
            <option key={domain.domain} value={domain.domain}>
              {domain.domain} ({domain.crawlCount} runs)
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col text-xs font-medium uppercase tracking-wide text-slate-500">
        Crawl
        <select
          className="mt-1 min-w-[16rem] rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm focus:border-sparkier-primary focus:outline-none focus:ring-2 focus:ring-sparkier-primary/30"
          value={activeCrawlId ?? ''}
          onChange={(event) => {
            const crawl = event.target.value || null;
            updateQuery(selectedDomain ?? null, crawl);
          }}
          disabled={isPending || (selectedDomain === null && crawlHistory.length === 0)}
        >
          <option value="">Latest snapshot</option>
          {crawlHistory.map((crawl) => {
            const isoLabel =
              crawl.createdAt ??
              crawl.completedAt ??
              null;
            const formatted = isoLabel
              ? new Date(isoLabel).toISOString().replace('T', ' ').slice(0, 19)
              : crawl.id;

            return (
              <option key={crawl.id} value={crawl.id}>
                {formatted} · {crawl.status ?? 'completed'}
              </option>
            );
          })}
        </select>
      </label>
    </div>
  );
};

