'use client';

import { useEffect, useRef, useState, useTransition, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { createCompanyWithProfileAction } from '@/lib/data/company-store-profile-actions';
import type { CompanyStoreFields } from '@/lib/company-store-profile/types';
import { normalizeApplicationOrganisationNumber } from '@/lib/web-applications/validation';
import { blankStoreFields, normalizeStoreFields, sameStoreFields, StoreAcknowledgement, StoreFieldsEditor, StoreFieldsSummary } from './company-store-profile';

type Props = { userId: string; loginEmail: string };
type Review = { legalName: string; organisationNumber: string; fields: CompanyStoreFields };
export function CompanyOnboarding(props: Props) { return <OnboardingForm key={props.userId} {...props}/>; }
function OnboardingForm({ userId, loginEmail }: Props) {
  const router = useRouter();
  const [legalName, setLegalName] = useState(''), [organisationNumber, setOrganisationNumber] = useState('');
  const [fields, setFields] = useState<CompanyStoreFields>(blankStoreFields);
  const [review, setReview] = useState<Review | null>(null), [acknowledged, setAcknowledged] = useState(false);
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [, startAction] = useTransition();
  const alive = useRef(false), locked = useRef(false), requests = useRef(new Map<string, string>());
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { if (review) heading.current?.focus(); }, [review]);
  function prepare(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy || !event.currentTarget.reportValidity()) return;
    try { setReview({ legalName: legalName.trim(), organisationNumber: normalizeApplicationOrganisationNumber(organisationNumber), fields: normalizeStoreFields(fields) }); setAcknowledged(false); setError(''); }
    catch (error) { setError(error instanceof Error ? error.message : 'Kontrollera företags- och butiksuppgifterna.'); }
  }
  function confirm() {
    if (!review || !acknowledged || locked.current) return;
    const confirmed = review, values = { ...confirmed, representationAcknowledged: true }, fingerprint = JSON.stringify(values);
    let requestId = requests.current.get(fingerprint);
    if (!requestId) { try { requestId = crypto.randomUUID(); } catch { setError('Webbläsaren kunde inte skapa en säker begäran. Läs in sidan igen.'); return; } requests.current.set(fingerprint, requestId); }
    const nonce = requestId;
    locked.current = true; setBusy(true); setError('');
    startAction(async () => {
      try {
        const result = await createCompanyWithProfileAction({ ...values, requestId: nonce });
        if (!alive.current) return;
        if (!result.ok) {
          if (['unauthenticated', 'access_denied'].includes(result.code)) { setReview(null); setAcknowledged(false); setFields(blankStoreFields()); setLegalName(''); setOrganisationNumber(''); requests.current.clear(); }
          setError(result.error); return;
        }
        if (result.actorId.toLowerCase() !== userId.toLowerCase() || !['owner', 'admin'].includes(result.role) || result.requestId !== nonce || result.profile.companyId !== result.companyId || result.profile.version !== 1 || result.source.companyId !== result.companyId || result.source.profileId !== result.profile.id || result.source.profileVersion !== 1 || result.source.legalName !== confirmed.legalName || result.source.organisationNumber !== confirmed.organisationNumber || !sameStoreFields(result.profile.fields, confirmed.fields) || !sameStoreFields(result.source.shop, confirmed.fields)) { setError('Företagskontot och butiksprofilen kunde inte verifieras. Kontrollera dina företagsmedlemskap innan du försöker igen.'); return; }
        requests.current.delete(fingerprint); router.push('/settings');
      } catch { if (alive.current) setError('Företagskontot kunde inte bekräftas. Försök igen med samma granskade uppgifter och begäran.'); }
      finally { locked.current = false; if (alive.current) setBusy(false); }
    });
  }
  return <section aria-label="Skapa företag och butiksprofil" style={{ minWidth: 0, overflowWrap: 'anywhere' }}><p>Inloggningsmejl: <strong>{loginEmail}</strong>. Butikens publika kontaktuppgifter anges separat nedan.</p><p>Du kan skapa ytterligare ett företag även om du redan har ett företagsmedlemskap. Varje företag får sin egen butiksprofil.</p>{error ? <p role="alert" className="notice error">{error}</p> : null}{busy ? <p role="status">Skapar granskat företagskonto och butiksprofil…</p> : null}
    {!review ? <form onSubmit={prepare} className="workspace-form"><h2>Bolagsuppgifter</h2><label>Juridiskt företagsnamn<input value={legalName} required minLength={2} maxLength={160} autoComplete="organization" disabled={busy} onChange={event => setLegalName(event.target.value)}/></label><label>Organisationsnummer<input value={organisationNumber} required inputMode="numeric" maxLength={13} autoComplete="off" disabled={busy} placeholder="559000-0000" onChange={event => setOrganisationNumber(event.target.value)}/></label><h2>Butikens publika uppgifter</h2><StoreFieldsEditor fields={fields} disabled={busy} onChange={setFields}/><button type="submit" className="button button-green" disabled={busy}>Granska företag och butiksprofil</button></form> : <section className="workspace-form" aria-labelledby="company-onboarding-review"><h2 id="company-onboarding-review" ref={heading} tabIndex={-1}>Granska nytt företagskonto och butiksprofil</h2><p>Juridiskt företagsnamn: <strong>{review.legalName}</strong><br/>Organisationsnummer: {review.organisationNumber}</p><StoreFieldsSummary fields={review.fields}/><p>Företagskonto, ägarmedlemskap och granskad butiksprofil sparas tillsammans i Trafexa. Ingen extern butik eller API-anslutning skapas.</p><StoreAcknowledgement checked={acknowledged} disabled={busy} onChange={setAcknowledged}>Jag har rätt att företräda företaget och har granskat bolagsuppgifterna och butikens publika uppgifter. Jag vill skapa företagskontot och butiksprofilen.</StoreAcknowledgement><button type="button" className="button button-green" disabled={busy || !acknowledged} onClick={confirm}>Bekräfta och skapa företagskonto</button><button type="button" className="button button-outline" disabled={busy} onClick={() => { setReview(null); setAcknowledged(false); }}>Tillbaka och ändra</button></section>}
  </section>;
}
