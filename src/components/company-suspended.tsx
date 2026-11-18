import Link from 'next/link';
import {AuthShell} from './auth-shell';
import {AuthSubmit} from './auth-submit';
import {signOutAction} from '@/lib/data/actions';
export function CompanySuspended(){return <AuthShell title="Företagets åtkomst är avstängd." subtitle="Ditt konto är inloggat, men företaget har inte åtkomst till arbetsytan just nu."><p>Kontakta Trafexa för hjälp med företagets åtkomst. Företagets uppgifter finns kvar och visas när åtkomsten är återställd.</p><p><a href="mailto:info@trafexa.com">info@trafexa.com</a></p><Link className="button button-outline" href="/dashboard">Kontrollera åtkomst igen</Link><form action={signOutAction}><AuthSubmit pendingLabel="Loggar ut…" className="text-link">Logga ut</AuthSubmit></form></AuthShell>;}
