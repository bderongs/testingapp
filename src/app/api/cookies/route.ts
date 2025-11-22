// This file exposes an API for managing domain-level cookie configurations used by crawls and regression tests.
import { NextResponse } from 'next/server';
import { z } from 'zod';

import type { Cookie } from '@/types';
import { loadDomainCookies, saveDomainCookies, clearDomainCookies } from '@/storage/cookieStore';

export const runtime = 'nodejs';

const cookieSchema = z.object({
  name: z.string().min(1),
  value: z.string(),
  domain: z.string().min(1),
  path: z.string().optional(),
  expires: z.number().optional(),
  httpOnly: z.boolean().optional(),
  secure: z.boolean().optional(),
  sameSite: z.enum(['Strict', 'Lax', 'None']).optional(),
});

const bodySchema = z.object({
  domain: z.string().min(1),
  cookies: z.array(cookieSchema),
});

const sanitizeDomain = (value: string | null): string | null => {
  if (!value) {
    return null;
  }
  const trimmed = value.trim().toLowerCase();
  const cleaned = trimmed.replace(/[^a-z0-9.-]/g, '');
  return cleaned.length > 0 ? cleaned : null;
};

export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const domain = sanitizeDomain(url.searchParams.get('domain'));

  if (!domain) {
    return NextResponse.json(
      {
        success: false,
        message: 'Domain query parameter is required.',
      },
      { status: 400 }
    );
  }

  const snapshot = await loadDomainCookies(domain);

  return NextResponse.json({
    success: true,
    domain,
    cookies: snapshot.cookies,
    updatedAt: snapshot.updatedAt,
  });
}

export async function POST(request: Request): Promise<NextResponse> {
  const json = await request.json().catch(() => ({}));
  const parse = bodySchema.safeParse(json);

  if (!parse.success) {
    return NextResponse.json(
      {
        success: false,
        message: 'Invalid payload provided.',
        issues: parse.error.issues,
      },
      { status: 400 }
    );
  }

  const { domain, cookies } = parse.data;
  const snapshot = await saveDomainCookies(domain, cookies as Cookie[]);

  return NextResponse.json({
    success: true,
    message: `Saved ${snapshot.cookies.length} cookie(s) for ${domain}.`,
    domain,
    cookies: snapshot.cookies,
    updatedAt: snapshot.updatedAt,
  });
}

export async function DELETE(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const domain = sanitizeDomain(url.searchParams.get('domain'));

  if (!domain) {
    return NextResponse.json(
      {
        success: false,
        message: 'Domain query parameter is required.',
      },
      { status: 400 }
    );
  }

  await clearDomainCookies(domain);
  return NextResponse.json({
    success: true,
    message: `Cleared saved cookies for ${domain}.`,
    domain,
  });
}


