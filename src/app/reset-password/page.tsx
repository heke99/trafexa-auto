import {cookies} from 'next/headers';
import {PASSWORD_RECOVERY_COOKIE,validPasswordRecoveryToken} from '@/lib/auth/password-recovery-token';
import {getPasswordRecoveryFingerprint} from '@/lib/auth/password-recovery-intent';
import {AuthSubmit} from '@/components/auth-submit';
import {redirect} from 'next/navigation';
import {updatePasswordAction} from '@/lib/data/actions';
import {createServerSupabaseClient} from '@/lib/supabase/server';
import {safeNextPath} from '@/lib/routing.mjs';
import {AuthShell} from '@/components/auth-shell';
export const metadata={title:'Nytt lösenord',robots:{index:false,follow:false},referrer:'no-referrer' as const};
export default async function ResetPasswordPage({searchParams}:{searchParams:Promise<{error?:string;next?:string}>}) {
 const query=await searchParams,nextPath=safeNextPath(query.next),token=(await cookies()).get(PASSWORD_RECOVERY_COOKIE)?.value;
 const retryPath=`/forgot-password?${new URLSearchParams({next:nextPath,error:'Begär en ny återställningslänk.'})}`;
 if(token!==undefined&&!validPasswordRecoveryToken(token))redirect(retryPath);
 const recoveryFingerprint=validPasswordRecoveryToken(token)?getPasswordRecoveryFingerprint(token):null;
 let expectedUserId:string|undefined;
 if(!recoveryFingerprint){const db=await createServerSupabaseClient();const{data,error}=await db.auth.getUser();if(error||!data?.user)redirect(retryPath);expectedUserId=data.user.id;}
 return <AuthShell title="Välj ett nytt lösenord." subtitle="Använd ett unikt lösenord med minst 12 tecken.">
 {query.error?<p role="alert" className="notice error">{query.error}</p>:null}<form action={updatePasswordAction}><input type="hidden" name="next" value={nextPath}/><input type="hidden" name="passwordMode" value={recoveryFingerprint?'recovery':'session'}/>{recoveryFingerprint?<input type="hidden" name="recoveryFingerprint" value={recoveryFingerprint}/>:<input type="hidden" name="expectedUserId" value={expectedUserId}/>}<label>Nytt lösenord<input type="password" name="password" autoComplete="new-password" required minLength={12} maxLength={256}/></label><AuthSubmit pendingLabel="Sparar lösenordet…">Spara lösenord</AuthSubmit></form>
 </AuthShell>;
}
