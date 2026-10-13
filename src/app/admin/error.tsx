'use client';

export default function AdminError({ reset }: { reset: () => void }) {
  return <main className="wrap workspace-main"><div className="empty-state"><h1>Administrationen kunde inte öppnas</h1><p>Behörighet och information måste kunna verifieras innan sidan visas.</p><button type="button" className="button button-green" onClick={reset}>Försök igen</button><a className="text-link" href="mailto:info@trafexa.com">Kontakta Trafexa</a></div></main>;
}
