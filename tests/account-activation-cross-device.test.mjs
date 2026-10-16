import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createSourceLoader } from './helpers/source-loader.mjs';

const require = createRequire(import.meta.url);
const { chromium, expect } = require('@playwright/test');
const Chromium = require('@sparticuz/chromium').default;
const requests = new AsyncLocalStorage();
const accounts = new Map();
let browser, server, origin, modules, styles;
const events = [];

function cookieStore() { return requests.getStore(); }
function redirect(url) { const error = new Error('Framework redirect'); error.location = url; throw error; }
function fixture(label, expired = false) {
  const token = createHash('sha224').update(`synthetic-${label}@example.invalid12345678`).digest('hex');
  const account = { id: `synthetic-${label}`, token, used: false, expired, password: null };
  accounts.set(token, account);
  return account;
}

// Only Next's HTTP/RSC transport and Supabase network contract are adapted.
// The GET handler, server-rendered page/form, POST action and validation are actual source.
function nativeFormTransport(element) {
  if (!React.isValidElement(element)) return element;
  const children = React.Children.map(element.props.children, nativeFormTransport);
  return React.cloneElement(element, element.type === 'form' ? { action: '/activate-account', method: 'post' } : {}, children);
}

before(async () => {
  styles = await readFile(new URL('../src/app/globals.css', import.meta.url), 'utf8');
  modules = await createSourceLoader({
    'next/headers': { cookies: async () => cookieStore() },
    'next/navigation': { redirect },
    'next/link': ({ children, ...props }) => React.createElement('a', props, children),
    '@/lib/auth/app-origin': { getAuthAppOrigin: () => origin },
    'next/server': { NextResponse: { redirect: url => ({ url: String(url), headers: new Headers(), cookies: cookieStore() }) } },
    '@/lib/account-access/context': { requireApprovedAccountAccess: async () => {
      const id = cookieStore().get('synthetic-auth-session')?.value;
      const account = [...accounts.values()].find(item => item.id === id);
      assert.ok(account?.used, 'Approval lookup must use the recipient session created on this phone');
      return { userId: id, emailVerified: true, status: 'approved' };
    } },
    '@/lib/supabase/server': { createServerSupabaseClient: async () => ({ auth: {
      verifyOtp: async input => {
        events.push(['verify', input.type]);
        assert.equal(input.type, 'invite');
        assert.equal(cookieStore().get('synthetic-admin-session'), undefined);
        assert.equal(cookieStore().get('synthetic-pkce-verifier'), undefined);
        const account = accounts.get(input.token_hash);
        if (!account || account.used || account.expired) return { error: { message: 'Synthetic expired or used token' }, data: { user: null } };
        account.used = true;
        cookieStore().set('synthetic-auth-session', account.id, { path: '/', httpOnly: true, sameSite: 'lax' });
        return { error: null, data: { user: { id: account.id, email_confirmed_at: '2026-10-16T00:00:00Z' } } };
      },
      updateUser: async input => {
        const id = cookieStore().get('synthetic-auth-session')?.value;
        const account = [...accounts.values()].find(item => item.id === id);
        assert.ok(account?.used);
        events.push(['password', account.id]); account.password = input.password;
        return { error: null, data: { user: { id } } };
      },
      signOut: async input => {
        assert.equal(input.scope, 'global');
        cookieStore().delete('synthetic-auth-session'); return { error: null };
      },
    } }) },
  });
  server = createServer(async (request, response) => {
    const values = new Map((request.headers.cookie || '').split(';').filter(Boolean).map(part => { const offset = part.indexOf('='); return [part.slice(0, offset).trim(), decodeURIComponent(part.slice(offset + 1))]; }));
    const outgoing = [];
    const store = {
      get: name => values.has(name) ? { value: values.get(name) } : undefined,
      set(name, value, options = {}) {
        values.set(name, value);
        outgoing.push(`${name}=${encodeURIComponent(value)}; Path=${options.path || '/'}${options.httpOnly ? '; HttpOnly' : ''}; SameSite=Lax${options.maxAge === undefined ? '' : `; Max-Age=${options.maxAge}`}`);
      },
      delete(name) { values.delete(name); outgoing.push(`${name}=; Path=/; Max-Age=0`); },
    };
    await requests.run(store, async () => {
      try {
        const url = new URL(request.url, origin);
        if (url.pathname === '/auth/invitation') {
          const result = await modules.load('src/app/auth/invitation/route.ts').GET({ nextUrl: url });
          response.writeHead(307, { ...Object.fromEntries(result.headers), Location: result.url, 'Set-Cookie': outgoing }); response.end(); return;
        }
        if (url.pathname === '/activate-account' && request.method === 'POST') {
          let body = ''; for await (const chunk of request) body += chunk;
          const form = new FormData(); for (const [key, value] of new URLSearchParams(body)) form.append(key, value);
          await modules.load('@/lib/auth/activate-account-actions').activateAccountAction(form);
          assert.fail('Action must redirect');
        }
        if (url.pathname === '/activate-account') {
          const page = await modules.load('src/app/activate-account/page.tsx').default({ searchParams: Promise.resolve(Object.fromEntries(url.searchParams)) });
          const html = `<!doctype html><html lang="sv"><style>${styles}</style>${renderToStaticMarkup(nativeFormTransport(page))}</html>`;
          response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Set-Cookie': outgoing });
          response.end(html); return;
        }
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        response.end(`<main><h1>Logga in</h1><p role="${url.searchParams.has('error') ? 'alert' : 'status'}">${(url.searchParams.get('error') || url.searchParams.get('success') || '').replace(/[<&]/g, '')}</p></main>`);
      } catch (error) {
        if (error.location) { response.writeHead(303, { Location: new URL(error.location, origin).href, 'Set-Cookie': outgoing }); response.end(); }
        else { response.writeHead(500); response.end('Synthetic bridge failure'); console.error(error); }
      }
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ executablePath: await Chromium.executablePath(), args: Chromium.args.filter(argument => argument !== '--single-process'), headless: true });
});

after(async () => { await browser?.close(); await new Promise(resolve => server?.close(resolve)); });

async function cleanContext(options) {
  const context = await browser.newContext(options);
  context.setDefaultTimeout(5000); context.setDefaultNavigationTimeout(5000);
  await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  return context;
}

async function submit(page, password = 'new-phone-password-1234') {
  await page.getByLabel('Välj lösenord', { exact: true }).fill(password);
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Aktivera konto', exact: true }).click();
}

test('scanner GET never consumes invitation; a clean phone opens email link and sets password without admin cookies or PKCE', async () => {
  const account = fixture('phone');
  const link = `${origin}/auth/invitation?token_hash=${account.token}`;
  const scanner = await cleanContext();
  const phone = await cleanContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  try {
    const scan = await scanner.newPage(); await scan.goto(link, { waitUntil: 'domcontentloaded' });
    await expect(scan.getByLabel('Välj lösenord', { exact: true })).toBeVisible();
    assert.equal(account.used, false); assert.equal(events.length, 0);
    assert.deepEqual(await phone.cookies(), []);
    const page = await phone.newPage(); await page.goto(link, { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(`${origin}/activate-account`);
    assert.equal(await page.evaluate(() => document.cookie.includes('trafexa-account-invitation')), false);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await submit(page);
    await expect(page).toHaveURL(/\/login\?success=/);
    await expect(page.getByRole('status')).toContainText('Kontot är aktiverat');
    assert.equal(account.password, 'new-phone-password-1234');
    const remaining = await phone.cookies();
    assert.equal(remaining.some(cookie => ['trafexa-account-invitation', 'synthetic-auth-session'].includes(cookie.name)), false);
  } finally { await scanner.close(); await phone.close(); }
});

test('opening a consumed email link on another clean phone cannot change the activated password', async () => {
  const account = fixture('replay'); account.used = true; account.password = 'existing-password';
  const phone = await cleanContext({ viewport: { width: 390, height: 844 }, isMobile: true });
  try {
    const page = await phone.newPage(); await page.goto(`${origin}/auth/invitation?token_hash=${account.token}`, { waitUntil: 'domcontentloaded' }); await submit(page);
    await expect(page.getByRole('alert')).toContainText('redan ha använts');
    assert.equal(account.password, 'existing-password'); assert.equal(new URL(page.url()).pathname, '/activate-account');
  } finally { await phone.close(); }
});

test('an expired link returns a bounded phone error without changing any password', async () => {
  const account = fixture('expired', true);
  const phone = await cleanContext({ viewport: { width: 390, height: 844 }, isMobile: true });
  try {
    const page = await phone.newPage(); await page.goto(`${origin}/auth/invitation?token_hash=${account.token}`, { waitUntil: 'domcontentloaded' }); await submit(page);
    await expect(page.getByRole('alert')).toContainText('Kontakta info@trafexa.com');
    assert.equal(account.used, false); assert.equal(account.password, null);
  } finally { await phone.close(); }
});
