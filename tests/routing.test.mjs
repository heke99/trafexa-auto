import assert from 'node:assert/strict';
import { test } from 'node:test';
import { domainRedirect, isAuthPath, isWorkspacePath, safeNextPath, WORKSPACE_SECTIONS } from '../src/lib/routing.mjs';

test('return destinations preserve local routes, queries and fragments on the application origin', () => {
  for (const path of ['/dashboard', '/reset-password', '/inventory?status=reserved', '/deals/123#documents', '/']) {
    const next = safeNextPath(path);
    assert.equal(next, path);
    assert.equal(new URL(next, 'https://app.trafexa.com').origin, 'https://app.trafexa.com');
  }
});

test('return destinations reject external URLs, protocol-relative URLs, backslashes and control characters', () => {
  for (const path of [undefined, null, 42, {}, '', 'dashboard', 'https://example.invalid', '//example.invalid', '///example.invalid', '/\\example.invalid', '/dashboard\\..\\evil', '/\n/example.invalid', '/\rexample.invalid', '/\texample.invalid', '/dashboard\u0000']) {
    assert.equal(safeNextPath(path), '/dashboard', String(path));
  }
});

test('encoded URL delimiters remain a path on the trusted application origin', () => {
  for (const path of ['/%2f%2fexample.invalid', '/%5cexample.invalid', '/%0aexample.invalid', '/dashboard?next=https%3A%2F%2Fexample.invalid']) {
    assert.equal(new URL(safeNextPath(path), 'https://app.trafexa.com').origin, 'https://app.trafexa.com');
  }
});

test('workspace matching includes descendants while excluding lookalike public paths', () => {
  for (const section of WORKSPACE_SECTIONS) {
    assert.equal(isWorkspacePath(`/${section}`), true);
    assert.equal(isWorkspacePath(`/${section}/detail`), true);
    assert.equal(isWorkspacePath(`/${section}-public`), false);
  }
  for (const path of ['/', '/demo', '/privacy', '/api/demo-requests', '/login']) assert.equal(isWorkspacePath(path), false);
});

test('authentication matching includes recovery and callback routes without unrelated prefixes', () => {
  for (const path of ['/login', '/register', '/onboarding', '/forgot-password', '/reset-password', '/auth/callback']) assert.equal(isAuthPath(path), true);
  for (const path of ['/demo', '/login-public', '/auth/callback-extra', '/api/demo-requests']) assert.equal(isAuthPath(path), false);
});

test('public production domains hand workspace and auth navigation to the application domain', () => {
  for (const host of ['trafexa.com', 'www.trafexa.com']) {
    for (const path of ['/inventory', '/customers/detail', '/finance', '/login', '/auth/callback']) {
      assert.equal(domainRedirect(host, path, '?next=%2Fdashboard'), `https://app.trafexa.com${path}?next=%2Fdashboard`);
    }
    for (const path of ['/', '/demo', '/privacy', '/terms', '/api/demo-requests', '/inventory-public']) assert.equal(domainRedirect(host, path), null);
  }
});

test('application homepage redirects to dashboard and local or unrecognized hosts stay local', () => {
  assert.equal(domainRedirect('app.trafexa.com', '/', '?source=home'), 'https://app.trafexa.com/dashboard?source=home');
  assert.equal(domainRedirect('app.trafexa.com', '/inventory'), null);
  for (const host of ['localhost', '127.0.0.1', 'preview.vercel.app', 'trafexa.com.example.invalid', 'www.trafexa.com.example.invalid']) {
    assert.equal(domainRedirect(host, '/'), null);
    assert.equal(domainRedirect(host, '/inventory'), null);
  }
});
