import Link from 'next/link';
import {redirect} from 'next/navigation';
import {getWorkspaceSnapshot} from '@/lib/data/workspace';
import {signOutAction} from '@/lib/data/actions';
import {CompanyOnboarding} from '@/components/company-onboarding';
import {AuthShell} from '@/components/auth-shell';
import {getAccountAccessContext} from '@/lib/account-access/context';
import {getPlatformAdminContext} from '@/lib/platform-admin/context';
export const metadata={title:'Ditt företag',robots:{index:false,follow:false}};
export default async function OnboardingPage({searchParams}:{searchParams:Promise<{error?:string}>}) {
 if(await getPlatformAdminContext())redirect('/admin');
 let access;try{access=await getAccountAccessContext();}catch{redirect('/account-pending');}
 if(!access)redirect('/login');if(!access.emailVerified||access.status!=='approved')redirect('/account-pending');
 const [snapshot,query]=await Promise.all([getWorkspaceSnapshot(),searchParams]);if(!snapshot)redirect('/login');
 return <AuthShell title="Samla din bilaffär." subtitle={`Du är inloggad som ${snapshot.user.email}. Lägg upp företaget som du ska arbeta med.`}>
 {query.error?<p role="alert" className="notice error">{query.error}</p>:null}
 <p className="auth-links">Inbjuden till ett befintligt företag? <Link href="/invitations">Mina företagsinbjudningar</Link></p>
 <CompanyOnboarding userId={snapshot.user.id} loginEmail={snapshot.user.email}/>
 <p className="form-note">Företagskonto och finansgodkännande hanteras separat. Ingen kreditlimit tilldelas i detta steg.</p><form action={signOutAction}><button className="text-link" type="submit">Logga ut</button></form>
 </AuthShell>;
}
