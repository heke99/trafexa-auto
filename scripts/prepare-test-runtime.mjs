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
