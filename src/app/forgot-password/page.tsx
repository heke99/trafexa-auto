import {AuthSubmit} from '@/components/auth-submit';
import Link from 'next/link';
import {forgotPasswordAction} from '@/lib/data/actions';
import {safeNextPath} from '@/lib/routing.mjs';
import {AuthShell} from '@/components/auth-shell';
export const metadata={title:'Återställ lösenord',robots:{index:false,follow:false}};
export default async function ForgotPasswordPage({searchParams}:{searchParams:Promise<{error?:string;success?:string;next?:string}>}) {
 const query=await searchParams;const nextPath=safeNextPath(query.next);
 return <AuthShell title="Glömt lösenordet?" subtitle="Ange din mejladress så får du instruktioner om det finns ett konto.">
 {query.error?<p role="alert" className="notice error">{query.error}</p>:null}{query.success?<p role="status" className="notice success">{query.success}</p>:null}
 <form action={forgotPasswordAction}><input type="hidden" name="next" value={nextPath}/><label>E-post<input type="email" name="email" required maxLength={254} autoComplete="email"/></label><AuthSubmit pendingLabel="Skickar instruktioner…">Skicka instruktioner</AuthSubmit></form><p className="auth-links"><Link href={`/login?${new URLSearchParams({next:nextPath})}`}>Till inloggningen</Link></p>
 </AuthShell>;
}
