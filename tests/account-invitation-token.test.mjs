import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { createSourceLoader } from './helpers/source-loader.mjs';

const sha224 = createHash('sha224').update('synthetic@example.invalid12345678').digest('hex');
const loader = await createSourceLoader();
const { validAccountInvitationToken } = loader.load('@/lib/auth/account-invitation-token');

test('invitation format accepts actual GoTrue SHA-224 and prior 64-character links while rejecting malformed hashes', () => {
  assert.equal(sha224.length, 56);
  assert.equal(validAccountInvitationToken(sha224), true);
  assert.equal(validAccountInvitationToken('a'.repeat(64)), true);
  for (const value of [null, undefined, 56, '', 'a'.repeat(55), 'a'.repeat(57), 'a'.repeat(63), 'a'.repeat(65), 'g'.repeat(56), `${sha224}\n`, ` ${sha224}`, `${sha224}&next=/admin`]) {
    assert.equal(validAccountInvitationToken(value), false);
  }
});

test('actual activation page exposes password form for SHA-224 and compatible links without exposing cookie token in form inputs', async () => {
  for (const token of [sha224, 'a'.repeat(64), 'a'.repeat(55), undefined]) {
    const source = await createSourceLoader({
      'next/headers': { cookies: async () => ({ get: () => token === undefined ? undefined : { value: token } }) },
      'next/link': { default: () => null },
      '@/components/auth-shell': { AuthShell: () => null },
      '@/lib/auth/activate-account-actions': { activateAccountAction: () => assert.fail('Rendering must never consume an invitation') },
    });
    const page = await source.load('src/app/activate-account/page.tsx').default({ searchParams: Promise.resolve({}) });
    const form = page.props.children.find(child => child?.type === 'form');
    assert.equal(Boolean(form), validAccountInvitationToken(token));
    if (form) {
      const fields = [];
      const walk = element => {
        if (!element || typeof element !== 'object') return;
        if (element.type === 'input') fields.push(element.props.name);
        for (const child of [element.props?.children].flat()) walk(child);
      };
      walk(form);
      assert.deepEqual(fields, ['password', 'acknowledged']);
    }
  }
});
