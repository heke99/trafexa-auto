'use client';
import { AuthShell } from '@/components/auth-shell';
export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <AuthShell title="Det gick inte att hämta sidan." subtitle="Försök igen. Om problemet kvarstår, kontakta Trafexa."><button className="button primary" onClick={() => reset()}>Försök igen</button><a className="text-link" href="/dashboard">Till översikten</a></AuthShell>;
}
