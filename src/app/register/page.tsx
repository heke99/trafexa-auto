import Link from 'next/link';
import { signupAction } from '@/lib/data/actions';
import { safeNextPath } from '@/lib/routing.mjs';
import { AuthShell } from '@/components/auth-shell';
export const metadata={title:'Skapa konto',robots:{index:false,follow:false}};
export default async function RegisterPage({searchParams}:{searchParams:Promise<{error?:string;next?:string}>}) {
 const query=await searchParams;const nextPath=safeNextPath(query.next);
 return <AuthShell title="Skapa ditt konto." subtitle="Skapa ditt Trafexakonto och bekräfta e-postadressen. Därefter granskar Trafexa din registrering. Du får tillgång till systemet först när en administratör godkänt kontot.">
 {query.error?<p className="notice error" role="alert">{query.error}</p>:null}
 <form action={signupAction}><input type="hidden" name="next" value={nextPath}/><label>E-post<input required type="email" name="email" autoComplete="email" maxLength={254}/></label><label>Lösenord<input required type="password" name="password" autoComplete="new-password" minLength={12} maxLength={256}/><small>Minst 12 tecken.</small></label><label className="auth-checkbox"><input required type="checkbox" name="acknowledgement" value="yes"/><span>Jag har läst <Link href="/privacy">integritetsinformationen</Link> och <Link href="/terms">informationen om tjänsten</Link>.</span></label><button className="button button-green" type="submit">Skapa konto</button></form>
 <p className="auth-links">Har du redan ett konto? <Link href={`/login?${new URLSearchParams({next:nextPath})}`}>Logga in</Link></p>{nextPath==='/my-offers'?null:<p className="form-note">Finansiering kräver separat anslutning och godkännande per partnerprodukt.</p>}
 </AuthShell>;
}
