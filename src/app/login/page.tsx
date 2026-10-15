import Link from 'next/link';
import { redirect } from 'next/navigation';
import { loginAction } from '@/lib/data/actions';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { AuthShell } from '@/components/auth-shell';
import { safeNextPath } from '@/lib/routing.mjs';
import { getAuthenticatedLandingPath } from '@/lib/auth/landing';
export const metadata={title:'Logga in',robots:{index:false,follow:false}};
export default async function LoginPage({ searchParams }: { searchParams: Promise<{error?:string;success?:string;next?:string}> }) {
 const query=await searchParams;const nextPath=safeNextPath(query.next);const db=await createServerSupabaseClient();const {data,error}=await db.auth.getUser();if(!error&&data?.user)redirect(await getAuthenticatedLandingPath(nextPath));
 return <AuthShell title="Välkommen tillbaka." subtitle={nextPath==='/my-offers'?'Logga in med den verifierade e-postadress som bilhandlaren har angett i din offert. Du behöver inget företagskonto.':nextPath==='/invitations'?'Logga in med din inbjudna e-postadress för att granska dina företagsinbjudningar.':'Logga in till ditt företags lager, kunder och affärer.'}>
 {query.error?<p className="notice error" role="alert">{query.error}</p>:null}{query.success?<p className="notice success" role="status">{query.success}</p>:null}
 <form action={loginAction}><input type="hidden" name="next" value={nextPath}/><label>E-post<input required type="email" name="email" autoComplete="email" maxLength={254} placeholder="namn@bilfirma.se" /></label><label>Lösenord<input required type="password" name="password" autoComplete="current-password" maxLength={256} /></label><button className="button button-green" type="submit">Logga in</button></form>
 <p className="auth-links"><Link href={`/forgot-password?${new URLSearchParams({next:nextPath})}`}>Glömt lösenordet?</Link></p><p className="auth-links">Ny hos Trafexa? <a href="https://trafexa.com/#kontakt">Ansök om tillgång</a></p><p className="form-note">Vi granskar din ansökan. Efter godkännande får du en kontoinbjudan via e-post och väljer ditt lösenord.</p><p className="auth-links"><Link href="/demo">Se systemet med exempeldata</Link></p>
 </AuthShell>;
}
