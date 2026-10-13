import Link from 'next/link';
import { redirect } from 'next/navigation';
import { loginAction } from '@/lib/data/actions';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { AuthShell } from '@/components/auth-shell';
export const metadata={title:'Logga in',robots:{index:false,follow:false}};
export default async function LoginPage({ searchParams }: { searchParams: Promise<{error?:string;success?:string}> }) {
 const query=await searchParams;const db=await createServerSupabaseClient();const {data}=await db.auth.getClaims();if(data?.claims?.sub)redirect('/dashboard');
 return <AuthShell title="Välkommen tillbaka." subtitle="Logga in till ditt företags lager, kunder och affärer.">
 {query.error?<p className="notice error" role="alert">{query.error}</p>:null}{query.success?<p className="notice success" role="status">{query.success}</p>:null}
 <form action={loginAction}><label>E-post<input required type="email" name="email" autoComplete="email" maxLength={254} placeholder="namn@bilfirma.se" /></label><label>Lösenord<input required type="password" name="password" autoComplete="current-password" maxLength={256} /></label><button className="button button-green" type="submit">Logga in</button></form>
 <p className="auth-links"><Link href="/forgot-password">Glömt lösenordet?</Link></p><p className="auth-links">Ny hos Trafexa? <Link href="/register">Skapa konto</Link></p><p className="auth-links"><Link href="/demo">Se systemet med exempeldata</Link></p>
 </AuthShell>;
}
