import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SigningStateError, createSigningJob, validateSigningJob, startDispatch,
  dispatchUnknown, dispatchRejected, bindSubmission, applyVerifiedEvent, completeArchive,
} from '../../src/lib/documents/signing-state.ts';

const COMPANY = '10000000-0000-4000-8000-000000000001';
const ids = {
  id: '20000000-0000-4000-8000-000000000001', companyId: COMPANY,
  documentId: '30000000-0000-4000-8000-000000000001',
  dealId: '40000000-0000-4000-8000-000000000001',
  documentVersion: 4, sourceSha256: 'a'.repeat(64), templateId: 44,
  templateVersion: 2, templateSha256: 'e'.repeat(64),
};
const input = () => ({...ids, expectedSignerExternalIds: ['job-1:buyer', 'job-1:dealer']});
const context = () => ({...ids});
const prepared = () => createSigningJob(input());
const confirmation = () => ({
  context: context(),
  provider: {submissionId: 9001, submitters: [
    {id: 102, submissionId: 9001, externalId: 'job-1:dealer'},
    {id: 101, submissionId: 9001, externalId: 'job-1:buyer'},
  ]},
});
const bound = () => bindSubmission(startDispatch(prepared()), confirmation());
const event = (eventType = 'submission.completed', changes = {}) => ({
  eventType, entity: eventType.startsWith('form.') ? 'submitter' : 'submission',
  submissionId: 9001, submitterId: eventType.startsWith('form.') ? 101 : null,
  ...changes,
});
const archive = () => ({
  context: context(), submissionId: 9001, storageVisibility: 'private',
  signedPdf: {path: `${COMPANY}/documents/job-1/signed.pdf`, sha256: 'b'.repeat(64)},
  audit: {path: `${COMPANY}/documents/job-1/audit.json`, sha256: 'c'.repeat(64)},
});
const awaitingArchive = () => applyVerifiedEvent(bound(), event());
const completed = () => completeArchive(awaitingArchive(), archive());
const fails = (fn, code) => assert.throws(fn, error => error instanceof SigningStateError && (!code || error.code === code));

// Freeze nested records so any accidental mutation fails during transitions.
function freeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

test('preparation captures immutable identity/source and validates required runtime data', () => {
  const raw = input();
  const job = createSigningJob(raw);
  raw.expectedSignerExternalIds.push('later');
  assert.deepEqual(job.expectedSignerExternalIds, ['job-1:buyer','job-1:dealer']);
  assert.equal(job.state, 'prepared');
  assert.equal(job.version, 1);
  assert.equal(job.submissionId, null);
  assert.equal(job.archive, null);
  assert.equal(createSigningJob({...input(), dealId:null}).dealId, null);
  for (const invalid of [null, [], {}, {...input(), documentVersion:0}, {...input(), templateId:'44'},
    {...input(), sourceSha256:'hash'}, {...input(), templateVersion:0}, {...input(), templateSha256:'hash'},
    {...input(), companyId:'bad'}, {...input(), dealId:undefined},
    {...input(), expectedSignerExternalIds:[]}, {...input(), expectedSignerExternalIds:['duplicate','duplicate']},
    {...input(), expectedSignerExternalIds:[' untrusted ']}, {...input(), expectedSignerExternalIds:['line\nbreak']},
    {...input(), state:'completed'}, {...input(), financeStatus:'approved'},
  ]) fails(() => createSigningJob(invalid));
});

test('dispatch is claimed once and uncertain outcomes cannot start a retry', () => {
  const original = freeze(prepared());
  const dispatched = startDispatch(original);
  assert.equal(original.state,'prepared');
  assert.equal(dispatched.state,'dispatching');
  assert.equal(dispatched.version,2);
  const unknown = dispatchUnknown(freeze(dispatched));
  assert.equal(unknown.state,'outcome_unknown');
  assert.equal(unknown.version,3);
  for (const job of [dispatched,unknown,bound(),completed()]) fails(() => startDispatch(job),'invalid_transition');
  for (const job of [original,unknown,bound()]) fails(() => dispatchUnknown(job),'invalid_transition');
});

test('confirmed provider submission binds all external IDs, independent of submitter array order', () => {
  const dispatched = freeze(startDispatch(prepared()));
  const result = bindSubmission(dispatched, freeze(confirmation()));
  assert.equal(result.submissionId,9001);
  assert.equal(result.state,'awaiting_signatures');
  assert.equal(result.version,3);
  assert.deepEqual(result.submitters,[{id:102,externalId:'job-1:dealer'},{id:101,externalId:'job-1:buyer'}]);
  assert.equal(result.submitters[0].email,undefined);
  assert.equal(dispatched.submissionId,null);
  const reconciled = bindSubmission(dispatchUnknown(dispatched),confirmation());
  assert.equal(reconciled.version,4);
  fails(() => bindSubmission(prepared(),confirmation()),'invalid_transition');
  fails(() => bindSubmission(result,confirmation()),'invalid_transition');
});

test('known dispatch rejection is terminal and never confused with signer decline or unknown outcome', () => {
  const failed = dispatchRejected(freeze(startDispatch(prepared())));
  assert.equal(failed.state, 'dispatch_failed');
  assert.equal(failed.submissionId, null);
  assert.equal(failed.version, 3);
  fails(() => startDispatch(failed), 'invalid_transition');
  fails(() => bindSubmission(failed, confirmation()), 'invalid_transition');
  assert.equal(applyVerifiedEvent(failed, event()), failed);
  for (const job of [prepared(), dispatchUnknown(startDispatch(prepared())), bound(), completed()]) {
    fails(() => dispatchRejected(job), 'invalid_transition');
  }
});

test('bind rejects wrong local IDs, document version, template and source hash', () => {
  for (const field of ['id','companyId','documentId','dealId']) {
    const result = confirmation();
    result.context[field] = 'f0000000-0000-4000-8000-000000000001';
    fails(() => bindSubmission(startDispatch(prepared()),result),'binding_mismatch');
  }
  for (const [field,value] of [['documentVersion',5],['templateId',45],['sourceSha256','d'.repeat(64)],['templateVersion',3],['templateSha256','f'.repeat(64)]]) {
    const result = confirmation(); result.context[field] = value;
    fails(() => bindSubmission(startDispatch(prepared()),result),'binding_mismatch');
  }
});

test('submitter IDs cannot be confused with submission ID; complete unique signer mapping required', () => {
  const invalid = [
    {submissionId:101}, {submitters:[]}, {submitters:[confirmation().provider.submitters[0]]},
    {submitters:[{id:102,submissionId:9002,externalId:'job-1:dealer'},confirmation().provider.submitters[1]]},
    {submitters:[{id:102,submissionId:9001,externalId:'someone-else'},confirmation().provider.submitters[1]]},
    {submitters:[{id:101,submissionId:9001,externalId:'job-1:dealer'},confirmation().provider.submitters[1]]},
    {submitters:[{id:102,submissionId:9001,externalId:'job-1:buyer'},confirmation().provider.submitters[1]]},
    {submitters:[{id:102,submissionId:9001,externalId:null},confirmation().provider.submitters[1]]},
    {submissionId:'9001'},
  ];
  for (const changes of invalid) fails(() => bindSubmission(startDispatch(prepared()),{context:context(),provider:{...confirmation().provider,...changes}}));
});

test('wrong submission and unknown signer callbacks have no local effect', () => {
  const job = freeze(bound());
  for (const callback of [event('submission.completed',{submissionId:101}), event('submission.completed',{submissionId:9002}),
    event('form.completed',{submitterId:9001}), event('form.declined',{submitterId:555}),
  ]) assert.equal(applyVerifiedEvent(job,callback),job);
  const unbound = freeze(prepared());
  assert.equal(applyVerifiedEvent(unbound,event()),unbound);
});

test('partial and even all individual completions never complete the entire signing job', () => {
  const job = freeze(bound());
  const partial = applyVerifiedEvent(job,event('form.completed'));
  assert.equal(partial.state,'awaiting_signatures');
  assert.equal(partial.version,job.version+1);
  assert.deepEqual(partial.completedSubmitterIds,[101]);
  assert.equal(applyVerifiedEvent(partial,event('form.completed')),partial);
  const all = applyVerifiedEvent(partial,event('form.completed',{submitterId:102}));
  assert.deepEqual(all.completedSubmitterIds,[101,102]);
  assert.equal(all.state,'awaiting_signatures');
  assert.equal(all.archive,null);
});

test('whole-submission completion requires separate archive and duplicate events preserve version', () => {
  const job = freeze(bound());
  const next = applyVerifiedEvent(job,event());
  assert.equal(next.state,'awaiting_archive');
  assert.equal(next.version,job.version+1);
  assert.equal(next.archive,null);
  assert.equal(applyVerifiedEvent(next,event()),next);
  for (const type of ['form.viewed','form.started','submission.created','submission.archived']) assert.equal(applyVerifiedEvent(job,event(type)),job);
  for (const type of ['form.declined','submission.expired']) assert.equal(applyVerifiedEvent(next,event(type)),next);
});

test('decline and expiration close active signing; reordered callbacks do not reopen terminal outcomes', () => {
  for (const [type,state] of [['form.declined','declined'],['submission.expired','expired']]) {
    const job = freeze(bound()); const result = applyVerifiedEvent(job,event(type));
    assert.equal(result.state,state);
    assert.equal(result.version,job.version+1);
    for (const callback of [event(type),event(),event('form.completed')]) assert.equal(applyVerifiedEvent(result,callback),result);
    fails(() => completeArchive(result,archive()),'invalid_transition');
  }
});

test('archive requires exact context, bound submission, private paths and checksums', () => {
  const job = freeze(awaitingArchive());
  for (const field of ['id','companyId','documentId','dealId']) {
    const proof = archive(); proof.context[field] = 'f0000000-0000-4000-8000-000000000001';
    fails(() => completeArchive(job,proof),'binding_mismatch');
  }
  for (const [field,value] of [['documentVersion',5],['templateId',99],['sourceSha256','d'.repeat(64)],['templateVersion',3],['templateSha256','f'.repeat(64)]]) {
    const proof = archive(); proof.context[field]=value;
    fails(() => completeArchive(job,proof),'binding_mismatch');
  }
  for (const changes of [{submissionId:101},{storageVisibility:'public'}, {storageVisibility:undefined},
    {signedPdf:{path:'https://provider.example/file.pdf',sha256:'b'.repeat(64)}},
    {audit:{path:'other-company/audit.json',sha256:'c'.repeat(64)}},
    {signedPdf:{path:`${COMPANY}/signed.pdf`,sha256:'broken'}},
  ]) fails(() => completeArchive(job,{...archive(),...changes}));
  for (const path of [`${COMPANY}/../signed.pdf`,`${COMPANY}/%2e%2e/signed.pdf`,`${COMPANY}//signed.pdf`,`${COMPANY}/signed.pdf?token=x`,`${COMPANY}/signed.txt`,`${COMPANY}/a\\signed.pdf`]) {
    const proof=archive();proof.signedPdf.path=path;fails(() => completeArchive(job,proof));
  }
  const same=archive(); same.audit.path=same.signedPdf.path;fails(() => completeArchive(job,same));
  fails(() => completeArchive(bound(),archive()),'invalid_transition');
});

test('archive completes once and preserves identity; late callbacks cannot regress completion', () => {
  const job=freeze(awaitingArchive()); const evidence=archive(); const result=completeArchive(job,evidence);
  evidence.signedPdf.path=`${COMPANY}/changed.pdf`;
  assert.equal(result.state,'completed');
  assert.equal(result.version,job.version+1);
  assert.equal(result.documentVersion,4);
  assert.equal(result.dealId,ids.dealId);
  assert.equal(result.financeStatus,undefined);
  assert.equal(result.documentStatus,undefined);
  assert.equal(result.archive.signedPdf.path,archive().signedPdf.path);
  assert.equal(completeArchive(result,archive()),result);
  const reversed={audit:archive().audit,signedPdf:archive().signedPdf,storageVisibility:'private',submissionId:9001,context:context()};
  assert.equal(completeArchive(result,reversed),result);
  for (const type of ['submission.completed','form.completed','form.declined','submission.expired','submission.archived']) assert.equal(applyVerifiedEvent(freeze(result),event(type)),result);
  const changed=archive(); changed.audit.sha256='d'.repeat(64); fails(() => completeArchive(result,changed),'binding_mismatch');
});

test('runtime snapshot validation rejects forged bindings and invalid state records', () => {
  for (const changes of [{version:0},{version:'3'},{state:'signed'},{submissionId:null},{submitters:[]},
    {completedSubmitterIds:[999]},{completedSubmitterIds:[101,101]},{archive:archive()},
    {submitters:[{id:101,externalId:'job-1:buyer'},{id:101,externalId:'job-1:dealer'}]},
  ]) fails(() => validateSigningJob({...bound(),...changes}));
  fails(() => validateSigningJob({...prepared(),submissionId:9001}));
  fails(() => validateSigningJob({...completed(),archive:null}));
  fails(() => startDispatch({...prepared(),sourceSha256:'bad'}));
  fails(() => applyVerifiedEvent({...bound(),companyId:'bad'},event()));
  fails(() => applyVerifiedEvent({...bound(),version:Number.MAX_SAFE_INTEGER},event()));
});

test('malformed event entities and numeric IDs fail even if TypeScript says valid', () => {
  for (const invalid of [null,{},event('unsupported'),event('form.completed',{entity:'submission'}),
    event('submission.completed',{entity:'submitter'}),event('submission.completed',{submitterId:101}),
    event('form.completed',{submitterId:null}),event('form.completed',{submitterId:'101'}),
    event('submission.completed',{submissionId:0}),
  ]) fails(() => applyVerifiedEvent(bound(),invalid));
});
