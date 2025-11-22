// This file centralises cookie sanitisation and parsing helpers shared between server and client modules.
import type { Cookie } from '@/types';

const DOMAIN_PATTERN = /^[a-z0-9.-]+$/;
const SAME_SITE_VALUES = new Set<Cookie['sameSite']>(['Strict', 'Lax', 'None']);

const toStringOrEmpty = (value: unknown): string => {
  if (value === null || value === undefined) {
    return '';
  }
  return String(value);
};

export const parseBooleanToken = (token?: string | null): boolean => {
  if (!token) {
    return false;
  }
  const normalised = token.trim().toLowerCase();
  return normalised === 'true' ||
    normalised === '1' ||
    normalised === 'yes' ||
    normalised === 'y' ||
    normalised === '✓' ||
    normalised === 'check' ||
    normalised === 'checked';
};

export const parseExpiresToken = (token?: string | null): number | undefined => {
  if (!token) {
    return undefined;
  }
  const trimmed = token.trim();
  if (!trimmed || trimmed.toLowerCase() === 'session') {
    return undefined;
  }

  const asNumber = Number(trimmed);
  if (!Number.isNaN(asNumber)) {
    const seconds = asNumber > 1_000_000_000_000 ? Math.floor(asNumber / 1000) : Math.floor(asNumber);
    return seconds > 0 ? seconds : undefined;
  }

  const asDate = new Date(trimmed);
  if (!Number.isNaN(asDate.getTime())) {
    const seconds = Math.floor(asDate.getTime() / 1000);
    return seconds > 0 ? seconds : undefined;
  }

  return undefined;
};

const sanitiseSameSite = (value?: Cookie['sameSite']): Cookie['sameSite'] => {
  if (!value) {
    return undefined;
  }
  const normalised = value.charAt(0).toUpperCase() + value.slice(1).toLowerCase() as Cookie['sameSite'];
  return SAME_SITE_VALUES.has(normalised) ? normalised : undefined;
};

const normaliseDomain = (domain: string): string | null => {
  const trimmed = domain.trim().toLowerCase();
  if (!trimmed || trimmed.includes('://')) {
    return null;
  }
  if (!DOMAIN_PATTERN.test(trimmed)) {
    return null;
  }
  return trimmed;
};

const normaliseCookie = (raw: Cookie): Cookie | null => {
  const name = toStringOrEmpty(raw.name).trim();
  if (!name) {
    return null;
  }

  const value = toStringOrEmpty(raw.value);

  const domainCandidate = toStringOrEmpty(raw.domain);
  const domain = normaliseDomain(domainCandidate);
  if (!domain) {
    return null;
  }

  const initialPath = toStringOrEmpty(raw.path);
  const path = initialPath.startsWith('/') ? initialPath : '/';

  const sameSite = sanitiseSameSite(raw.sameSite);
  const expires = typeof raw.expires === 'number' && Number.isFinite(raw.expires) ? Math.floor(raw.expires) : undefined;

  const isSecurePrefix = name.startsWith('__Secure-') || name.startsWith('__Host-');
  const secure = isSecurePrefix ? true : Boolean(raw.secure);
  const enforcedPath = name.startsWith('__Host-') ? '/' : path;

  return {
    name,
    value,
    domain,
    path: enforcedPath,
    sameSite,
    secure,
    httpOnly: Boolean(raw.httpOnly),
    expires,
  };
};

export const sanitizeCookieList = (cookies: readonly Cookie[]): Cookie[] => {
  const sanitised = cookies
    .map(normaliseCookie)
    .filter((cookie): cookie is Cookie => Boolean(cookie));

  if (sanitised.length === 0) {
    return [];
  }

  const deduped = new Map<string, Cookie>();
  sanitised.forEach((cookie) => {
    const key = `${cookie.name}|${cookie.domain}|${cookie.path}`;
    deduped.set(key, cookie);
  });

  return Array.from(deduped.values());
};


