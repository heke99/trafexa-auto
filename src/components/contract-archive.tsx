'use client';

import { useEffect, useId, useRef, useState, useTransition } from 'react';
import { verifyContractArchiveAction } from '@/lib/data/contract-archive-integrity-actions';
import { archiveContractAction, getContractArchiveAction } from '@/lib/data/contract-archive-actions';
import type { ContractArchive as ArchivedContract, ContractArchiveResult } from '@/lib/contracts/archive-types';
import type { ContractSigning } from '@/lib/contracts/signing-types';

type Props = { signing: ContractSigning; companyId?: string; userId: string; role?: string };
type ReadState = { phase: 'idle' | 'loading' | 'ready' | 'unverified'; archive: ArchivedContract | null };
const sameId = (left: string, right: string) => left.toLowerCase() === right.toLowerCase();
const denied = (code: string) => ['unauthenticated', 'access_denied', 'source_invalid'].includes(code);

/** An exact signing and actor scope owns the confirmation and retry nonce. */
export function ContractArchive(props: Props) {
  if (props.signing.status !== 'completed') return null;
  const key = [props.signing.companyId, props.signing.dealId, props.signing.draftId, props.signing.draftVersion, props.signing.id, props.signing.documentHash, props.signing.revision, props.companyId ?? 'customer', props.userId, props.role ?? 'customer'].join(':');
  return <ArchivePanel key={key} {...props} />;
}

function ArchivePanel({ signing, companyId, userId, role }: Props) {
  const confirmationId = useId();
  const [read, setRead] = useState<ReadState>({ phase: 'idle', archive: null });
  const [readError, setReadError] = useState('');
  const [actionError, setActionError] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const [writing, setWriting] = useState(false);
  const [checking, setChecking] = useState(false);
  const [packaging, setPackaging] = useState(false);
  const [packageHash, setPackageHash] = useState<string | null>(null);
  const [packageError, setPackageError] = useState('');
  const packageAbort = useRef<AbortController | null>(null);
  const [checkedAt, setCheckedAt] = useState<string | null>(null);
  const [integrityError, setIntegrityError] = useState('');
  const [retryAvailable, setRetryAvailable] = useState(false);
  const [, startAction] = useTransition();
  const alive = useRef(false);
  const sequence = useRef(0);
  const locked = useRef(false);
  const requestId = useRef<string | null>(null);
  const expectedRole = companyId ? role : 'customer';
  const canArchive = Boolean(companyId && ['owner', 'admin'].includes(role ?? ''));
  const busy = writing || checking || packaging || read.phase === 'loading';
  const verifiedNull = read.phase === 'ready' && read.archive === null;

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; sequence.current++; packageAbort.current?.abort(); };
  }, []);

  function matches(result: Extract<ContractArchiveResult, { ok: true }>) {
    if (!sameId(result.companyId, signing.companyId) || !sameId(result.signingId, signing.id) || !sameId(result.actorId, userId) || result.role !== expectedRole) return false;
    const archive = result.archive;
    return !archive || sameId(archive.companyId, signing.companyId) && sameId(archive.signingId, signing.id) && sameId(archive.dealId, signing.dealId) && sameId(archive.draftId, signing.draftId) && archive.draftVersion === signing.draftVersion && archive.signingRevision === signing.revision && archive.documentContentSha256 === signing.documentHash;
  }

  function invalidate() {
    setPackageHash(null);
    setCheckedAt(null);
    requestId.current = null;
    setRetryAvailable(false);
    setAcknowledged(false);
    setRead({ phase: 'unverified', archive: null });
  }

  function refresh() {
    if (locked.current) return;
    locked.current = true;
    const token = ++sequence.current;
    setCheckedAt(null); setIntegrityError(''); setPackageHash(null); setPackageError('');
    setRead({ phase: 'loading', archive: null });
    setReadError('');
    startAction(async () => {
      try {
        const result = await getContractArchiveAction({ signingId: signing.id, ...(companyId ? { companyId } : {}) });
        if (!alive.current || token !== sequence.current) return;
        if (!result.ok) {
          if (denied(result.code)) invalidate();
          else setRead({ phase: 'unverified', archive: null });
          setReadError(result.error);
          return;
        }
        if (!matches(result)) {
          invalidate();
          setReadError('Avtalets arkiv, konto eller behörighet kunde inte verifieras. Läs in avtalet igen.');
          return;
        }
        setRead({ phase: 'ready', archive: result.archive });
        if (result.archive) { requestId.current = null; setRetryAvailable(false); setAcknowledged(false); setActionError(''); }
      } catch {
        if (alive.current && token === sequence.current) { setRead({ phase: 'unverified', archive: null }); setReadError('Arkivstatus kunde inte hämtas. Försök igen.'); }
      } finally { locked.current = false; }
    });
  }

  function archive() {
    if (!companyId || !canArchive || !acknowledged || locked.current || (!verifiedNull && !retryAvailable)) return;
    let nonce = requestId.current;
    if (!nonce) {
      try { nonce = crypto.randomUUID(); }
      catch { setActionError('Webbläsaren kunde inte skapa en säker arkivbegäran. Läs in sidan igen.'); return; }
      requestId.current = nonce;
    }
    locked.current = true;
    const token = ++sequence.current;
    setWriting(true);
    setCheckedAt(null); setIntegrityError(''); setPackageHash(null); setPackageError('');
    setRead({ phase: 'unverified', archive: null });
    setReadError('');
    setActionError('');
    startAction(async () => {
      try {
        const result = await archiveContractAction({ companyId, signingId: signing.id, requestId: nonce });
        if (!alive.current || token !== sequence.current) return;
        if (!result.ok) {
          if (denied(result.code)) invalidate();
          else setRetryAvailable(true);
          setActionError(result.code === 'configuration_missing' ? `Originalarkivering är inte konfigurerad. ${result.error}` : result.error);
          return;
        }
        if (!result.archive || !matches(result)) {
          invalidate();
          setActionError('Arkiveringen kunde inte verifieras för det här avtalet och kontot. Kontrollera arkivstatus.');
          return;
        }
        requestId.current = null;
        setRetryAvailable(false);
        setAcknowledged(false);
        setRead({ phase: 'ready', archive: result.archive });
      } catch {
        if (alive.current && token === sequence.current) { setRetryAvailable(true); setActionError('Arkiveringen kunde inte bekräftas. Kontrollera status eller försök igen med samma begäran.'); }
      } finally {
        locked.current = false;
        if (alive.current && token === sequence.current) setWriting(false);
      }
    });
  }

  function verify() {
    const original = read.phase === 'ready' ? read.archive : null;
    if (!original || locked.current) return;
    locked.current = true;
    const token = ++sequence.current;
    setChecking(true); setCheckedAt(null); setIntegrityError(''); setPackageHash(null); setPackageError('');
    startAction(async () => {
      try {
        const result = await verifyContractArchiveAction({ signingId: signing.id, ...(companyId ? { companyId } : {}) });
        if (!alive.current || token !== sequence.current) return;
        if (!result.ok) { invalidate(); setIntegrityError(result.error); return; }
        const archive = result.archive;
        const sameArchive = archive && ['id','companyId','signingId','dealId','draftId','draftVersion','documentContentSha256','signingRevision','rendererVersion','evidenceSchemaVersion','archivedAt'].every(field => archive[field as keyof ArchivedContract] === original[field as keyof ArchivedContract]) && ['pdf','evidence'].every(file => {
          const key = file as 'pdf' | 'evidence';
          return ['objectPath','sha256','bytes','mimeType'].every(field => archive[key][field as keyof ArchivedContract['pdf']] === original[key][field as keyof ArchivedContract['pdf']]);
        });
        if (!matches(result) || !sameArchive || !result.checkedAt || !Number.isFinite(Date.parse(result.checkedAt))) {
          invalidate(); setIntegrityError('Originalfilerna kunde inte verifieras mot det registrerade avtalet och arkivet. Läs in arkivstatus igen.'); return;
        }
        setCheckedAt(result.checkedAt);
      } catch {
        if (alive.current && token === sequence.current) { invalidate(); setIntegrityError('Originalfilerna kunde inte kontrolleras. Läs in arkivstatus för att försöka igen.'); }
      } finally { locked.current = false; if (alive.current && token === sequence.current) setChecking(false); }
    });
  }

  async function downloadPackage() {
    const original = read.phase === 'ready' ? read.archive : null;
    if (!original || locked.current) return;
    locked.current = true;
    const token = ++sequence.current, controller = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => { timedOut = true; controller.abort(); if (alive.current && token === sequence.current) setPackageError('Hämtningen tog för lång tid. Försök igen eller uppdatera arkivstatus.'); }, 90_000);
    packageAbort.current = controller;
    setPackaging(true); setPackageHash(null); setPackageError('');
    const current = () => alive.current && token === sequence.current && !controller.signal.aborted;
    const digest = async (bytes: Uint8Array<ArrayBuffer>) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('');
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      const metadata = [original.id,original.companyId,original.signingId,original.dealId,original.draftId,original.draftVersion,original.documentContentSha256,original.signingRevision,original.rendererVersion,original.evidenceSchemaVersion,original.archivedAt,original.pdf.objectPath,original.pdf.sha256,original.pdf.bytes,original.pdf.mimeType,original.evidence.objectPath,original.evidence.sha256,original.evidence.bytes,original.evidence.mimeType];
      const metadataHash = await digest(new TextEncoder().encode(JSON.stringify(metadata)));
      if (!current()) return;
      const query = companyId ? `?companyId=${encodeURIComponent(companyId)}` : '';
      const response = await fetch(`/api/contract-signings/${encodeURIComponent(signing.id)}/archive-package${query}`, { method: 'GET', credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal: controller.signal });
      if (!current()) return;
      if (!response.ok) throw Error(response.status === 401 || response.status === 403 ? 'Din åtkomst till arkivpaketet kunde inte verifieras. Läs in avtalet igen.' : response.status === 409 ? 'Arkivpaketet kunde inte verifieras mot det aktuella originalet. Läs in arkivstatus igen.' : 'Arkivpaketet är tillfälligt otillgängligt. Läs in arkivstatus och försök igen.');
      const header = (name: string) => response.headers.get(`X-Archive-${name}`);
      const expectedFilename = `trafexa-avtalsarkiv-${signing.id}-${original.id}.tar`;
      const packageDigest = header('Package-SHA256'), byteText = header('Package-Bytes');
      const length = byteText && /^[1-9][0-9]*$/.test(byteText) ? Number(byteText) : 0;
      const contentLength = response.headers.get('Content-Length');
      if (header('Id') !== original.id || header('Signing-Id') !== signing.id || header('Company-Id') !== original.companyId || header('Actor-Id') !== userId || header('Actor-Role') !== expectedRole || header('Document-SHA256') !== original.documentContentSha256 || header('Metadata-SHA256') !== metadataHash || !packageDigest || !/^[a-f0-9]{64}$/.test(packageDigest) || !/^[a-f0-9]{64}$/.test(header('Manifest-SHA256') ?? '') || !Number.isSafeInteger(length) || length < 1 || length > 54 * 1024 * 1024 || contentLength !== null && contentLength !== byteText || response.headers.get('Content-Type') !== 'application/x-tar' || response.headers.get('Content-Disposition') !== `attachment; filename="${expectedFilename}"` || !response.body) throw Error('Arkivpaketets uppgifter kunde inte verifieras för aktuellt avtal och konto. Läs in arkivstatus igen.');
      reader = response.body.getReader();
      const parts: Uint8Array[] = []; let size = 0;
      while (true) {
        const part = await reader.read();
        if (!current()) return;
        if (part.done) break;
        size += part.value.byteLength;
        if (size > length || size > 54 * 1024 * 1024) throw Error('Arkivpaketets storlek stämmer inte med det verifierade underlaget. Läs in arkivstatus igen.');
        parts.push(part.value);
      }
      if (size !== length) throw Error('Arkivpaketet kunde inte hämtas fullständigt. Läs in arkivstatus och försök igen.');
      const bytes = new Uint8Array(size); let offset = 0;
      for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
      const actualDigest = await digest(bytes);
      if (!current()) return;
      if (actualDigest !== packageDigest) throw Error('Arkivpaketets kontrollsumma stämmer inte. Läs in arkivstatus igen.');
      const link = document.createElement('a'), url = URL.createObjectURL(new Blob([bytes], { type: 'application/x-tar' }));
      try { link.href = url; link.download = expectedFilename; document.body.append(link); link.click(); setPackageHash(actualDigest); }
      finally { link.remove(); setTimeout(() => URL.revokeObjectURL(url), 0); }
    } catch (error) {
      if (alive.current && token === sequence.current) {
        if (!controller.signal.aborted) invalidate();
        setPackageError(controller.signal.aborted ? timedOut ? 'Hämtningen tog för lång tid. Försök igen eller uppdatera arkivstatus.' : 'Hämtningen av arkivpaketet avbröts.' : error instanceof Error && (error.message.startsWith('Arkivpaket') || error.message.startsWith('Din åtkomst')) ? error.message : 'Arkivpaketet kunde inte hämtas. Läs in arkivstatus och försök igen.');
      }
    } finally {
      clearTimeout(timeout);
      if (reader) { try { await reader.cancel(); } catch {} reader.releaseLock(); }
      locked.current = false;
      if (alive.current && token === sequence.current) { packageAbort.current = null; setPackaging(false); }
    }
  }

  const query = companyId ? `?companyId=${encodeURIComponent(companyId)}` : '';
  const base = `/api/contract-signings/${encodeURIComponent(signing.id)}`;
  const stored = read.phase === 'ready' ? read.archive : null;
  return <details onToggle={event => { if (event.currentTarget.open && read.phase === 'idle') refresh(); }}>
    <summary>Originalarkiv för färdigsignerat avtal</summary>
    <section aria-label="Avtalets originalarkiv" style={{ marginTop: 14, minWidth: 0, overflowWrap: 'anywhere' }}>
      {read.phase === 'idle' ? <p>Öppna panelen för att kontrollera arkivstatus.</p> : null}
      {read.phase === 'loading' ? <p role="status">Kontrollerar originalarkivet…</p> : null}
      {checking ? <p role="status">Kontrollerar originalfilerna…</p> : null}
      {packaging ? <p role="status">Hämtar och kontrollerar arkivpaketet…</p> : null}
      {writing ? <p role="status">Arkiverar avtalsoriginal och signeringsbevis…</p> : null}
      {stored ? <><p role="status"><strong>Originalet är arkiverat.</strong><br/>Arkiverat {new Date(stored.archivedAt).toLocaleString('sv-SE')}.</p><p style={{marginBlock:12}}>Arkivregistreringen visar vilka originalfiler som sparats. Filernas integritet kontrolleras separat när du begär det.</p>{checkedAt ? <p role="status" style={{marginBlock:12}}><strong>Originalfilernas integritet är kontrollerad.</strong><br/>Senast kontrollerat <time dateTime={checkedAt}>{new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Stockholm', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(checkedAt))}</time> (svensk tid). Kontrollen gäller de sparade filerna vid den tidpunkten.</p> : <p style={{marginBlock:12}}>Du kan även kontrollera originalfilerna separat utan att hämta paketet.</p>}<button type="button" className="button button-outline" style={{maxWidth:'100%',whiteSpace:'normal',marginBlock:12}} disabled={busy} onClick={verify}>Kontrollera originalfilerna</button><div style={{marginBlock:16}}><p>Paketet innehåller PDF-originalet, signeringsbeviset och kontrollunderlag för separat förvaring.</p><button type="button" className="button button-outline" style={{maxWidth:'100%',whiteSpace:'normal',marginBlock:12}} disabled={busy} onClick={()=>void downloadPackage()}>Hämta arkivpaket</button>{packaging ? <button type="button" className="button button-outline" style={{maxWidth:'100%',whiteSpace:'normal',marginBlock:12}} onClick={()=>{packageAbort.current?.abort();setPackageError('Hämtningen av arkivpaketet avbröts.');}}>Avbryt hämtningen</button> : null}{packageHash ? <><p role="status">Arkivpaketet är kontrollerat och nedladdningen har startats. Spara paketet och kontrollsumman separat enligt era lagringsrutiner.</p><label style={{marginTop:12,fontSize:13}}>Arkivpaketets SHA-256<textarea aria-label="Arkivpaketets SHA-256" readOnly rows={3} value={packageHash} spellCheck={false} style={{maxWidth:'100%',fontFamily:'monospace'}}/></label></> : null}</div><p className="form-note">PDF SHA-256: <span style={{ wordBreak: 'break-all' }}>{stored.pdf.sha256}</span><br/>Signeringsbevis SHA-256: <span style={{ wordBreak: 'break-all' }}>{stored.evidence.sha256}</span></p><p><a href={`${base}/pdf${query}`} download>Hämta arkiverat avtalsoriginal (PDF)</a><br/><a href={`${base}/evidence${query}`} download>Hämta arkiverat signeringsbevis</a></p></> : null}
      {verifiedNull ? <><p><strong>Originalet har inte arkiverats.</strong> Kopiorna nedan genereras när de hämtas.</p><p><a href={`${base}/pdf${query}`} download>Hämta genererad PDF-kopia av signerat avtal</a><br/><a href={`${base}/evidence${query}`} download>Hämta genererad kopia av signeringsbevis</a></p></> : null}
      {read.phase === 'unverified' && !writing ? <p>Arkivstatus är inte verifierad. Kontrollera status innan du hämtar originalet.</p> : null}
      {readError ? <p role="alert">{readError}</p> : null}
      {packageError ? <p role="alert">{packageError}</p> : null}
      {integrityError ? <p role="alert">{integrityError}</p> : null}
      {actionError ? <p role="alert">{actionError}</p> : null}
      {canArchive && (verifiedNull || retryAvailable) ? <div className="workspace-form" style={{ marginTop: 14 }}><label htmlFor={confirmationId} style={{ display: 'flex', flexDirection: 'row', gap: 8 }}><input id={confirmationId} type="checkbox" checked={acknowledged} disabled={busy} onChange={event => setAcknowledged(event.target.checked)} style={{ width: 'auto' }}/><span>Jag vill arkivera det färdigsignerade avtalet och signeringsbeviset som original.</span></label><button type="button" className="button button-green" disabled={busy || !acknowledged} onClick={archive}>{retryAvailable ? 'Försök arkivera original igen' : 'Arkivera avtalets original'}</button></div> : null}
      {read.phase !== 'idle' ? <button type="button" className="button button-outline" style={{ marginTop: 14,maxWidth:'100%',whiteSpace:'normal' }} disabled={busy} onClick={refresh}>Kontrollera arkivstatus</button> : null}
    </section>
  </details>;
}
