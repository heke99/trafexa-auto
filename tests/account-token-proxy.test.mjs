import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { createSourceLoader } from './helpers/source-loader.mjs';
const require = createRequire(import.meta.url);
const { NextRequest } = require('next/server');

test('actual proxy canonicalizes account-token links before host-only cookies and never touches Auth for GET or HEAD', async () => {
 const loader = await createSourceLoader({ '@supabase/ssr': { createServerClient() { assert.fail('An inert token-link handoff must not refresh any existing Auth session'); } } });
 const { proxy } = loader.load('@/proxy');
 const search = `?token_hash=${'a'.repeat(56)}&next=%2Fmy-contracts`;
 for (const path of ['/auth/recovery','/auth/invitation']) for (const method of ['GET','HEAD']) {
  for (const host of ['trafexa.com','www.trafexa.com','app.trafexa.com']) {
   const response = await proxy(new NextRequest(`https://${host}${path}${search}`,{method,headers:{cookie:'sb-fixture-auth-token=expired-existing-session'}}));
   if(host==='app.trafexa.com') { assert.equal(response.status,200); assert.equal(response.headers.get('x-middleware-next'),'1'); }
   else { assert.equal(response.status,307); assert.equal(response.headers.get('location'),`https://app.trafexa.com${path}${search}`); }
   assert.match(response.headers.get('cache-control'),/private, no-store/);
   assert.equal(response.headers.get('referrer-policy'),'no-referrer');
   assert.match(response.headers.get('x-robots-tag'),/noindex/);
   assert.equal(response.headers.get('set-cookie'),null);
  }
 }
});
