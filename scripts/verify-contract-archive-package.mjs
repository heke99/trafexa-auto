import { constants } from 'node:fs';
import { mkdir, open } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { MAX_CONTRACT_ARCHIVE_PACKAGE_BYTES, verifyContractArchivePackage } from '../src/lib/documents/contract-archive-package.ts';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const usage = 'Använd: node scripts/verify-contract-archive-package.mjs --package FIL.tar --sha256 BETRODD_SHA256 [--restore-dir NY_KATALOG]';

async function readBoundedPackage(filename) {
  const handle = await open(filename, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || !Number.isSafeInteger(stat.size) || stat.size < 1024 || stat.size > MAX_CONTRACT_ARCHIVE_PACKAGE_BYTES) throw Error('invalid_package');
    const bytes = Buffer.alloc(stat.size);
    let offset = 0;
    while (offset < bytes.length) {
      const read = await handle.read(bytes, offset, bytes.length - offset, offset);
      if (!read.bytesRead) throw Error('incomplete_package');
      offset += read.bytesRead;
    }
    if ((await handle.read(Buffer.alloc(1), 0, 1, offset)).bytesRead) throw Error('package_changed');
    return bytes;
  } finally { await handle.close(); }
}

/** Offline only: verifies first, then extracts fixed names into a new private directory. */
export async function verifyAndRestoreContractArchivePackage({ packagePath, expectedSha256, restoreDir }) {
  if (typeof packagePath !== 'string' || !packagePath || typeof expectedSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(expectedSha256)
    || restoreDir !== undefined && (typeof restoreDir !== 'string' || !restoreDir)) throw Error('invalid_arguments');
  const bytes = await readBoundedPackage(packagePath);
  const verified = verifyContractArchivePackage(bytes, { expectedSha256 });
  const report = {
    schemaVersion: 1, verified: true, restored: false,
    packageSha256: verified.sha256, manifestSha256: digest(verified.manifestBytes),
    archiveId: verified.archive.id, signingId: verified.archive.signingId, companyId: verified.archive.companyId,
    pdfSha256: verified.archive.pdf.sha256, evidenceSha256: verified.archive.evidence.sha256,
    checkedAt: new Date().toISOString(),
  };
  if (restoreDir === undefined) return report;

  const directory = resolve(restoreDir);
  // Existing directories, symlinks and files are all refused. Parent must already exist.
  await mkdir(directory, { mode: 0o700 });
  for (const [name, content] of [['manifest.json', verified.manifestBytes], ['original.pdf', verified.pdf], ['evidence.json', verified.evidence]]) {
    const handle = await open(join(directory, name), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try { await handle.writeFile(content); await handle.sync(); }
    finally { await handle.close(); }
    const reader = await open(join(directory, name), constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stat = await reader.stat();
      if (!stat.isFile() || stat.size !== content.byteLength || digest(await reader.readFile()) !== digest(content)) throw Error('restore_unverified');
    } finally { await reader.close(); }
  }
  report.restored = true;
  const proof = await open(join(directory, 'restore-proof.json'), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { await proof.writeFile(JSON.stringify(report, null, 2) + '\n'); await proof.sync(); }
  finally { await proof.close(); }
  return report;
}

export async function main(args = process.argv.slice(2)) {
  if (args.length === 1 && args[0] === '--help') { process.stdout.write(usage + '\n'); return; }
  const options = {};
  const names = { '--package': 'packagePath', '--sha256': 'expectedSha256', '--restore-dir': 'restoreDir' };
  for (let index = 0; index < args.length; index += 2) {
    const key = names[args[index]];
    if (!key || Object.hasOwn(options, key) || !args[index + 1] || args[index + 1].startsWith('--')) throw Error('invalid_arguments');
    options[key] = args[index + 1];
  }
  const report = await verifyAndRestoreContractArchivePackage(options);
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(() => {
    process.stderr.write('Arkivpaketet kunde inte verifieras eller återställas. Kontrollera den separat sparade kontrollsumman och välj en ny katalog.\n' + usage + '\n');
    process.exitCode = 1;
  });
}
