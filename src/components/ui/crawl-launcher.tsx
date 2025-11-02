// This file renders a client-side form that triggers the Sparkier crawler via the Next.js API.
'use client';

import { useState } from 'react';
import { Loader2, Play } from 'lucide-react';

import { cn } from '@/lib/utils';

interface CrawlLauncherProps {
  defaultUrl: string;
}

interface CrawlResponse {
  success: boolean;
  message: string;
  output?: string;
}

export const CrawlLauncher = ({ defaultUrl }: CrawlLauncherProps): JSX.Element => {
  const [url, setUrl] = useState(defaultUrl);
  const [maxPages, setMaxPages] = useState(10);
  const [sameOriginOnly, setSameOriginOnly] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [result, setResult] = useState<CrawlResponse | null>(null);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSubmitting(true);
    setResult(null);

    try {
      const response = await fetch('/api/crawl', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({ url, maxPages, sameOriginOnly }),
      });

      const payload = (await response.json()) as CrawlResponse;
      setResult(payload);

      if (payload.success) {
        // Refresh dashboard data after a short delay to allow files to settle.
        setTimeout(() => {
          window.location.reload();
        }, 1200);
      }
    } catch (error) {
      setResult({ success: false, message: (error as Error).message });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <form className="grid gap-4 md:grid-cols-4" onSubmit={handleSubmit}>
        <div className="md:col-span-2">
          <label className="flex flex-col gap-2 text-sm font-medium text-slate-700">
            Target URL
            <input
              required
              type="url"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://www.sparkier.io"
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-sparkier-primary focus:outline-none focus:ring-2 focus:ring-sparkier-primary/30"
            />
          </label>
        </div>
        <div>
          <label className="flex flex-col gap-2 text-sm font-medium text-slate-700">
            Max Pages
            <input
              type="number"
              min={1}
              max={200}
              value={maxPages}
              onChange={(event) => setMaxPages(Number(event.target.value))}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-sparkier-primary focus:outline-none focus:ring-2 focus:ring-sparkier-primary/30"
            />
          </label>
        </div>
        <div className="flex items-end justify-between gap-4">
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input
              type="checkbox"
              checked={sameOriginOnly}
              onChange={(event) => setSameOriginOnly(event.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-sparkier-primary focus:ring-sparkier-primary"
            />
            Same-origin only
          </label>
          <button
            type="submit"
            disabled={isSubmitting}
            className={cn(
              'inline-flex items-center gap-2 rounded-full bg-sparkier-primary px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-sparkier-primary/90',
              isSubmitting && 'cursor-not-allowed opacity-60'
            )}
          >
            {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Play className="h-4 w-4" aria-hidden />}
            {isSubmitting ? 'Running?' : 'Run Crawl'}
          </button>
        </div>
      </form>

      {result ? (
        <div
          className={cn(
            'mt-4 rounded-lg border p-4 text-sm',
            result.success ? 'border-emerald-300 bg-emerald-50 text-emerald-700' : 'border-rose-300 bg-rose-50 text-rose-700'
          )}
        >
          <p className="font-semibold">{result.message}</p>
          {result.output ? (
            <pre className="mt-3 max-h-72 overflow-auto rounded bg-white/80 p-3 text-xs text-slate-800">
              {result.output.trim()}
            </pre>
          ) : null}
        </div>
      ) : null}
    </section>
  );
};
