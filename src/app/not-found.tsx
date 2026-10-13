import Link from 'next/link';
import { AuthShell } from '@/components/auth-shell';
export default function NotFound() { return <AuthShell title="Här finns ingen sida." subtitle="Adressen kan ha ändrats när Trafexa byggdes om."><p className="eyebrow">404</p><Link className="button primary" href="/">Till startsidan</Link></AuthShell>; }
