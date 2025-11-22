// This file provides helper utilities to persist and retrieve per-domain cookie configurations used by crawls and tests.
import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';

import type { Cookie } from '@/types';
import { sanitizeCookieList } from '@/lib/cookieTools';

interface StoredCookiePayload {
  readonly cookies: Cookie[];
  readonly updatedAt: string;
}

const OUTPUT_DIR = join(process.cwd(), 'output');
const DOMAINS_DIR = join(OUTPUT_DIR, 'domains');

const normalizeDomain = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9.-]/g, '')
    .replace(/^\.+|\.+$/g, '');

const getCookieFilePath = (domain: string): string => {
  const safeDomain = normalizeDomain(domain);
  return join(DOMAINS_DIR, safeDomain, 'cookies.json');
};

export interface DomainCookieSnapshot {
  readonly cookies: Cookie[];
  readonly updatedAt: string | null;
}

export const loadDomainCookies = async (domain: string): Promise<DomainCookieSnapshot> => {
  const filePath = getCookieFilePath(domain);

  try {
    const raw = await readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw) as StoredCookiePayload;
    const cookies = Array.isArray(parsed.cookies) ? sanitizeCookieList(parsed.cookies) : [];
    return {
      cookies,
      updatedAt: cookies.length > 0 ? parsed.updatedAt ?? null : null,
    };
  } catch {
    return { cookies: [], updatedAt: null };
  }
};

export const saveDomainCookies = async (domain: string, cookies: Cookie[]): Promise<DomainCookieSnapshot> => {
  const filePath = getCookieFilePath(domain);
  const directory = filePath.slice(0, filePath.lastIndexOf('/'));

  await mkdir(directory, { recursive: true });

  const sanitised = sanitizeCookieList(cookies);
  const payload: StoredCookiePayload = {
    cookies: sanitised,
    updatedAt: new Date().toISOString(),
  };

  await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');

  return {
    cookies: payload.cookies,
    updatedAt: payload.updatedAt,
  };
};

export const clearDomainCookies = async (domain: string): Promise<void> => {
  const filePath = getCookieFilePath(domain);

  try {
    await unlink(filePath);
  } catch {
    // Ignore missing file deletions.
  }
};

