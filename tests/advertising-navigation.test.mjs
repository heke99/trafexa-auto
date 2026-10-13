import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createSourceLoader } from './helpers/source-loader.mjs';

test('actual workspace page preserves advertising destination when fresh Auth is absent', async () => {
  const loader = await createSourceLoader({
    'next/navigation': { notFound() { throw new Error('Unexpected missing route'); }, redirect(location) { throw Object.assign(new Error('redirect'), { location }); } },
    '@/lib/data/workspace': { getWorkspaceSnapshot: async () => null },
    '@/components/dealer-workspace': {},
    '@/lib/platform-admin/context': { getPlatformAdminContext() { throw new Error('No admin lookup without Auth'); } },
  });
  await assert.rejects(loader.load('src/app/(dealer)/[section]/page.tsx').default({ params: Promise.resolve({ section: 'advertising' }), searchParams: Promise.resolve({}) }), error => error.location === '/login?next=%2Fadvertising');
});

test('actual proxy retains workspace destination without copying untrusted company query', async () => {
  const previousUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const previousKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://fixture.supabase.invalid';
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'fixture-public-key';
  function nextUrl(value) { const url = new URL(value); url.clone = () => nextUrl(url); return url; }
  function response(destination) { return { location: destination ? String(destination) : null, headers: new Headers(), cookies: { getAll: () => [], set() {} } }; }
  try {
    const loader = await createSourceLoader({
      '@supabase/ssr': { createServerClient: () => ({ auth: { getClaims: async () => ({ data: { claims: null } }) } }) },
      'next/server': { NextResponse: { next: () => response(), redirect: destination => response(destination) } },
    });
    const result = await loader.load('src/proxy.ts').proxy({ nextUrl: nextUrl('https://app.trafexa.com/advertising?company=untrusted'), method: 'GET', cookies: { getAll: () => [], set() {} } });
    const login = new URL(result.location);
    assert.equal(login.pathname, '/login');
    assert.equal(login.searchParams.get('next'), '/advertising');
    assert.equal(login.searchParams.has('company'), false);
    assert.equal(result.headers.get('Cache-Control'), 'private, no-store');
  } finally {
    if (previousUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL; else process.env.NEXT_PUBLIC_SUPABASE_URL = previousUrl;
    if (previousKey === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY; else process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = previousKey;
  }
});
