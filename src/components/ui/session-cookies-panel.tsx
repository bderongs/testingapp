'use client';

import { useState } from 'react';
import { ChevronDown, ChevronUp, Cookie as CookieIcon } from 'lucide-react';
import { CookieManager } from './cookie-manager';
import type { Cookie } from '@/types';

interface SessionCookiesPanelProps {
    domain: string | null;
    cookieSnapshot: {
        cookies: Cookie[];
        updatedAtLabel: string;
    };
}

export function SessionCookiesPanel({ domain, cookieSnapshot }: SessionCookiesPanelProps) {
    const [isExpanded, setIsExpanded] = useState(false);

    return (
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
            <button
                type="button"
                onClick={() => setIsExpanded(!isExpanded)}
                className="flex w-full items-center justify-between p-4 text-left hover:bg-slate-50/50 transition-colors rounded-2xl"
            >
                <div className="flex items-center gap-3">
                    <CookieIcon className="h-4 w-4 text-sparkier-primary" aria-hidden />
                    <div>
                        <h3 className="text-sm font-semibold text-slate-900">Session cookies</h3>
                        <p className="text-[11px] text-slate-500">
                            {cookieSnapshot.cookies.length > 0
                                ? `${cookieSnapshot.cookies.length} saved`
                                : 'Optional'}
                        </p>
                    </div>
                </div>
                {isExpanded ? (
                    <ChevronUp className="h-4 w-4 text-slate-400" aria-hidden />
                ) : (
                    <ChevronDown className="h-4 w-4 text-slate-400" aria-hidden />
                )}
            </button>

            {isExpanded && (
                <div className="px-4 pb-4 space-y-3 border-t border-slate-100">
                    <div className="pt-3">
                        <p className="text-xs text-slate-500">
                            Paste cookies from DevTools, headers, or Netscape format. They will be merged with saved cookies.
                        </p>
                        {cookieSnapshot.updatedAtLabel && (
                            <p className="mt-1 text-[10px] text-slate-400">{cookieSnapshot.updatedAtLabel}</p>
                        )}
                    </div>

                    <CookieManager
                        domain={domain || ''}
                        cookies={cookieSnapshot.cookies}
                        updatedAtLabel={cookieSnapshot.updatedAtLabel}
                    />
                </div>
            )}
        </div>
    );
}
