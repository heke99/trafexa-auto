import assert from 'node:assert/strict';
import {test} from 'node:test';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile,writeFile,mkdir,mkdtemp,readdir,stat,access,rm,symlink} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {journey,C,digest} from './helpers/dealer-guest-journey.mjs';

const execute=promisify(execFile);
const verifier=fileURLToPath(new URL('../scripts/verify-contract-archive-package.mjs',import.meta.url));

/** Real migrated SQL, signing, original registration, protected export route and
 * a separate offline CLI process. Only external Auth/Storage/provider IO is local. */
test('actual archived dealer original exports, restores offline and proves exact private bytes without trusting the package itself',async t=>{
 const h=await journey(t,'guest-first');
 const retainRoot=process.env.TRAFEXA_BACKUP_PROOF_DIR;
 const directory=await mkdtemp(join(retainRoot??tmpdir(),'trafexa-backup-roundtrip-'));
 if(!retainRoot)t.after(()=>rm(directory,{recursive:true,force:true}));
 const anchorDirectory=join(directory,'trusted-export'),restored=join(directory,'restored');
 await mkdir(anchorDirectory,{mode:0o700});
 const route=h.loader.load('src/app/api/contract-signings/[id]/archive-package/route.ts');
 const get=()=>route.GET(new Request(`https://app.trafexa.com/api/contract-signings/${h.signing.id}/archive-package?companyId=${C}`),{params:Promise.resolve({id:h.signing.id})});
 const before={objectCount:h.state.objects.size,providerCount:h.state.providers.length,audit:(await h.db.query('select count(*)::int n from public.audit_events')).rows[0].n};
 const response=await get();
 assert.equal(response.status,200);assert.match(response.headers.get('Cache-Control'),/private.*no-store/);
 assert.equal(response.headers.get('Content-Type'),'application/x-tar');
 assert.equal(response.headers.get('X-Archive-Actor-Role'),'owner');
 const trustedHash=response.headers.get('X-Archive-Package-SHA256');assert.match(trustedHash,/^[a-f0-9]{64}$/);
 const bytes=new Uint8Array(await response.arrayBuffer());assert.equal(digest(bytes),trustedHash);
 const packagePath=join(directory,'archive.tar'),anchorPath=join(anchorDirectory,'package.sha256');
 await writeFile(anchorPath,trustedHash+'\n',{mode:0o600});
 await writeFile(packagePath,bytes,{mode:0o600});
 // The offline child has neither the app's URL nor server/provider credentials.
 const offlineEnvironment={PATH:process.env.PATH,LANG:'C.UTF-8'};
 const invoke=(packageFile,sha,restoreDir)=>execute(process.execPath,[verifier,'--package',packageFile,'--sha256',sha,...(restoreDir?['--restore-dir',restoreDir]:[])],{cwd:process.cwd(),env:offlineEnvironment});
 const savedHash=(await readFile(anchorPath,'utf8')).trim();
 const checked=JSON.parse((await invoke(packagePath,savedHash)).stdout);assert.equal(checked.verified,true);assert.equal(checked.restored,false);
 await assert.rejects(access(restored));
 const proof=JSON.parse((await invoke(packagePath,savedHash,restored)).stdout);
 assert.equal(proof.verified,true);assert.equal(proof.restored,true);assert.equal(proof.packageSha256,savedHash);
 const restoredPdf=await readFile(join(restored,'original.pdf')),restoredEvidence=await readFile(join(restored,'evidence.json')),restoredManifest=await readFile(join(restored,'manifest.json'));
 assert.deepEqual(restoredPdf,Buffer.from(h.state.objects.get(h.archived.pdf.objectPath).bytes));
 assert.deepEqual(restoredEvidence,Buffer.from(h.state.objects.get(h.archived.evidence.objectPath).bytes));
 assert.equal(digest(restoredPdf),h.archived.pdf.sha256);assert.equal(digest(restoredEvidence),h.archived.evidence.sha256);
 assert.equal(digest(restoredManifest),response.headers.get('X-Archive-Manifest-SHA256'));
 assert.equal(JSON.parse(restoredEvidence.toString()).signedPdfSha256,digest(restoredPdf));
 assert.deepEqual(JSON.parse(await readFile(join(restored,'restore-proof.json'),'utf8')),proof);
 assert.deepEqual((await readdir(restored)).sort(),['evidence.json','manifest.json','original.pdf','restore-proof.json']);
 assert.equal((await stat(restored)).mode&0o777,0o700);
 for(const name of await readdir(restored))assert.equal((await stat(join(restored,name))).mode&0o777,0o600);
 // A failed re-run cannot overwrite a previously verified recovery.
 await assert.rejects(invoke(packagePath,savedHash,restored),e=>e.code===1);
 assert.deepEqual(await readFile(join(restored,'original.pdf')),restoredPdf);
 // Corruption or a wrong independently supplied checksum fails before extraction.
 const damaged=Uint8Array.from(bytes);damaged[1024]^=1;const damagedPath=join(directory,'damaged.tar');
 await writeFile(damagedPath,damaged,{mode:0o600});
 const refused=join(directory,'must-not-be-restored');
 await assert.rejects(invoke(damagedPath,savedHash,refused),e=>e.code===1);
 await assert.rejects(invoke(packagePath,'0'.repeat(64),refused),e=>e.code===1);
 await assert.rejects(access(refused));
 const packageLink=join(directory,'package-link.tar');await symlink(packagePath,packageLink);
 await assert.rejects(invoke(packageLink,savedHash,refused),e=>e.code===1);
 await assert.rejects(access(refused));
 // A later source-storage corruption cannot be disguised by exporting a new PDF.
 const stored=h.state.objects.get(h.archived.pdf.objectPath),original=stored.bytes;
 stored.bytes=Uint8Array.from(original);stored.bytes[20]^=1;
 const invalid=await get();assert.equal(invalid.status,409);assert.equal(invalid.headers.get('X-Archive-Package-SHA256'),null);
 assert.equal((await invalid.json()).code,'storage_unverified');stored.bytes=original;
 assert.deepEqual({objectCount:h.state.objects.size,providerCount:h.state.providers.length,audit:(await h.db.query('select count(*)::int n from public.audit_events')).rows[0].n},before);
 const summary={schemaVersion:1,result:'PASS',source:'actual protected archive route after actual dealer/guest signing, RLS registration and delivery',verified:true,restored:true,packageSha256:savedHash,manifestSha256:digest(restoredManifest),pdfSha256:digest(restoredPdf),evidenceSha256:digest(restoredEvidence),bytes:{package:bytes.length,pdf:restoredPdf.length,evidence:restoredEvidence.length},directoryMode:'0700',fileMode:'0600',negativeChecks:['existing target refused','corruption refused before restore','wrong trusted hash refused','symlink refused','source corruption blocks export'],outboundProvider:'synthetic local acceptance only',remoteStorageBackupVerified:false,productionRestoreVerified:false};
 await writeFile(join(directory,'roundtrip-proof.json'),JSON.stringify(summary,null,2)+'\n',{mode:0o600});
 console.log(JSON.stringify({backupRoundtrip:summary.result,packageSha256:summary.packageSha256,restored:true,remoteBackup:false,retainedSyntheticProof:!!retainRoot}));
});
