'use client';

export default function InvitationsError({ reset }: { reset: () => void }) {
  return <main className="wrap workspace-main"><div className="empty-state"><h1>Inbjudningarna kunde inte öppnas</h1><p>Vi behöver kunna verifiera ditt konto innan dina inbjudningar visas.</p><button type="button" className="button button-green" onClick={reset}>Försök igen</button><a className="text-link" href="mailto:info@trafexa.com">Kontakta Trafexa</a></div></main>;
}
