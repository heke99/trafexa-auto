import Link from 'next/link';
import {forgotPasswordAction} from '@/lib/data/actions';
import {AuthShell} from '@/components/auth-shell';
export const metadata={title:'Återställ lösenord',robots:{index:false,follow:false}};
export default async function ForgotPasswordPage({searchParams}:{searchParams:Promise<{error?:string;success?:string}>}) {
 const query=await searchParams;
 return <AuthShell title="Glömt lösenordet?" subtitle="Ange din mejladress så får du instruktioner om det finns ett konto.">
 {query.error?<p role="alert" className="notice error">{query.error}</p>:null}{query.success?<p role="status" className="notice success">{query.success}</p>:null}
 <form action={forgotPasswordAction}><label>E-post<input type="email" name="email" required maxLength={254} autoComplete="email"/></label><button className="button button-green" type="submit">Skicka instruktioner</button></form><p className="auth-links"><Link href="/login">Till inloggningen</Link></p>
 </AuthShell>;
}
