'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { bindBlocketCompanyAction, configureBlocketGroupAction, disableBlocketCompanyAction, getPlatformBlocketProvisioningAction } from '@/lib/blocket-provisioning/actions';
import { parseBindBlocketCompanyInput, parseBlocketBindingReceipt, parseBlocketGroupReceipt, parseBlocketProvisioningPage, parseConfigureBlocketGroupInput, parseDisableBlocketCompanyInput } from '../lib/blocket-provisioning/validation';
import type { BindBlocketCompanyInput, BlocketGroup, BlocketProvisioningPage, ConfigureBlocketGroupInput, DisableBlocketCompanyInput } from '../lib/blocket-provisioning/types';

type Props = { companyId: string; userId: string; onAccessDenied?: (message: string) => void };
type Review = { kind: 'group'; input: ConfigureBlocketGroupInput } | { kind: 'bind'; input: BindBlocketCompanyInput } | { kind: 'disable'; input: DisableBlocketCompanyInput };
const blankGroup = () => ({ id: '', version: 0, groupReference: '', credentialReference: '', scope: 'dealer_group' as BlocketGroup['scope'], status: 'active' as BlocketGroup['status'], reason: '' });
const dateLabel = (value: string) => new Intl.DateTimeFormat('sv-SE', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));

export function BlocketProvisioning(props: Props) { return <BlocketProvisioningPanel key={`${props.companyId}:${props.userId}`} {...props}/>; }

function BlocketProvisioningPanel({ companyId, userId, onAccessDenied }: Props) {
  const [open, setOpen] = useState(false), [page, setPage] = useState<BlocketProvisioningPage | null>(null);
  const [loading, setLoading] = useState(false), [pending, startTransition] = useTransition();
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [denied, setDenied] = useState(false), [needsRefresh, setNeedsRefresh] = useState(false);
  const [groupForm, setGroupForm] = useState(blankGroup), [bindForm, setBindForm] = useState({ groupId: '', dealerCode: '', evidenceReference: '', validUntil: '', reason: '' }), [disableReason, setDisableReason] = useState('');
  const [review, setReview] = useState<Review | null>(null), [ack, setAck] = useState(false);
  const generation = useRef(0), busy = useRef(false), intent = useRef<{ fingerprint: string; requestId: string } | null>(null), heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => () => { ++generation.current; }, []);
  useEffect(() => { if (review) heading.current?.focus(); }, [review]);

  function reject(result: { code: string; error: string }) {
    setError(result.error);
    if (result.code === 'access_denied') { ++generation.current; setDenied(true); setPage(null); setReview(null); intent.current = null; onAccessDenied?.(result.error); }
    if (result.code === 'conflict') setNeedsRefresh(true);
  }
  async function load(append = false) {
    if (busy.current || denied) return;
    const key = append ? page?.nextPageKey ?? null : null, current = ++generation.current;
    setLoading(true); setError(''); if (!append) setNeedsRefresh(true);
    try {
      const response = await getPlatformBlocketProvisioningAction({ companyId, pageKey: key, limit: 50 });
      if (generation.current !== current) return;
      if (!response.ok) { reject(response); return; }
      const { ok: _ok, ...raw } = response;
      const next = parseBlocketProvisioningPage(raw, userId, { companyId, pageKey: key, limit: 50 });
      setPage(previous => append && previous ? { ...next, groups: [...previous.groups, ...next.groups.filter(group => !previous.groups.some(old => old.id === group.id))] } : next);
      if (!append) { setNeedsRefresh(false); setReview(null); setAck(false); intent.current = null; }
    } catch { if (generation.current === current) setError('Aktuellt Blocketunderlag kunde inte verifieras. Försök läsa in igen.'); }
    finally { if (generation.current === current) setLoading(false); }
  }
  useEffect(() => { if (open && !page && !loading && !denied) void load(); }, [open]);
  function nextRequest(payload: unknown) {
    const fingerprint = JSON.stringify(payload);
    if (!intent.current || intent.current.fingerprint !== fingerprint) intent.current = { fingerprint, requestId: crypto.randomUUID() };
    return intent.current.requestId;
  }
  function reviewGroup() {
    try {
      const groupId = groupForm.id || crypto.randomUUID();
      const payload = { groupId, expectedVersion: groupForm.version, groupReference: groupForm.groupReference, credentialReference: groupForm.credentialReference, scope: groupForm.scope, status: groupForm.status, reason: groupForm.reason, acknowledged: true };
      const input = parseConfigureBlocketGroupInput({ ...payload, requestId: nextRequest({ kind: 'group', ...payload }) });
      setGroupForm(previous => ({ ...previous, id: groupId })); setReview({ kind: 'group', input }); setAck(false); setError(''); setNotice('');
    } catch { setError('Kontrollera gruppuppgifterna. Nyckelreferensen får bara innehålla a–z, siffror, understreck och bindestreck. Klistra inte in en token eller API-nyckel.'); }
  }
  function reviewBinding() {
    try {
      const group = page?.groups.find(item => item.id === bindForm.groupId);
      if (!page || !group || group.status !== 'active') throw Error();
      const validUntil = new Date(bindForm.validUntil).toISOString(), deadline = Date.parse(validUntil), now = Date.now();
      if (deadline <= now || deadline > now + 90 * 86400000) throw Error();
      const payload = { companyId, groupId: group.id, expectedGroupVersion: group.version, expectedConnectionVersion: page.connectionVersion, dealerCode: bindForm.dealerCode, evidenceReference: bindForm.evidenceReference, validUntil, reason: bindForm.reason, acknowledged: true };
      setReview({ kind: 'bind', input: parseBindBlocketCompanyInput({ ...payload, requestId: nextRequest({ kind: 'bind', ...payload }) }) }); setAck(false); setError(''); setNotice('');
    } catch { setError('Välj en aktiv grupp, fyll i underlag och välj en framtida giltighetstid inom 90 dagar.'); }
  }
  function reviewDisable() {
    try {
      if (!page?.binding) throw Error();
      const payload = { companyId, expectedConnectionVersion: page.connectionVersion, reason: disableReason, acknowledged: true };
      setReview({ kind: 'disable', input: parseDisableBlocketCompanyInput({ ...payload, requestId: nextRequest({ kind: 'disable', ...payload }) }) }); setAck(false); setError(''); setNotice('');
    } catch { setError('Fyll i en motivering och läs in den aktuella kopplingen.'); }
  }
  function confirm() {
    if (!review || !ack || busy.current || needsRefresh || denied) return;
    const submitted = review, current = generation.current;
    busy.current = true; setError('');
    startTransition(async () => {
      try {
        const response = submitted.kind === 'group' ? await configureBlocketGroupAction(submitted.input) : submitted.kind === 'bind' ? await bindBlocketCompanyAction(submitted.input) : await disableBlocketCompanyAction(submitted.input);
        if (current !== generation.current) return;
        if (!response.ok) { reject(response); return; }
        const { ok: _ok, ...raw } = response;
        if (submitted.kind === 'group') parseBlocketGroupReceipt(raw, userId, submitted.input); else parseBlocketBindingReceipt(raw, userId, submitted.input);
        setNotice('Ändringen är registrerad. Aktuellt underlag läses in.'); setReview(null); setAck(false); intent.current = null;
        if (submitted.kind === 'group') setGroupForm(blankGroup());
        setPage(null); busy.current = false; await load();
      } catch { if (current === generation.current) setError('Resultatet kunde inte bekräftas. Försök igen med samma uppgifter och begäran.'); }
      finally { busy.current = false; }
    });
  }
  const disabled = pending || loading || denied || needsRefresh || review !== null;
  return <details className="surface" open={open} onToggle={event => setOpen(event.currentTarget.open)} style={{ marginTop: 16, overflowWrap: 'anywhere' }}>
    <summary>Blocketgrupp och företagskoppling</summary>
    {open && <div className="dialog-content" aria-busy={pending || loading}>
      <p>Grupper och återförsäljarkoder registreras från manuellt granskat underlag. En sparad koppling bevisar inte att en nyckel fungerar eller att en butik har skapats hos Blocket. Inga partneranrop görs här.</p>
      {error && <p className="form-error" role="alert">{error}</p>}{notice && <p className="notice" role="status">{notice}</p>}
      {!denied && <button type="button" className="text-link" disabled={pending || loading} onClick={() => void load()}>Läs in aktuellt Blocketunderlag</button>}
      {loading && <p role="status">Verifierar underlag…</p>}
      {!denied && page && <>
        <h3>{page.legalName} · {page.organisationNumber}</h3>
        <p>{page.binding ? `${page.binding.status === 'verified' ? 'Manuellt verifierat underlag' : 'Spärrad eller inte längre giltig koppling'} · återförsäljarkod ${page.binding.dealerCode} · giltig till ${dateLabel(page.binding.validUntil)}` : 'Ingen manuellt verifierad koppling finns.'}</p>
        <h3>Blocketgrupper</h3><p>En grupp kan användas av flera företag. Gruppändringar påverkar kopplingar som använder gruppen. Nyckelreferensen är en etikett för serverkonfigurationen, aldrig själva nyckeln.</p>
        <ul>{page.groups.map(group => <li key={group.id}><strong>{group.groupReference}</strong> · version {group.version} · {group.status === 'active' ? 'Aktiv grupp' : 'Spärrad grupp'} · {group.scope === 'dealer_group' ? 'Återförsäljargrupp' : 'Enskild återförsäljare'} · nyckelreferens {group.credentialReference} <button type="button" className="text-link" disabled={disabled} onClick={() => { setGroupForm({ ...group, reason: '' }); intent.current = null; }}>Redigera grupp {group.groupReference}</button></li>)}</ul>
        {page.nextPageKey && <button type="button" className="text-link" disabled={pending || loading || review !== null} onClick={() => void load(true)}>Läs in fler grupper</button>}
        <form className="workspace-form" onSubmit={event => { event.preventDefault(); if (event.currentTarget.reportValidity()) reviewGroup(); }}>
          <fieldset disabled={disabled}><legend>{groupForm.version ? 'Ändra Blocketgrupp' : 'Ny Blocketgrupp'}</legend>
            <label>Gruppreferens<input required maxLength={160} value={groupForm.groupReference} onChange={event => setGroupForm(old => ({ ...old, groupReference: event.target.value }))}/></label>
            <label>Serverns nyckelreferens (etikett)<input required maxLength={100} pattern="[a-z0-9_-]+" autoComplete="off" value={groupForm.credentialReference} onChange={event => setGroupForm(old => ({ ...old, credentialReference: event.target.value }))}/></label>
            <label>Nyckelns bekräftade omfattning<select value={groupForm.scope} onChange={event => setGroupForm(old => ({ ...old, scope: event.target.value as BlocketGroup['scope'] }))}><option value="dealer_group">Återförsäljargrupp</option><option value="dealer_code">Enskild återförsäljare</option></select></label>
            <label>Gruppstatus<select value={groupForm.status} onChange={event => setGroupForm(old => ({ ...old, status: event.target.value as BlocketGroup['status'] }))}><option value="active">Aktiv</option><option value="disabled">Spärrad</option></select></label>
            <label>Motivering för gruppändring<input required maxLength={500} value={groupForm.reason} onChange={event => setGroupForm(old => ({ ...old, reason: event.target.value }))}/></label>
            <button type="submit" className="button button-outline">Granska gruppändring</button>{groupForm.version > 0 && <button type="button" className="text-link" onClick={() => { setGroupForm(blankGroup()); intent.current = null; }}>Ny grupp</button>}
          </fieldset>
        </form>
        <form className="workspace-form" onSubmit={event => { event.preventDefault(); if (event.currentTarget.reportValidity()) reviewBinding(); }}>
          <fieldset disabled={disabled}><legend>Verifiera företagets koppling manuellt</legend>
            <label>Aktiv Blocketgrupp<select aria-label="Aktiv Blocketgrupp" required value={bindForm.groupId} onChange={event => setBindForm(old => ({ ...old, groupId: event.target.value }))}><option value="">Välj grupp</option>{page.groups.filter(group => group.status === 'active').map(group => <option key={group.id} value={group.id}>{group.groupReference} · version {group.version}</option>)}</select></label>
            <label>Blockets återförsäljarkod<input required maxLength={160} value={bindForm.dealerCode} onChange={event => setBindForm(old => ({ ...old, dealerCode: event.target.value }))}/></label>
            <label>Referens till granskat behörighetsunderlag<input required maxLength={500} value={bindForm.evidenceReference} onChange={event => setBindForm(old => ({ ...old, evidenceReference: event.target.value }))}/></label>
            <label>Giltig till (din lokala tid, högst 90 dagar)<input type="datetime-local" required value={bindForm.validUntil} onChange={event => setBindForm(old => ({ ...old, validUntil: event.target.value }))}/></label>
            <label>Motivering för företagskoppling<input required maxLength={500} value={bindForm.reason} onChange={event => setBindForm(old => ({ ...old, reason: event.target.value }))}/></label>
            <button type="submit" className="button button-outline">Granska företagskoppling</button>
          </fieldset>
        </form>
        {page.binding && <form className="workspace-form" onSubmit={event => { event.preventDefault(); if (event.currentTarget.reportValidity()) reviewDisable(); }}><fieldset disabled={disabled}><legend>Spärra företagets koppling</legend><label>Motivering för spärr<input required maxLength={500} value={disableReason} onChange={event => setDisableReason(event.target.value)}/></label><button type="submit" className="button button-outline">Granska spärr</button></fieldset></form>}
        {review && <section aria-labelledby="blocket-provisioning-review"><h3 id="blocket-provisioning-review" ref={heading} tabIndex={-1}>Granska {review.kind === 'group' ? 'gruppändring' : review.kind === 'bind' ? 'företagskoppling' : 'spärr'}</h3>
          <dl><dt>Företag</dt><dd>{page.legalName} · {page.organisationNumber}</dd>{review.kind === 'group' ? <><dt>Grupp och version</dt><dd>{review.input.groupReference} · {review.input.expectedVersion} → {review.input.expectedVersion + 1}</dd><dt>Nyckelreferens</dt><dd>{review.input.credentialReference}</dd><dt>Omfattning och status</dt><dd>{review.input.scope === 'dealer_group' ? 'Återförsäljargrupp' : 'Enskild återförsäljare'} · {review.input.status === 'active' ? 'Aktiv' : 'Spärrad'}</dd></> : <><dt>Kopplingsversion</dt><dd>{review.input.expectedConnectionVersion} → {review.input.expectedConnectionVersion + 1}</dd>{review.kind === 'bind' && <><dt>Grupp och version</dt><dd>{page.groups.find(group => group.id === review.input.groupId)?.groupReference} · version {review.input.expectedGroupVersion}</dd><dt>Återförsäljarkod</dt><dd>{review.input.dealerCode}</dd><dt>Underlagsreferens</dt><dd>{review.input.evidenceReference}</dd><dt>Giltig till</dt><dd>{dateLabel(review.input.validUntil)}</dd></>}</>}<dt>Motivering</dt><dd>{review.input.reason}</dd></dl>
          <label className="checkbox-label"><input type="checkbox" checked={ack} disabled={pending || needsRefresh} onChange={event => setAck(event.target.checked)}/>Jag har granskat omfattningen och det manuella underlaget. Ändringen ska registreras.</label>
          <button type="button" className="button button-green" disabled={!ack || pending || needsRefresh} onClick={confirm}>Bekräfta {review.kind === 'group' ? 'gruppändring' : review.kind === 'bind' ? 'företagskoppling' : 'spärr'}</button>
          <button type="button" className="text-link" disabled={pending} onClick={() => { setReview(null); setAck(false); }}>Ändra uppgifter</button>
        </section>}
      </>}
    </div>}
  </details>;
}
