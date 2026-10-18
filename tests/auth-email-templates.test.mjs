import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, test } from 'node:test';
import { chromium } from '@playwright/test';
import serverlessChromium from '@sparticuz/chromium';
import { authEmails } from '../scripts/render-auth-emails.mjs';

let browser;
after(async () => { await browser?.close(); });
const sampleUrl = 'https://project.example.invalid/auth/v1/verify?token=fake-preview-only&type=email&redirect_to=https%3A%2F%2Fapp.trafexa.com%2Fauth%2Fcallback%3Fnext%3D%2Fadmin';

function fakeProviderRender(html, id) {
  const values = { ConfirmationURL: sampleUrl, TokenHash: 'a'.repeat(56), Token: '123456', ...(id === 'email_change' ? { NewEmail: 'new@example.invalid' } : {}) };
  return html.replace(/{{\s*\.(\w+)\s*}}/g, (_, key) => {
    assert.ok(Object.hasOwn(values, key), `Unsupported variable ${key} for ${id}`);
    return values[key];
  });
}

test('authentication templates render accessible mobile actions with native provider placeholders', async () => {
  browser = await chromium.launch({ executablePath: await serverlessChromium.executablePath(), args: serverlessChromium.args, headless: true });
  const subjects = JSON.parse(await readFile(new URL('../supabase/templates/auth/subjects.json', import.meta.url), 'utf8'));
  const page = await browser.newPage({ viewport: { width: 320, height: 740 } });
  await page.route('**/*', route => route.abort()); // Render entirely offline; never use or consume an Auth token.
  for (const template of authEmails) {
    const raw = await readFile(new URL(`../supabase/templates/auth/${template.id}.html`, import.meta.url), 'utf8');
    assert.equal(subjects[template.id], template.subject);
    assert.doesNotMatch(raw, /localhost|<script|<img|utm_|unsubscribe|\.Data\b/);
    await page.setContent(fakeProviderRender(raw, template.id));
    assert.equal(await page.locator('html').getAttribute('lang'), 'sv');
    assert.equal(await page.getByRole('heading', { level: 1 }).count(), 1);
    assert.equal(await page.title(), subjects[template.id]);
    assert.equal(await page.getByRole('link', { name: 'info@trafexa.com', exact: true }).getAttribute('href'), 'mailto:info@trafexa.com');
    assert.equal(await page.getByRole('link', { name: 'Integritetspolicy', exact: true }).getAttribute('href'), 'https://www.trafexa.com/privacy');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${template.id} must fit mobile`);
    const expectedUrl = template.id === 'recovery' ? 'https://app.trafexa.com/auth/recovery?token_hash=' + 'a'.repeat(56) : sampleUrl;
    if (template.cta) {
      const cta = page.getByRole('link', { name: template.cta, exact: true });
      assert.equal(await cta.getAttribute('href'), expectedUrl);
      const bounds = await cta.boundingBox();
      assert.ok(bounds?.height >= 44, `${template.id} has a touch-friendly action`);
      assert.equal(await page.getByRole('link').filter({ hasText: expectedUrl }).getAttribute('href'), expectedUrl);
      assert.doesNotMatch(raw, /\.Token\s*}}/);
    } else {
      assert.equal(await page.getByText('123456', { exact: true }).count(), 1);
      assert.doesNotMatch(raw, /\.ConfirmationURL\b/);
    }
  }
  await page.close();
});
