import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, writeFile, readFile, stat, readdir, rm, symlink, truncate, access } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { generateSignedContractArtifacts, parseCompletedContract } from '../src/lib/documents/signed-contract-pdf.ts';
import { contractArchivePaths } from '../src/lib/documents/native-contract-archive.ts';
import { createContractArchivePackage, MAX_CONTRACT_ARCHIVE_PACKAGE_BYTES } from '../src/lib/documents/contract-archive-package.ts';
import { verifyAndRestoreContractArchivePackage } from '../scripts/verify-contract-archive-package.mjs';
import { completedArchiveSource, archiveId, digest } from './helpers/native-archive-fixture.mjs';

const execute = promisify(execFile);
const script = fileURLToPath(new URL('../scripts/verify-contract-archive-package.mjs', import.meta.url));
async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'trafexa-archive-restore-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const raw = completedArchiveSource(); raw.draft.actorLabel = 'Du';
  const source = parseCompletedContract(raw), { pdf, evidence } = await generateSignedContractArtifacts(source);
  const paths = contractArchivePaths(source.companyId, source.id, digest(pdf), digest(evidence));
  const archive = {
    id: archiveId(77), signingId: source.id, companyId: source.companyId, dealId: source.dealId,
    draftId: source.draftId, draftVersion: source.draftVersion, documentContentSha256: source.documentHash,
    signingRevision: 3, rendererVersion: 'trafexa-native-v1', evidenceSchemaVersion: 1,
    archivedAt: '2026-10-15T11:00:00Z',
    pdf: { objectPath: paths.pdf, sha256: digest(pdf), bytes: pdf.byteLength, mimeType: 'application/pdf' },
    evidence: { objectPath: paths.evidence, sha256: digest(evidence), bytes: evidence.byteLength, mimeType: 'application/json' },
  };
  const packaged = createContractArchivePackage({ archive, source, pdf, evidence });
  const packagePath = join(directory, 'archive.tar'), restoreDir = join(directory, 'restored');
  await writeFile(packagePath, packaged.bytes, { mode: 0o600 });
  return { directory, packagePath, restoreDir, pdf, evidence, archive, ...packaged };
}

test('offline restore verifies a real signed pair before writing exact files and a private proof in a new directory', async t => {
  const h = await fixture(t);
  const result = await verifyAndRestoreContractArchivePackage({ ...h, expectedSha256: h.sha256 });
  assert.equal(result.verified, true); assert.equal(result.restored, true);
  assert.equal(result.packageSha256, h.sha256); assert.equal(result.manifestSha256, h.manifestSha256);
  assert.deepEqual(await readFile(join(h.restoreDir, 'original.pdf')), Buffer.from(h.pdf));
  assert.deepEqual(await readFile(join(h.restoreDir, 'evidence.json')), Buffer.from(h.evidence));
  assert.deepEqual((await readdir(h.restoreDir)).sort(), ['evidence.json', 'manifest.json', 'original.pdf', 'restore-proof.json']);
  assert.equal((await stat(h.restoreDir)).mode & 0o777, 0o700);
  for (const name of await readdir(h.restoreDir)) assert.equal((await stat(join(h.restoreDir, name))).mode & 0o777, 0o600);
  assert.deepEqual(JSON.parse(await readFile(join(h.restoreDir, 'restore-proof.json'), 'utf8')), result);
  assert.deepEqual(await readFile(h.packagePath), Buffer.from(h.bytes));
});

test('verify-only and CLI use the separately supplied hash and disclose no contract text or signer data', async t => {
  const h = await fixture(t);
  const verified = await verifyAndRestoreContractArchivePackage({ packagePath: h.packagePath, expectedSha256: h.sha256 });
  assert.equal(verified.verified, true); assert.equal(verified.restored, false);
  await assert.rejects(access(h.restoreDir));
  const { stdout } = await execute(process.execPath, [script, '--package', h.packagePath, '--sha256', h.sha256]);
  const result = JSON.parse(stdout); assert.equal(result.verified, true); assert.equal(result.restored, false);
  assert.doesNotMatch(stdout, /Originalvillkor|Fiktiv kund|archive-customer@|canonicalContent|strokes|SUPABASE|Bearer/);
});

test('untrusted or changed package and missing hash fail before any extraction', async t => {
  const h = await fixture(t);
  for (const expectedSha256 of [undefined, 'z'.repeat(64), '0'.repeat(64)]) {
    await assert.rejects(verifyAndRestoreContractArchivePackage({ ...h, expectedSha256 }));
    await assert.rejects(access(h.restoreDir));
  }
  const bytes = Buffer.from(h.bytes); bytes[512] ^= 1; await writeFile(h.packagePath, bytes);
  await assert.rejects(verifyAndRestoreContractArchivePackage({ ...h, expectedSha256: h.sha256 }));
  await assert.rejects(access(h.restoreDir));
});

test('restore refuses an existing target or symlink and leaves its existing files unchanged', async t => {
  const h = await fixture(t);
  const first = await verifyAndRestoreContractArchivePackage({ ...h, expectedSha256: h.sha256 });
  const before = await readFile(join(h.restoreDir, 'original.pdf'));
  await assert.rejects(verifyAndRestoreContractArchivePackage({ ...h, expectedSha256: h.sha256 }));
  assert.deepEqual(await readFile(join(h.restoreDir, 'original.pdf')), before);
  assert.equal(first.restored, true);
  const link = join(h.directory, 'link'); await symlink(h.restoreDir, link);
  await assert.rejects(verifyAndRestoreContractArchivePackage({ ...h, restoreDir: link, expectedSha256: h.sha256 }));
  assert.deepEqual(await readFile(join(h.restoreDir, 'original.pdf')), before);
});

test('symlink inputs, directories, truncation and oversized sparse files are refused before creating a restore directory', async t => {
  const h = await fixture(t), link = join(h.directory, 'package-link.tar');
  await symlink(h.packagePath, link);
  for (const packagePath of [link, h.directory]) {
    await assert.rejects(verifyAndRestoreContractArchivePackage({ ...h, packagePath, expectedSha256: h.sha256 }));
    await assert.rejects(access(h.restoreDir));
  }
  await truncate(h.packagePath, 1024);
  await assert.rejects(verifyAndRestoreContractArchivePackage({ ...h, expectedSha256: h.sha256 }));
  await truncate(h.packagePath, MAX_CONTRACT_ARCHIVE_PACKAGE_BYTES + 512);
  await assert.rejects(verifyAndRestoreContractArchivePackage({ ...h, expectedSha256: h.sha256 }));
  await assert.rejects(access(h.restoreDir));
});

test('CLI refuses unknown or duplicate flags without printing private paths or raw errors', async () => {
  for (const args of [['--unknown', 'PRIVATE_INPUT'], ['--package', 'PRIVATE_INPUT', '--package', 'OTHER'], ['--sha256']]) {
    await assert.rejects(execute(process.execPath, [script, ...args]), error => {
      assert.equal(error.code, 1); assert.doesNotMatch(error.stderr, /PRIVATE_INPUT|ENOENT|Error:|at file:/);
      assert.match(error.stderr, /kunde inte verifieras/); return true;
    });
  }
  const help = await execute(process.execPath, [script, '--help']); assert.match(help.stdout, /--restore-dir/);
});
