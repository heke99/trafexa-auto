import Link from 'next/link';
import { signupAction } from '@/lib/data/actions';
import { AuthShell } from '@/components/auth-shell';
export const metadata={title:'Skapa konto',robots:{index:false,follow:false}};
export default async function RegisterPage({searchParams}:{searchParams:Promise<{error?:string}>}) {
 const query=await searchParams;
 return <AuthShell title="Skapa ditt konto." subtitle="Efter inloggning lägger du upp ditt företag och börjar samla din bilaffär.">
 {query.error?<p className="notice error" role="alert">{query.error}</p>:null}
 <form action={signupAction}><label>E-post<input required type="email" name="email" autoComplete="email" maxLength={254}/></label><label>Lösenord<input required type="password" name="password" autoComplete="new-password" minLength={12} maxLength={256}/><small>Minst 12 tecken.</small></label><label className="auth-checkbox"><input required type="checkbox" name="acknowledgement" value="yes"/><span>Jag har läst <Link href="/privacy">integritetsinformationen</Link> och <Link href="/terms">informationen om pilotversionen</Link>.</span></label><button className="button button-green" type="submit">Skapa konto</button></form>
 <p className="auth-links">Har du redan ett konto? <Link href="/login">Logga in</Link></p><p className="form-note">Finansiering kräver separat anslutning och godkännande.</p>
 </AuthShell>;
}
