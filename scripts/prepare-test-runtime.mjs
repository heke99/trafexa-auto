import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

// Flat tests reuse these two isolated database fixtures. Fail once with an
// actionable setup command instead of losing individual suites during loading.
for (const fixture of ['crm-db', 'company-team-db']) {
  try {
    createRequire(new URL(`../tests/${fixture}/package.json`, import.meta.url))
      .resolve('@electric-sql/pglite');
  } catch {
    throw new Error(`Missing ${fixture} database test dependency. Run npm run test:setup before npm test.`);
  }
}

// Each browser suite uses the same extracted executable and font directory.
// Complete extraction before Node starts concurrent test processes (ETXTBSY).
const require = createRequire(fileURLToPath(new URL('../package.json', import.meta.url)));
const Chromium = require('@sparticuz/chromium').default;
await Chromium.executablePath();

// PDF assertions extract the actual generated document text, rather than just
// checking that a renderer returned bytes.
const { spawnSync } = await import('node:child_process');
if (spawnSync('pdftotext', ['-v'], { stdio: 'ignore' }).status !== 0) {
  throw new Error('Missing PDF test tool pdftotext. Install poppler-utils; see docs/TEST_ENVIRONMENT.md.');
}

if (spawnSync('python3', ['--version'], { stdio: 'ignore' }).status !== 0) {
  throw new Error('Missing archive test tool python3. Install Python 3; see docs/TEST_ENVIRONMENT.md.');
}

// Extracting the executable alone does not prove that NSS, Fontconfig and
// system fonts can render a real interactive page on a clean Linux image.
const { chromium } = require('@playwright/test');
let browser;
try {
  browser = await chromium.launch({
    executablePath: await Chromium.executablePath(),
    args: Chromium.args.filter(argument => argument !== '--single-process'),
    headless: true,
  });
  const page = await browser.newPage({ viewport: { width: 320, height: 480 } });
  await page.route('**/*', route => route.abort());
  await page.setContent('<meta charset="utf-8"><h1>Testmiljö – åäö</h1><button onclick="this.textContent=\'Klart\'">Fortsätt</button>');
  await page.getByRole('button', { name: 'Fortsätt', exact: true }).click({ timeout: 10000 });
  const pixels = await page.screenshot({ timeout: 10000 });
  if (await page.getByRole('button').textContent() !== 'Klart' || !pixels.byteLength) {
    throw new Error('Browser interaction or rendering could not be verified.');
  }
} catch (error) {
  throw new Error('Test browser could not render and click. Check NSS, Fontconfig and fonts; see docs/TEST_ENVIRONMENT.md.', { cause: error });
} finally {
  await browser?.close().catch(() => {});
}
