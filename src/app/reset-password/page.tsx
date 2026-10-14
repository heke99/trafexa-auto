import {redirect} from 'next/navigation';
import {updatePasswordAction} from '@/lib/data/actions';
import {createServerSupabaseClient} from '@/lib/supabase/server';
import {safeNextPath} from '@/lib/routing.mjs';
import {AuthShell} from '@/components/auth-shell';
export const metadata={title:'Nytt lösenord',robots:{index:false,follow:false}};
export default async function ResetPasswordPage({searchParams}:{searchParams:Promise<{error?:string;next?:string}>}) {
 const query=await searchParams;const nextPath=safeNextPath(query.next);const db=await createServerSupabaseClient();const{data,error}=await db.auth.getUser();if(error||!data?.user)redirect(`/forgot-password?${new URLSearchParams({next:nextPath,error:'Begär en ny återställningslänk.'})}`);
 return <AuthShell title="Välj ett nytt lösenord." subtitle="Använd ett unikt lösenord med minst 12 tecken.">
 {query.error?<p role="alert" className="notice error">{query.error}</p>:null}<form action={updatePasswordAction}><input type="hidden" name="next" value={nextPath}/><label>Nytt lösenord<input type="password" name="password" autoComplete="new-password" required minLength={12} maxLength={256}/></label><button className="button button-green" type="submit">Spara lösenord</button></form>
 </AuthShell>;
}
