import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = new URL('../../', import.meta.url);
const suites = [
  'tests/docuseal/docuseal.test.mjs',
  'tests/docuseal/signing-state.test.mjs',
  'tests/signing-ledger/schema.test.mjs',
  'tests/signing-worker/store.test.mjs',
  'tests/signing-worker/worker.test.mjs',
  'tests/signing-storage/storage.test.mjs',
  'tests/signing-user/user.test.mjs',
  'tests/signing-flow/flow.test.mjs',
];
for (const suite of suites) {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL(suite, root))], { stdio: 'inherit' });
  if (result.error || result.status !== 0) process.exit(result.status || 1);
}
