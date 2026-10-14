import Link from 'next/link';
import {redirect} from 'next/navigation';
import {getWorkspaceSnapshot} from '@/lib/data/workspace';
import {createCompanyAction,signOutAction} from '@/lib/data/actions';
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
 <form action={createCompanyAction}><label>Företagsnamn<input required name="name" autoComplete="organization" minLength={2} maxLength={160} placeholder="Din bilfirma AB"/></label><label>Organisationsnummer<input required name="organisation_number" inputMode="numeric" maxLength={11} pattern="[0-9]{6}-?[0-9]{4}" placeholder="559000-0000"/><small>Registrera endast ett företag som du har rätt att företräda.</small></label><button className="button button-green" type="submit">Skapa företagskonto</button></form>
 <p className="form-note">Företagskonto och finansgodkännande hanteras separat. Ingen kreditlimit tilldelas i detta steg.</p><form action={signOutAction}><button className="text-link" type="submit">Logga ut</button></form>
 </AuthShell>;
}
