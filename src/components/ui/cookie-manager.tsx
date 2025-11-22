'use client';

// This file renders the domain-scoped cookie management panel shared by the crawler and regression tests.
import { useEffect, useMemo, useState } from 'react';
import { Cookie as CookieIcon, Play, ShieldCheck, UploadCloud, Trash2, AlertCircle, CheckCircle2 } from 'lucide-react';

import type { Cookie } from '@/types';
import { sanitizeCookieList, parseBooleanToken, parseExpiresToken } from '@/lib/cookieTools';
import { cn } from '@/lib/utils';

interface CookieManagerProps {
  readonly domain: string | null;
  readonly cookies: Cookie[];
  readonly updatedAtLabel: string;
}

interface StatusBanner {
  readonly tone: 'info' | 'success' | 'error';
  readonly message: string;
}

const isSameCookie = (a: Cookie, b: Cookie): boolean =>
  a.name === b.name &&
  a.value === b.value &&
  a.domain === b.domain &&
  (a.path ?? '/') === (b.path ?? '/') &&
  (a.sameSite ?? '') === (b.sameSite ?? '');

const normaliseCookies = (input: unknown, fallbackDomain: string | null): Cookie[] => {
  if (!Array.isArray(input)) {
    return [];
  }

  const mapped: Cookie[] = [];

  input.forEach((item) => {
    if (!item || typeof item !== 'object') {
      return;
    }
    const record = item as Record<string, unknown>;
    const name = typeof record.name === 'string' ? record.name.trim() : '';
    const domain =
      typeof record.domain === 'string' && record.domain.trim().length > 0
        ? record.domain.trim()
        : fallbackDomain ?? '';

    if (!name || !domain) {
      return;
    }

    const pathCandidate = typeof record.path === 'string' ? record.path.trim() : '/';
    const cookie: Cookie = {
      name,
      value:
        typeof record.value === 'string'
          ? record.value
          : record.value !== undefined
            ? String(record.value)
            : '',
      domain,
      path: pathCandidate.startsWith('/') ? pathCandidate : '/',
      httpOnly: parseBooleanToken(typeof record.httpOnly === 'string' ? record.httpOnly : undefined) || record.httpOnly === true,
      secure: parseBooleanToken(typeof record.secure === 'string' ? record.secure : undefined) || record.secure === true,
      sameSite:
        record.sameSite === 'Strict' || record.sameSite === 'Lax' || record.sameSite === 'None'
          ? (record.sameSite as Cookie['sameSite'])
          : undefined,
      expires: typeof record.expires === 'number' && Number.isFinite(record.expires)
        ? Math.floor(record.expires)
        : undefined,
    };
    mapped.push(cookie);
  });

  return sanitizeCookieList(mapped);
};

const parseDevtoolsTableCookies = (input: string, defaultDomain: string | null): Cookie[] => {
  const lines = input
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'));

  if (lines.length === 0) {
    return [];
  }

  const ensureDomain = (value: string | null): string => {
    if (value && value.trim().length > 0) {
      return value.trim();
    }
    return defaultDomain ?? '';
  };

  const cookies: Cookie[] = [];

  for (const line of lines) {
    const rawTokens = line.includes('\t') ? line.split('\t') : line.split(/\s{2,}/);
    const tokens = rawTokens.map((token) => token.trim()).filter((token) => token.length > 0);
    if (tokens.length < 2) {
      continue;
    }

    if (tokens[0].toLowerCase() === 'name') {
      continue;
    }

    const looksLikeNetscape = tokens.length >= 7 && ['true', 'false'].includes(tokens[1]?.toLowerCase?.() ?? '');
    if (looksLikeNetscape) {
      const [domainToken, , pathToken, secureToken, expiresToken, nameToken, ...valueTokens] = tokens;
      const valueToken = valueTokens.join('\t');
      const domain = ensureDomain(domainToken);
      const name = nameToken?.trim() ?? '';
      const value = valueToken ?? '';

      if (!domain || !name) {
        continue;
      }

      cookies.push({
        name,
        value,
        domain,
        path: pathToken?.trim().startsWith('/') ? pathToken.trim() : '/',
        secure: parseBooleanToken(secureToken),
        httpOnly: false,
        sameSite: undefined,
        expires: parseExpiresToken(expiresToken),
      });
      continue;
    }

    if (tokens.length >= 5) {
      const offset = /^\d+$/.test(tokens[0]) ? 1 : 0;
      const name = tokens[offset];
      const value = tokens[offset + 1] ?? '';
      const domain = ensureDomain(tokens[offset + 2] ?? defaultDomain);
      const pathToken = tokens[offset + 3] ?? '';
      const expiresToken = tokens[offset + 4];
      const httpOnlyToken = tokens[offset + 6] ?? tokens[offset + 5];
      const secureToken = tokens[offset + 7] ?? tokens[offset + 6];
      const sameSiteToken = tokens[offset + 8] ?? tokens[offset + 7];

      if (!name || !domain || name.toLowerCase() === 'name') {
        continue;
      }

      cookies.push({
        name,
        value,
        domain,
        path: pathToken.startsWith('/') ? pathToken : '/',
        expires: parseExpiresToken(expiresToken),
        httpOnly: parseBooleanToken(httpOnlyToken),
        secure: parseBooleanToken(secureToken),
        sameSite:
          sameSiteToken === 'Strict' || sameSiteToken === 'Lax' || sameSiteToken === 'None'
            ? (sameSiteToken as Cookie['sameSite'])
            : undefined,
      });
      continue;
    }

    if (tokens.length === 1 && tokens[0].includes('=')) {
      const [name, ...valueParts] = tokens[0].split('=');
      const value = valueParts.join('=').trim();
      const domain = ensureDomain(defaultDomain);

      if (name && domain) {
        cookies.push({
          name: name.trim(),
          value,
          domain,
          path: '/',
          secure: name.startsWith('__Secure-') || name.startsWith('__Host-') ? true : false,
          httpOnly: false,
          sameSite: undefined,
        });
      }
    }
  }

  return sanitizeCookieList(cookies);
};

const CookieItem = ({ cookie }: { cookie: Cookie }) => {
  const [showValue, setShowValue] = useState(false);

  return (
    <li className="rounded-lg border border-slate-200 bg-white p-2">
      <div className="flex items-center justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-xs font-semibold text-slate-800" title={cookie.name}>
              {cookie.name}
            </span>
            <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-slate-500">
              {cookie.domain}
            </span>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setShowValue(!showValue)}
          className="ml-2 text-[10px] font-medium text-sparkier-primary hover:text-sparkier-primary/80"
        >
          {showValue ? 'Hide' : 'Show'}
        </button>
      </div>
      {showValue && (
        <p className="mt-1 break-all font-mono text-[10px] text-slate-500">
          {cookie.value}
        </p>
      )}
    </li>
  );
};

export const CookieManager = ({ domain, cookies, updatedAtLabel }: CookieManagerProps) => {
  const [pendingCookies, setPendingCookies] = useState<Cookie[]>([]);
  const [savedCookies, setSavedCookies] = useState<Cookie[]>(cookies);
  const [textInput, setTextInput] = useState('');
  const [status, setStatus] = useState<StatusBanner | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [localUpdatedLabel, setLocalUpdatedLabel] = useState(updatedAtLabel);

  useEffect(() => {
    setSavedCookies(cookies);
  }, [cookies]);

  useEffect(() => {
    setLocalUpdatedLabel(updatedAtLabel);
  }, [updatedAtLabel]);

  useEffect(() => {
    setPendingCookies([]);
    setTextInput('');
    setStatus(null);
  }, [domain]);

  const domainReady = Boolean(domain);

  const savedCount = savedCookies.length;

  const hasPendingChanges = useMemo(() => {
    if (pendingCookies.length === 0) {
      return false;
    }

    if (pendingCookies.length !== savedCookies.length) {
      return true;
    }

    return pendingCookies.some(
      (cookie) => !savedCookies.some((existing) => isSameCookie(cookie, existing))
    );
  }, [pendingCookies, savedCookies]);

  const parseInput = (value: string) => {
    if (!value.trim()) {
      setPendingCookies([]);
      setStatus(null);
      return;
    }

    const fallbackDomain = domain ?? null;

    try {
      const parsed = JSON.parse(value);
      const normalised = normaliseCookies(parsed, fallbackDomain);
      if (normalised.length > 0) {
        setPendingCookies(normalised);
        setStatus({
          tone: 'info',
          message: `Detected ${normalised.length} cookie${normalised.length === 1 ? '' : 's'} ready to save.`,
        });
        return;
      }
    } catch {
      // Ignore and fall through to DevTools parsing.
    }

    const devtoolsCookies = parseDevtoolsTableCookies(value, fallbackDomain);
    if (devtoolsCookies.length > 0) {
      setPendingCookies(devtoolsCookies);
      setStatus({
        tone: 'info',
        message: `Detected ${devtoolsCookies.length} cookie${devtoolsCookies.length === 1 ? '' : 's'} ready to save.`,
      });
    } else {
      setPendingCookies([]);
      setStatus({
        tone: 'error',
        message: 'Failed to parse cookies. Provide JSON export, DevTools table output, Netscape format, or cookie header.',
      });
    }
  };

  const handleSave = async () => {
    if (!domainReady || pendingCookies.length === 0) {
      return;
    }
    setIsSaving(true);
    try {
      const response = await fetch('/api/cookies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain, cookies: pendingCookies }),
      });
      const payload = (await response.json()) as {
        success: boolean;
        message?: string;
        cookies?: Cookie[];
        updatedAt?: string;
      };
      if (!payload.success) {
        setStatus({
          tone: 'error',
          message: payload.message ?? 'Failed to save cookies.',
        });
        return;
      }
      setSavedCookies(payload.cookies ?? []);
      setPendingCookies([]);
      setTextInput('');
      const updatedLabel =
        payload.updatedAt ? `Updated ${new Date(payload.updatedAt).toLocaleString()}` : 'No cookies saved';
      setLocalUpdatedLabel(updatedLabel);
      setStatus({
        tone: 'success',
        message: payload.message ?? 'Cookies saved successfully.',
      });
      if (typeof window !== 'undefined' && domain) {
        window.dispatchEvent(
          new CustomEvent('sparkier:cookies-updated', {
            detail: {
              domain,
              cookies: payload.cookies ?? [],
              updatedAtLabel: updatedLabel,
            },
          })
        );
      }
    } catch (error) {
      setStatus({
        tone: 'error',
        message: `Failed to save cookies: ${(error as Error).message}`,
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleClear = async () => {
    if (!domainReady) {
      return;
    }
    setIsSaving(true);
    try {
      const response = await fetch(`/api/cookies?domain=${encodeURIComponent(domain!)}`, {
        method: 'DELETE',
      });
      const payload = (await response.json()) as { success: boolean; message?: string };
      if (!payload.success) {
        setStatus({
          tone: 'error',
          message: payload.message ?? 'Failed to clear cookies.',
        });
        return;
      }
      setSavedCookies([]);
      setPendingCookies([]);
      setTextInput('');
      setLocalUpdatedLabel('No cookies saved');
      setStatus({
        tone: 'info',
        message: payload.message ?? 'Saved cookies removed.',
      });
      if (typeof window !== 'undefined' && domain) {
        window.dispatchEvent(
          new CustomEvent('sparkier:cookies-updated', {
            detail: {
              domain,
              cookies: [],
              updatedAtLabel: 'No cookies saved',
            },
          })
        );
      }
    } catch (error) {
      setStatus({
        tone: 'error',
        message: `Failed to clear cookies: ${(error as Error).message}`,
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[3fr,2fr]">
      <div className="space-y-4">
        <label className="flex flex-col text-xs font-medium uppercase tracking-wide text-slate-500">
          Cookie JSON
          <textarea
            className={cn(
              'mt-2 min-h-[8rem] w-full rounded-lg border bg-slate-50 px-3 py-2 font-mono text-xs text-slate-700 shadow-sm focus:border-sparkier-primary focus:bg-white focus:outline-none focus:ring-2 focus:ring-sparkier-primary/30',
              !domainReady && 'cursor-not-allowed opacity-60'
            )}
            placeholder='Paste a JSON array of cookies (e.g., [{"name":"session","value":"...","domain":"example.com"}])'
            value={textInput}
            onChange={(event) => {
              setTextInput(event.target.value);
              parseInput(event.target.value);
            }}
            disabled={!domainReady || isSaving}
          />
        </label>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={handleSave}
            disabled={!domainReady || pendingCookies.length === 0 || isSaving}
            className={cn(
              'inline-flex items-center gap-2 rounded-full bg-sparkier-primary px-4 py-2 text-xs font-medium text-white transition hover:bg-sparkier-primary/90',
              (!domainReady || pendingCookies.length === 0 || isSaving) && 'cursor-not-allowed opacity-60'
            )}
          >
            <UploadCloud className="h-3 w-3" aria-hidden />
            Save cookies
          </button>
          <button
            type="button"
            onClick={handleClear}
            disabled={!domainReady || savedCount === 0 || isSaving}
            className={cn(
              'inline-flex items-center gap-2 rounded-full border border-slate-300 px-4 py-2 text-xs font-medium text-slate-700 transition hover:border-rose-300 hover:text-rose-600',
              (!domainReady || savedCount === 0 || isSaving) && 'cursor-not-allowed opacity-60'
            )}
          >
            <Trash2 className="h-3 w-3" aria-hidden />
            Clear saved
          </button>
          {hasPendingChanges ? (
            <span className="text-xs font-medium uppercase tracking-wide text-amber-600">
              Unsaved changes
            </span>
          ) : null}
        </div>

        {status ? (
          <div
            className={cn(
              'flex items-center gap-2 rounded-lg border px-3 py-2 text-xs',
              status.tone === 'info' && 'border-slate-200 bg-slate-50 text-slate-600',
              status.tone === 'success' && 'border-emerald-200 bg-emerald-50 text-emerald-700',
              status.tone === 'error' && 'border-rose-200 bg-rose-50 text-rose-700'
            )}
          >
            {status.tone === 'success' ? (
              <CheckCircle2 className="h-4 w-4" aria-hidden />
            ) : status.tone === 'error' ? (
              <AlertCircle className="h-4 w-4" aria-hidden />
            ) : (
              <AlertCircle className="h-4 w-4 text-slate-500" aria-hidden />
            )}
            <span>{status.message}</span>
          </div>
        ) : null}
      </div>

      <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-slate-700">
            Saved cookies ({savedCount})
          </span>
        </div>
        {savedCount === 0 ? (
          <p className="rounded-lg border border-dashed border-slate-300 bg-white p-3 text-xs text-slate-500">
            No cookies saved yet.
          </p>
        ) : (
          <ul className="space-y-2 max-h-[200px] overflow-y-auto pr-1">
            {savedCookies.map((cookie) => (
              <CookieItem key={`${cookie.name}-${cookie.domain}`} cookie={cookie} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};
