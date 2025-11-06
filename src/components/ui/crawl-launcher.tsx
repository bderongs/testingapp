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
  crawlId?: string;
  queued?: boolean;
  status?: 'pending' | 'running' | 'completed' | 'failed';
}

export const CrawlLauncher = ({ defaultUrl }: CrawlLauncherProps) => {
  const [url, setUrl] = useState(defaultUrl);
  const [maxPages, setMaxPages] = useState(10);
  const [sameOriginOnly, setSameOriginOnly] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [result, setResult] = useState<CrawlResponse | null>(null);

  const pollCrawlStatus = async (crawlId: string) => {
    const maxAttempts = 120; // 10 minutes max (5s intervals)
    let attempts = 0;

    const poll = async () => {
      try {
        const response = await fetch(`/api/crawl/${crawlId}`);
        const data = (await response.json()) as {
          success: boolean;
          session?: { status: string };
          data?: unknown;
          message?: string;
        };

        // Handle error responses - but continue polling if it's just "not found" (might be timing issue)
        if (!data.success) {
          // If session not found and we haven't tried many times, continue polling
          // (might be a timing issue or server restart)
          if (data.message?.includes('not found') && attempts < 5) {
            attempts++;
            setTimeout(poll, 2000); // Poll more frequently for first few attempts
            return;
          }
          
          setResult({
            success: false,
            message: data.message || 'Failed to check crawl status',
            crawlId,
          });
          setIsSubmitting(false);
          return;
        }

        // Ensure session exists - but continue polling if it's early
        if (!data.session) {
          if (attempts < 5) {
            attempts++;
            setTimeout(poll, 2000); // Poll more frequently for first few attempts
            return;
          }
          
          setResult({
            success: false,
            message: 'Crawl session data not available',
            crawlId,
          });
          setIsSubmitting(false);
          return;
        }

        const status = data.session.status;

        if (status === 'completed' && data.data) {
          // Crawl completed, redirect to results
          window.location.href = `/?crawlId=${crawlId}`;
          return;
        }

        if (status === 'failed') {
          setResult({
            success: false,
            message: 'Crawl failed. Please try again.',
            crawlId,
            status: 'failed',
          });
          setIsSubmitting(false);
          return;
        }

        attempts++;
        if (attempts < maxAttempts && (status === 'running' || status === 'pending')) {
          setTimeout(poll, 5000); // Poll every 5 seconds
        } else if (attempts >= maxAttempts) {
          setResult({
            success: false,
            message: 'Crawl is taking longer than expected. Please check back later.',
            crawlId,
          });
          setIsSubmitting(false);
        }
      } catch (error) {
        setResult({
          success: false,
          message: `Failed to check crawl status: ${(error as Error).message}`,
          crawlId,
        });
        setIsSubmitting(false);
      }
    };

    setTimeout(poll, 1000); // Start polling after 1 second
  };

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

      if (payload.success && payload.crawlId) {
        if (payload.queued) {
          // If queued, poll for status updates
          pollCrawlStatus(payload.crawlId);
        } else if (payload.status === 'running') {
          // If running, poll for completion
          pollCrawlStatus(payload.crawlId);
        } else {
          // If completed immediately (shouldn't happen, but handle it)
          setTimeout(() => {
            window.location.href = `/?crawlId=${payload.crawlId}`;
          }, 1200);
        }
      } else if (payload.success && !payload.crawlId) {
        // Legacy mode - no crawl ID
        setTimeout(() => {
          window.location.reload();
        }, 1200);
      }
    } catch (error) {
      setResult({ success: false, message: (error as Error).message });
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
          {result.crawlId ? (
            <div className="mt-2">
              <p className="text-xs text-slate-600">
                Crawl ID: <code className="rounded bg-white/80 px-2 py-1 font-mono">{result.crawlId}</code>
              </p>
              {result.status && (
                <p className="mt-1 text-xs text-slate-600">
                  Status: <span className="font-semibold capitalize">{result.status}</span>
                </p>
              )}
            </div>
          ) : null}
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
