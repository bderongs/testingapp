'use client';

import { useState, useEffect } from 'react';
import { Wand2 } from 'lucide-react';
import type { UserStory, PageSummary } from '@/types';
import { StoryCard } from '@/components/ui/story-card';
import { CreateStoryModal } from '@/components/ui/create-story-modal';

interface StoryListProps {
    initialStories: Array<UserStory & { specSlug: string; specHref: string }>;
    crawlId?: string;
    domain: string | null;
    savedCookieCount: number;
    availablePages: PageSummary[];
}

export const StoryList = ({
    initialStories,
    crawlId,
    domain,
    savedCookieCount,
    availablePages,
}: StoryListProps) => {
    const [stories, setStories] = useState(initialStories);
    const [isModalOpen, setIsModalOpen] = useState(false);

    // Load custom stories on mount
    useEffect(() => {
        if (!crawlId || !domain) return;

        const loadCustomStories = async () => {
            try {
                const response = await fetch(`/api/story/list?crawlId=${crawlId}&domain=${domain}`);
                if (response.ok) {
                    const data = await response.json();
                    if (data.customStories && data.customStories.length > 0) {
                        // Merge custom stories with auto-generated ones
                        const customWithMeta = data.customStories.map((story: UserStory) => ({
                            ...story,
                            specSlug: story.suggestedScriptName,
                            specHref: `/specs/${story.suggestedScriptName}.spec.ts`,
                        }));

                        // Deduplicate by story ID
                        setStories((prev) => {
                            const existingIds = new Set(prev.map(s => s.id));
                            const newStories = customWithMeta.filter((s: UserStory) => !existingIds.has(s.id));
                            return [...prev, ...newStories];
                        });
                    }
                }
            } catch (error) {
                console.error('Failed to load custom stories:', error);
            }
        };

        loadCustomStories();
    }, [crawlId, domain]);

    const handleStoryCreated = (newStory: UserStory) => {
        const storyWithMeta = {
            ...newStory,
            specSlug: newStory.suggestedScriptName,
            specHref: `/specs/${newStory.suggestedScriptName}.spec.ts`,
        };
        setStories((prev) => [...prev, storyWithMeta]);
    };

    return (
        <>
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between mb-6">
                <div>
                    <h2 className="text-lg font-semibold text-slate-900">Your user stories</h2>
                    <p className="text-sm text-slate-600">
                        Each card mixes crawl intelligence, Playwright scaffolding, and live test controls.
                    </p>
                </div>
                {crawlId && domain && availablePages.length > 0 && (
                    <button
                        onClick={() => setIsModalOpen(true)}
                        className="inline-flex items-center gap-2 rounded-full bg-sparkier-primary px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-sparkier-secondary"
                    >
                        <Wand2 className="h-4 w-4" aria-hidden />
                        Create Custom Story
                    </button>
                )}
            </div>

            {stories.length === 0 ? (
                <div className="rounded-3xl border border-dashed border-slate-300 bg-white p-10 text-center text-slate-500">
                    Run a crawl to populate stories automatically. Sparkier highlights the most valuable flows first.
                </div>
            ) : (
                <div className="grid gap-6">
                    {stories.map((story) => (
                        <StoryCard
                            key={story.id}
                            story={story}
                            crawlId={crawlId}
                            domain={domain}
                            savedCookieCount={savedCookieCount}
                        />
                    ))}
                </div>
            )}

            {crawlId && domain && (
                <CreateStoryModal
                    crawlId={crawlId}
                    domain={domain}
                    availablePages={availablePages}
                    isOpen={isModalOpen}
                    onClose={() => setIsModalOpen(false)}
                    onStoryCreated={handleStoryCreated}
                />
            )}
        </>
    );
};
