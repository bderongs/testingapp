'use client';

import { useState } from 'react';
import { X, Loader2, Wand2, CheckCircle2 } from 'lucide-react';
import type { UserStory, PageSummary } from '@/types';
import { cn } from '@/lib/utils';

interface CreateStoryModalProps {
    crawlId: string;
    domain: string;
    availablePages: PageSummary[];
    isOpen: boolean;
    onClose: () => void;
    onStoryCreated: (story: UserStory) => void;
}

export const CreateStoryModal = ({
    crawlId,
    domain,
    availablePages,
    isOpen,
    onClose,
    onStoryCreated,
}: CreateStoryModalProps) => {
    const [selectedPageUrl, setSelectedPageUrl] = useState<string>(availablePages[0]?.url || '');
    const [userIntent, setUserIntent] = useState('');
    const [storyTitle, setStoryTitle] = useState('');
    const [isGenerating, setIsGenerating] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState(false);

    const selectedPage = availablePages.find((p) => p.url === selectedPageUrl);

    const handleSubmit = async () => {
        if (!userIntent.trim() || !selectedPageUrl) {
            setError('Please provide your intent and select a page.');
            return;
        }

        setIsGenerating(true);
        setError(null);
        setSuccess(false);

        try {
            const response = await fetch('/api/story/create', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    crawlId,
                    domain,
                    pageUrl: selectedPageUrl,
                    userIntent: userIntent.trim(),
                    storyTitle: storyTitle.trim() || undefined,
                }),
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.message || 'Failed to create story');
            }

            setSuccess(true);
            onStoryCreated(data.story);

            // Reset form after short delay
            setTimeout(() => {
                setUserIntent('');
                setStoryTitle('');
                setSuccess(false);
                onClose();
            }, 1500);
        } catch (err) {
            setError((err as Error).message);
        } finally {
            setIsGenerating(false);
        }
    };

    const handleClose = () => {
        if (!isGenerating) {
            setUserIntent('');
            setStoryTitle('');
            setError(null);
            setSuccess(false);
            onClose();
        }
    };

    if (!isOpen) return null;

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
            onClick={handleClose}
        >
            <div
                className="relative w-full max-w-2xl rounded-2xl border border-slate-200 bg-white shadow-xl max-h-[90vh] flex flex-col"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
                    <div className="flex items-center gap-2">
                        <Wand2 className="h-5 w-5 text-sparkier-primary" aria-hidden />
                        <div>
                            <h2 className="text-lg font-semibold text-slate-900">Create Custom Story</h2>
                            <p className="text-xs text-slate-600">Describe what you want to test</p>
                        </div>
                    </div>
                    <button
                        onClick={handleClose}
                        disabled={isGenerating}
                        className="rounded-lg p-1 text-slate-400 transition hover:bg-slate-200 hover:text-slate-600 disabled:opacity-50"
                    >
                        <X className="h-5 w-5" aria-hidden />
                    </button>
                </div>

                {/* Body */}
                <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
                    {/* Page Selector */}
                    <div className="space-y-2">
                        <label htmlFor="page-select" className="block text-sm font-medium text-slate-700">
                            Select Page
                        </label>
                        <select
                            id="page-select"
                            value={selectedPageUrl}
                            onChange={(e) => setSelectedPageUrl(e.target.value)}
                            disabled={isGenerating}
                            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-sparkier-primary focus:outline-none focus:ring-2 focus:ring-sparkier-primary/20 disabled:opacity-50"
                        >
                            {availablePages.map((page) => (
                                <option key={page.url} value={page.url}>
                                    {page.title || page.url}
                                </option>
                            ))}
                        </select>
                        {selectedPage && (
                            <p className="text-xs text-slate-500 font-mono break-all">{selectedPage.url}</p>
                        )}
                    </div>

                    {/* Story Title (Optional) */}
                    <div className="space-y-2">
                        <label htmlFor="story-title" className="block text-sm font-medium text-slate-700">
                            Story Title <span className="text-slate-400">(optional)</span>
                        </label>
                        <input
                            id="story-title"
                            type="text"
                            value={storyTitle}
                            onChange={(e) => setStoryTitle(e.target.value)}
                            disabled={isGenerating}
                            placeholder="e.g., Dashboard Navigation Test"
                            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-sparkier-primary focus:outline-none focus:ring-2 focus:ring-sparkier-primary/20 disabled:opacity-50"
                        />
                    </div>

                    {/* User Intent */}
                    <div className="space-y-2">
                        <label htmlFor="user-intent" className="block text-sm font-medium text-slate-700">
                            What do you want to test?
                        </label>
                        <textarea
                            id="user-intent"
                            value={userIntent}
                            onChange={(e) => setUserIntent(e.target.value)}
                            disabled={isGenerating}
                            placeholder="e.g., Click the 'Tableau de bord' button and verify that the dashboard page loads with my profile information"
                            rows={4}
                            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-sparkier-primary focus:outline-none focus:ring-2 focus:ring-sparkier-primary/20 disabled:opacity-50 resize-none"
                        />
                        <p className="text-xs text-slate-500">
                            Describe the user action and expected outcome. Be specific about buttons, forms, or elements to interact with.
                        </p>
                    </div>

                    {/* Detected CTAs (Helper) */}
                    {selectedPage && selectedPage.primaryCtas.length > 0 && (
                        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">
                                Detected CTAs on this page
                            </p>
                            <div className="flex flex-wrap gap-2">
                                {selectedPage.primaryCtas.slice(0, 5).map((cta, idx) => (
                                    <button
                                        key={idx}
                                        onClick={() => setUserIntent(`Click the "${cta.label}" button and verify `)}
                                        disabled={isGenerating}
                                        className="inline-flex items-center gap-1 rounded-full bg-white border border-slate-200 px-3 py-1 text-xs text-slate-700 transition hover:border-sparkier-primary hover:text-sparkier-primary disabled:opacity-50"
                                    >
                                        {cta.label}
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Error */}
                    {error && (
                        <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
                            <p className="font-semibold">Error</p>
                            <p>{error}</p>
                        </div>
                    )}

                    {/* Success */}
                    {success && (
                        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700 flex items-center gap-2">
                            <CheckCircle2 className="h-4 w-4" />
                            <p className="font-semibold">Story created successfully!</p>
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="flex items-center justify-end gap-3 border-t border-slate-200 bg-slate-50 px-6 py-4">
                    <button
                        onClick={handleClose}
                        disabled={isGenerating}
                        className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100 disabled:opacity-50"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleSubmit}
                        disabled={isGenerating || !userIntent.trim() || !selectedPageUrl}
                        className={cn(
                            'inline-flex items-center gap-2 rounded-lg bg-sparkier-primary px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-sparkier-secondary',
                            (isGenerating || !userIntent.trim() || !selectedPageUrl) && 'cursor-not-allowed opacity-60'
                        )}
                    >
                        {isGenerating ? (
                            <>
                                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                                Generating...
                            </>
                        ) : (
                            <>
                                <Wand2 className="h-4 w-4" aria-hidden />
                                Create Story
                            </>
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
};
