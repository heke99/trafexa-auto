import {redirect} from 'next/navigation';
import {updatePasswordAction} from '@/lib/data/actions';
import {createServerSupabaseClient} from '@/lib/supabase/server';
import {AuthShell} from '@/components/auth-shell';
export const metadata={title:'Nytt lösenord',robots:{index:false,follow:false}};
export default async function ResetPasswordPage({searchParams}:{searchParams:Promise<{error?:string}>}) {
 const db=await createServerSupabaseClient();const{data}=await db.auth.getClaims();if(!data?.claims?.sub)redirect('/forgot-password?error=Beg%C3%A4r%20en%20ny%20%C3%A5terst%C3%A4llningsl%C3%A4nk.');const query=await searchParams;
 return <AuthShell title="Välj ett nytt lösenord." subtitle="Använd ett unikt lösenord med minst 12 tecken.">
 {query.error?<p role="alert" className="notice error">{query.error}</p>:null}<form action={updatePasswordAction}><label>Nytt lösenord<input type="password" name="password" autoComplete="new-password" required minLength={12} maxLength={256}/></label><button className="button button-green" type="submit">Spara lösenord</button></form>
 </AuthShell>;
}
