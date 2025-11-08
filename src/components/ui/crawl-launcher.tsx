// This file renders a client-side form that triggers the Sparkier crawler via the Next.js API.
'use client';

import { useState, useEffect, useRef } from 'react';
import { ChevronDown, ChevronUp, Loader2, Play } from 'lucide-react';

import { cn } from '@/lib/utils';
import type { Cookie } from '@/types';

type TimerHandle = ReturnType<typeof setTimeout>;

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
  const [showCookies, setShowCookies] = useState(false);
  const [cookiesJson, setCookiesJson] = useState('');
  const [cookiesError, setCookiesError] = useState<string | null>(null);
  const [cookiesPreview, setCookiesPreview] = useState<number | null>(null);
  const pollTimerRef = useRef<TimerHandle | null>(null);

  useEffect(() => {
    return () => {
      if (pollTimerRef.current) {
        clearTimeout(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, []);

  const stopPolling = () => {
    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  };

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
          stopPolling();
          setIsSubmitting(false);
          window.location.assign(`/brand?crawlId=${crawlId}`);
          return;
        }

        if (status === 'failed') {
          stopPolling();
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
          const delay = attempts < 5 ? 2000 : 5000;
          stopPolling();
          pollTimerRef.current = setTimeout(poll, delay); // Poll every few seconds
        } else if (attempts >= maxAttempts) {
          stopPolling();
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
        stopPolling();
      }
    };

    stopPolling();
    pollTimerRef.current = setTimeout(poll, 1000); // Start polling after 1 second
  };

  /**
   * Helper function to parse cookies without setting error state (for preview).
   */
  const parseCookiesForPreview = (input: string): Cookie[] | null => {
    if (!input.trim()) {
      return null;
    }

    const cookies: Cookie[] = [];
    const extractDomainFromUrl = (urlString: string): string | null => {
      try {
        const url = new URL(urlString);
        return url.hostname;
      } catch {
        return null;
      }
    };

    // Try JSON first
    try {
      const parsed = JSON.parse(input);
      if (Array.isArray(parsed)) {
        for (const cookie of parsed) {
          if (typeof cookie === 'object' && cookie !== null) {
            const domain = cookie.domain || extractDomainFromUrl(url) || '';
            if (cookie.name && cookie.value && domain) {
              cookies.push({
                name: String(cookie.name),
                value: String(cookie.value),
                domain: domain,
                path: cookie.path || '/',
                expires: cookie.expires ? Number(cookie.expires) : undefined,
                httpOnly: cookie.httpOnly === true || cookie.httpOnly === 'true',
                secure: cookie.secure === true || cookie.secure === 'true',
                sameSite: cookie.sameSite === 'Strict' || cookie.sameSite === 'Lax' || cookie.sameSite === 'None' 
                  ? cookie.sameSite 
                  : undefined,
              });
            }
          }
        }
        if (cookies.length > 0) return cookies;
      } else if (typeof parsed === 'object' && parsed !== null && parsed.cookies && Array.isArray(parsed.cookies)) {
        for (const cookie of parsed.cookies) {
          const domain = cookie.domain || extractDomainFromUrl(url) || '';
          if (cookie.name && cookie.value && domain) {
            cookies.push({
              name: String(cookie.name),
              value: String(cookie.value),
              domain: domain,
              path: cookie.path || '/',
              expires: cookie.expires ? Number(cookie.expires) : undefined,
              httpOnly: cookie.httpOnly === true || cookie.httpOnly === 'true',
              secure: cookie.secure === true || cookie.secure === 'true',
              sameSite: cookie.sameSite === 'Strict' || cookie.sameSite === 'Lax' || cookie.sameSite === 'None' 
                ? cookie.sameSite 
                : undefined,
            });
          }
        }
        if (cookies.length > 0) return cookies;
      }
    } catch {
      // Not JSON
    }

    // Try Netscape format
    const lines = input.split('\n').filter(line => line.trim() && !line.trim().startsWith('#'));
    if (lines.length > 0) {
      const defaultDomain = extractDomainFromUrl(url);
      if (defaultDomain) {
        for (const line of lines) {
          const parts = line.split('\t');
          if (parts.length >= 7) {
            const [domain, , path, secure, expiration, name, ...valueParts] = parts;
            const value = valueParts.join('\t');
            if (name && value) {
              cookies.push({
                name: name.trim(),
                value: value.trim(),
                domain: domain.trim() || defaultDomain,
                path: path.trim() || '/',
                expires: expiration && expiration !== '0' && expiration !== '-1' 
                  ? Math.floor(Number(expiration)) 
                  : undefined,
                secure: secure === 'TRUE' || secure === 'true',
                httpOnly: false,
                sameSite: undefined,
              });
            }
          } else if (parts.length >= 2) {
            const firstPart = parts[0].trim();
            if (firstPart.includes('=')) {
              const [name, ...valueParts] = firstPart.split('=');
              const value = valueParts.join('=');
              if (name && value) {
                cookies.push({
                  name: name.trim(),
                  value: value.trim(),
                  domain: defaultDomain,
                  path: '/',
                  secure: false,
                  httpOnly: false,
                  sameSite: undefined,
                });
              }
            } else {
              const name = parts[0].trim();
              const value = parts.slice(1).join('\t').trim();
              if (name && value) {
                cookies.push({
                  name,
                  value,
                  domain: defaultDomain,
                  path: '/',
                  secure: false,
                  httpOnly: false,
                  sameSite: undefined,
                });
              }
            }
          }
        }
        if (cookies.length > 0) return cookies;
      }
    }

    // Try cookie header format
    if (input.includes('=') && (input.includes(';') || input.split('=').length === 2)) {
      const defaultDomain = extractDomainFromUrl(url);
      if (defaultDomain) {
        const cookiePairs = input.split(';').map(pair => pair.trim());
        for (const pair of cookiePairs) {
          const [name, ...valueParts] = pair.split('=');
          const value = valueParts.join('=').trim();
          if (name && value) {
            cookies.push({
              name: name.trim(),
              value: value,
              domain: defaultDomain,
              path: '/',
              secure: false,
              httpOnly: false,
              sameSite: undefined,
            });
          }
        }
        if (cookies.length > 0) return cookies;
      }
    }

    return null;
  };

  /**
   * Parses cookies from various formats commonly exported by browser DevTools.
   * Supports: JSON array, Netscape cookie format, and browser extension formats.
   */
  const parseCookies = (): Cookie[] | null => {
    if (!cookiesJson.trim()) {
      return null;
    }

    const input = cookiesJson.trim();
    const cookies: Cookie[] = [];

    // Try to extract domain from URL if available
    const extractDomainFromUrl = (urlString: string): string | null => {
      try {
        const url = new URL(urlString);
        return url.hostname;
      } catch {
        return null;
      }
    };

    // Method 1: Try JSON array format (most common from browser extensions)
    try {
      const parsed = JSON.parse(input);
      
      if (Array.isArray(parsed)) {
        // Standard JSON array format
        for (const cookie of parsed) {
          if (typeof cookie === 'object' && cookie !== null) {
            const domain = cookie.domain || extractDomainFromUrl(url) || '';
            if (cookie.name && cookie.value && domain) {
              cookies.push({
                name: String(cookie.name),
                value: String(cookie.value),
                domain: domain,
                path: cookie.path || '/',
                expires: cookie.expires ? Number(cookie.expires) : undefined,
                httpOnly: cookie.httpOnly === true || cookie.httpOnly === 'true',
                secure: cookie.secure === true || cookie.secure === 'true',
                sameSite: cookie.sameSite === 'Strict' || cookie.sameSite === 'Lax' || cookie.sameSite === 'None' 
                  ? cookie.sameSite 
                  : undefined,
              });
            }
          }
        }
        if (cookies.length > 0) {
          setCookiesError(null);
          return cookies;
        }
      } else if (typeof parsed === 'object' && parsed !== null) {
        // Single cookie object or object with cookies array
        if (parsed.cookies && Array.isArray(parsed.cookies)) {
          for (const cookie of parsed.cookies) {
            const domain = cookie.domain || extractDomainFromUrl(url) || '';
            if (cookie.name && cookie.value && domain) {
              cookies.push({
                name: String(cookie.name),
                value: String(cookie.value),
                domain: domain,
                path: cookie.path || '/',
                expires: cookie.expires ? Number(cookie.expires) : undefined,
                httpOnly: cookie.httpOnly === true || cookie.httpOnly === 'true',
                secure: cookie.secure === true || cookie.secure === 'true',
                sameSite: cookie.sameSite === 'Strict' || cookie.sameSite === 'Lax' || cookie.sameSite === 'None' 
                  ? cookie.sameSite 
                  : undefined,
              });
            }
          }
          if (cookies.length > 0) {
            setCookiesError(null);
            return cookies;
          }
        }
      }
    } catch {
      // Not JSON, try other formats
    }

    // Method 2: Try Netscape cookie format (tab-separated)
    // Format: domain	flag	path	secure	expiration	name	value
    const lines = input.split('\n').filter(line => line.trim() && !line.trim().startsWith('#'));
    if (lines.length > 0) {
      const defaultDomain = extractDomainFromUrl(url);
      if (!defaultDomain) {
        setCookiesError('Could not determine domain. Please ensure the Target URL is set or include domain in cookies.');
        return null;
      }

      for (const line of lines) {
        const parts = line.split('\t');
        if (parts.length >= 7) {
          // Netscape format
          const [domain, , path, secure, expiration, name, ...valueParts] = parts;
          const value = valueParts.join('\t'); // In case value contains tabs
          
          if (name && value) {
            const expires = expiration && expiration !== '0' && expiration !== '-1' 
              ? Math.floor(Number(expiration)) 
              : undefined;
            
            cookies.push({
              name: name.trim(),
              value: value.trim(),
              domain: domain.trim() || defaultDomain,
              path: path.trim() || '/',
              expires: expires && expires > 0 ? expires : undefined,
              secure: secure === 'TRUE' || secure === 'true',
              httpOnly: false, // Netscape format doesn't include this
              sameSite: undefined,
            });
          }
        } else if (parts.length >= 2) {
          // Simple tab-separated: name	value (or name=value format)
          const firstPart = parts[0].trim();
          if (firstPart.includes('=')) {
            // name=value format
            const [name, ...valueParts] = firstPart.split('=');
            const value = valueParts.join('=');
            if (name && value) {
              cookies.push({
                name: name.trim(),
                value: value.trim(),
                domain: defaultDomain,
                path: '/',
                secure: false,
                httpOnly: false,
                sameSite: undefined,
              });
            }
          } else {
            // Simple tab-separated name and value
            const name = parts[0].trim();
            const value = parts.slice(1).join('\t').trim();
            if (name && value) {
              cookies.push({
                name,
                value,
                domain: defaultDomain,
                path: '/',
                secure: false,
                httpOnly: false,
                sameSite: undefined,
              });
            }
          }
        }
      }
      
      if (cookies.length > 0) {
        setCookiesError(null);
        return cookies;
      }
    }

    // Method 3: Try cookie header format (name=value; name2=value2)
    if (input.includes('=') && (input.includes(';') || input.split('=').length === 2)) {
      const defaultDomain = extractDomainFromUrl(url);
      if (!defaultDomain) {
        setCookiesError('Could not determine domain. Please ensure the Target URL is set.');
        return null;
      }

      const cookiePairs = input.split(';').map(pair => pair.trim());
      for (const pair of cookiePairs) {
        const [name, ...valueParts] = pair.split('=');
        const value = valueParts.join('=').trim();
        if (name && value) {
          cookies.push({
            name: name.trim(),
            value: value,
            domain: defaultDomain,
            path: '/',
            secure: false,
            httpOnly: false,
            sameSite: undefined,
          });
        }
      }
      
      if (cookies.length > 0) {
        setCookiesError(null);
        return cookies;
      }
    }

    // If we get here, we couldn't parse the format
    setCookiesError('Could not parse cookies. Please use JSON array format, Netscape format, or cookie header format.');
    return null;
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSubmitting(true);
    setResult(null);

    const cookies = parseCookies();
    if (cookiesJson.trim() && !cookies) {
      setIsSubmitting(false);
      return;
    }

    try {
      const response = await fetch('/api/crawl', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({ url, maxPages, sameOriginOnly, cookies: cookies || undefined }),
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

      {/* Cookie Session Section */}
      <div className="mt-4 border-t border-slate-200 pt-4">
        <button
          type="button"
          onClick={() => setShowCookies(!showCookies)}
          className="flex w-full items-center justify-between text-sm font-medium text-slate-700 hover:text-slate-900"
        >
          <span>Cookie Session (Optional)</span>
          {showCookies ? (
            <ChevronUp className="h-4 w-4" aria-hidden />
          ) : (
            <ChevronDown className="h-4 w-4" aria-hidden />
          )}
        </button>

        {showCookies && (
          <div className="mt-3 space-y-3">
            <div>
              <label className="flex flex-col gap-2 text-sm font-medium text-slate-700">
                Cookies (Multiple Formats Supported)
                <textarea
                  value={cookiesJson}
                  onChange={(event) => {
                    const value = event.target.value;
                    setCookiesJson(value);
                    setCookiesError(null);
                    setCookiesPreview(null);
                    
                    // Try to parse in real-time for preview (debounced)
                    if (value.trim()) {
                      const parsed = parseCookiesForPreview(value);
                      if (parsed && parsed.length > 0) {
                        setCookiesPreview(parsed.length);
                      }
                    }
                  }}
                  placeholder={`Paste cookies here in any format:\n\nJSON: [{"name":"session_id","value":"abc123","domain":"example.com"}]\n\nNetscape: example.com\tTRUE\t/\tTRUE\t1234567890\tsession_id\tabc123\n\nCookie header: session_id=abc123; auth_token=xyz789`}
                  rows={8}
                  className={cn(
                    'rounded-lg border px-3 py-2 font-mono text-xs shadow-sm focus:outline-none focus:ring-2',
                    cookiesError 
                      ? 'border-rose-300 focus:border-rose-500 focus:ring-rose-500/30' 
                      : cookiesPreview 
                        ? 'border-emerald-300 focus:border-emerald-500 focus:ring-emerald-500/30'
                        : 'border-slate-300 focus:border-sparkier-primary focus:ring-sparkier-primary/30'
                  )}
                />
              </label>
              {cookiesError && (
                <p className="mt-1 text-xs text-rose-600">{cookiesError}</p>
              )}
              {!cookiesError && cookiesPreview !== null && cookiesPreview > 0 && (
                <p className="mt-1 text-xs text-emerald-600">
                  ✓ Successfully parsed {cookiesPreview} cookie{cookiesPreview !== 1 ? 's' : ''}
                </p>
              )}
            </div>
            <div className="rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
              <p className="font-semibold text-slate-700 mb-2">How to get cookies:</p>
              <ol className="list-decimal list-inside space-y-1 ml-2 mb-3">
                <li>Open your browser's Developer Tools (F12)</li>
                <li>Go to the Application/Storage tab</li>
                <li>Click on Cookies in the left sidebar</li>
                <li>Select your website's domain</li>
                <li>Copy the cookies (right-click → Copy or use a browser extension)</li>
              </ol>
              <p className="font-semibold text-slate-700 mb-1">Supported formats:</p>
              <ul className="list-disc list-inside space-y-1 ml-2 mb-2">
                <li><strong>JSON array</strong> - From browser extensions (EditThisCookie, etc.)</li>
                <li><strong>Netscape format</strong> - Tab-separated values from cookie exporters</li>
                <li><strong>Cookie header</strong> - Simple name=value format</li>
              </ul>
              <p className="mt-2 text-slate-500 text-xs">
                💡 Tip: If domain is missing, it will be extracted from the Target URL above.
              </p>
            </div>
          </div>
        )}
      </div>

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
