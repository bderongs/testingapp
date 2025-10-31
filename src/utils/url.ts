// This file contains helpers for working with URLs while enforcing same-origin and normalization rules.

import { URL } from 'node:url';

const HTTP_PROTOCOLS = new Set(['http:', 'https:']);

export const normalizeUrl = (input: string): string => {
  const parsed = new URL(input);
  parsed.hash = '';
  if (parsed.pathname.endsWith('/')) {
    parsed.pathname = parsed.pathname.replace(/\/+$/, '/');
  }
  return parsed.toString();
};

export const isHttpProtocol = (input: string): boolean => {
  try {
    const parsed = new URL(input, 'http://placeholder');
    return HTTP_PROTOCOLS.has(parsed.protocol);
  } catch {
    return false;
  }
};

export const isSameOrigin = (origin: string, candidate: string): boolean => {
  try {
    const base = new URL(origin);
    const comparison = new URL(candidate, base);
    return base.origin === comparison.origin;
  } catch {
    return false;
  }
};

export const safeResolve = (base: string, href: string): string | null => {
  try {
    const resolved = new URL(href, base);
    if (!isHttpProtocol(resolved.protocol)) {
      return null;
    }
    return normalizeUrl(resolved.toString());
  } catch {
    return null;
  }
};
