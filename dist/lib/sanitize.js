// This file contains helpers for normalising strings into safe filesystem-friendly slugs.
export const sanitizeFileSlug = (value, fallback) => {
    const base = (value && value.trim().length > 0 ? value : fallback)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-');
    const trimmed = base.replace(/^-+|-+$/g, '');
    return trimmed.length > 0 ? trimmed : fallback.toLowerCase();
};
