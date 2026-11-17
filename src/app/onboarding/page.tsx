import {CompanySuspended} from '@/components/company-suspended';
import {AuthSubmit} from '@/components/auth-submit';
import Link from 'next/link';
import {redirect} from 'next/navigation';
import {getCompanySession} from '@/lib/data/company-context';
import {signOutAction} from '@/lib/data/actions';
import {CompanyOnboarding} from '@/components/company-onboarding';
import {AuthShell} from '@/components/auth-shell';
import {getAccountAccessContext} from '@/lib/account-access/context';
import {getPlatformAdminContext} from '@/lib/platform-admin/context';
export const dynamic='force-dynamic';
export const metadata={title:'Ditt företag',robots:{index:false,follow:false}};
export default async function OnboardingPage({searchParams}:{searchParams:Promise<{error?:string}>}) {
 if(await getPlatformAdminContext())redirect('/admin');
 let access;try{access=await getAccountAccessContext();}catch(error){if(error&&typeof error==='object'&&'code'in error&&error.code==='unavailable')throw error;redirect('/account-pending');}
 if(!access)redirect('/login');if(!access.emailVerified||access.status!=='approved')redirect('/account-pending');
 const [snapshot,query]=await Promise.all([getCompanySession(),searchParams]);if(!snapshot)redirect('/login');
 if(snapshot.hasSuspendedCompany&&!snapshot.memberships.length)return <CompanySuspended/>;
 return <AuthShell title="Samla din bilaffär." subtitle={`Du är inloggad som ${snapshot.user.email}. Lägg upp företaget som du ska arbeta med.`}>
 {query.error?<p role="alert" className="notice error">{query.error}</p>:null}
 <p className="auth-links">Inbjuden till ett befintligt företag? <Link href="/invitations">Mina företagsinbjudningar</Link></p>
 {snapshot.memberships.length>0?<p className="auth-links"><Link href="/settings#settings-account">Tillbaka till företagsinställningar</Link></p>:null}
 <CompanyOnboarding userId={snapshot.user.id} loginEmail={snapshot.user.email}/>
 <p className="form-note">Företagskonto och finansgodkännande hanteras separat. Ingen kreditlimit tilldelas i detta steg.</p><form action={signOutAction}><AuthSubmit pendingLabel="Loggar ut…" className="text-link">Logga ut</AuthSubmit></form>
 </AuthShell>;
}
