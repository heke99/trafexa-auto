'use client';

import { useEffect, useId, useRef, useState, useTransition } from 'react';
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
  const key = [props.signing.id, props.signing.documentHash, props.signing.revision, props.companyId ?? 'customer', props.userId, props.role ?? 'customer'].join(':');
  return <ArchivePanel key={key} {...props} />;
}

function ArchivePanel({ signing, companyId, userId, role }: Props) {
  const confirmationId = useId();
  const [read, setRead] = useState<ReadState>({ phase: 'idle', archive: null });
  const [readError, setReadError] = useState('');
  const [actionError, setActionError] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const [writing, setWriting] = useState(false);
  const [retryAvailable, setRetryAvailable] = useState(false);
  const [, startAction] = useTransition();
  const alive = useRef(false);
  const sequence = useRef(0);
  const locked = useRef(false);
  const requestId = useRef<string | null>(null);
  const expectedRole = companyId ? role : 'customer';
  const canArchive = Boolean(companyId && ['owner', 'admin'].includes(role ?? ''));
  const busy = writing || read.phase === 'loading';
  const verifiedNull = read.phase === 'ready' && read.archive === null;

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; sequence.current++; };
  }, []);

  function matches(result: Extract<ContractArchiveResult, { ok: true }>) {
    if (!sameId(result.companyId, signing.companyId) || !sameId(result.signingId, signing.id) || !sameId(result.actorId, userId) || result.role !== expectedRole) return false;
    const archive = result.archive;
    return !archive || sameId(archive.companyId, signing.companyId) && sameId(archive.signingId, signing.id) && sameId(archive.dealId, signing.dealId) && sameId(archive.draftId, signing.draftId) && archive.draftVersion === signing.draftVersion && archive.signingRevision === signing.revision && archive.documentContentSha256 === signing.documentHash;
  }

  function invalidate() {
    requestId.current = null;
    setRetryAvailable(false);
    setAcknowledged(false);
    setRead({ phase: 'unverified', archive: null });
  }

  function refresh() {
    if (locked.current) return;
    locked.current = true;
    const token = ++sequence.current;
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

  const query = companyId ? `?companyId=${encodeURIComponent(companyId)}` : '';
  const base = `/api/contract-signings/${encodeURIComponent(signing.id)}`;
  const stored = read.phase === 'ready' ? read.archive : null;
  return <details onToggle={event => { if (event.currentTarget.open && read.phase === 'idle') refresh(); }}>
    <summary>Originalarkiv för färdigsignerat avtal</summary>
    <section aria-label="Avtalets originalarkiv" style={{ marginTop: 14, minWidth: 0, overflowWrap: 'anywhere' }}>
      {read.phase === 'idle' ? <p>Öppna panelen för att kontrollera arkivstatus.</p> : null}
      {read.phase === 'loading' ? <p role="status">Kontrollerar originalarkivet…</p> : null}
      {writing ? <p role="status">Arkiverar avtalsoriginal och signeringsbevis…</p> : null}
      {stored ? <><p role="status"><strong>Originalet är arkiverat.</strong><br/>Arkiverat {new Date(stored.archivedAt).toLocaleString('sv-SE')}.</p><p className="form-note">PDF SHA-256: <span style={{ wordBreak: 'break-all' }}>{stored.pdf.sha256}</span><br/>Signeringsbevis SHA-256: <span style={{ wordBreak: 'break-all' }}>{stored.evidence.sha256}</span></p><p><a href={`${base}/pdf${query}`} download>Hämta arkiverat avtalsoriginal (PDF)</a><br/><a href={`${base}/evidence${query}`} download>Hämta arkiverat signeringsbevis</a></p></> : null}
      {verifiedNull ? <><p><strong>Originalet har inte arkiverats.</strong> Kopiorna nedan genereras när de hämtas.</p><p><a href={`${base}/pdf${query}`} download>Hämta genererad PDF-kopia av signerat avtal</a><br/><a href={`${base}/evidence${query}`} download>Hämta genererad kopia av signeringsbevis</a></p></> : null}
      {read.phase === 'unverified' && !writing ? <p>Arkivstatus är inte verifierad. Kontrollera status innan du hämtar originalet.</p> : null}
      {readError ? <p role="alert">{readError}</p> : null}
      {actionError ? <p role="alert">{actionError}</p> : null}
      {canArchive && (verifiedNull || retryAvailable) ? <div className="workspace-form" style={{ marginTop: 14 }}><label htmlFor={confirmationId} style={{ display: 'flex', flexDirection: 'row', gap: 8 }}><input id={confirmationId} type="checkbox" checked={acknowledged} disabled={busy} onChange={event => setAcknowledged(event.target.checked)} style={{ width: 'auto' }}/><span>Jag vill arkivera det färdigsignerade avtalet och signeringsbeviset som original.</span></label><button type="button" className="button button-green" disabled={busy || !acknowledged} onClick={archive}>{retryAvailable ? 'Försök arkivera original igen' : 'Arkivera avtalets original'}</button></div> : null}
      {read.phase !== 'idle' ? <button type="button" className="button button-outline" style={{ marginTop: 14 }} disabled={busy} onClick={refresh}>Kontrollera arkivstatus</button> : null}
    </section>
  </details>;
}
