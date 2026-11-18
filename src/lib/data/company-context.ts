import {getRequestAuthContext} from '@/lib/auth/request-context';
import 'server-only';
import {authAvailabilityRead,throwIfAuthUnavailable} from '@/lib/auth/availability';
import { cache } from 'react';
import { cookies } from 'next/headers';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { readAccountAccess } from '@/lib/account-access/context';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AccountDatabase } from '@/lib/account-access/database.types';

export type CompanyOrganization={id:string;name:string;organisation_number:string;status:string};
export type CompanyMembership={company_id:string;role:string;companies:CompanyOrganization};

/** Verified identity and available companies. A stale selection never falls back to another tenant. */
export const getCompanySession=cache(async()=>{
  const initial=await getRequestAuthContext();
  if(!initial)return null;
  const {db,user}=initial,auth={user};
  const accountAccess=await readAccountAccess(db as unknown as SupabaseClient<AccountDatabase>,auth.user);
  if(accountAccess.status!=='approved'||!accountAccess.emailVerified)return {db,user:{id:auth.user.id,email:auth.user.email??''},memberships:[] as CompanyMembership[],membership:null,selectionRequired:false,accountAccess};
  const { data, error } = await db.from('memberships')
    .select('company_id,role,companies!inner(id,name,organisation_number,status)')
    .eq('user_id', auth.user.id).eq('status', 'active').eq('companies.status', 'active').order('company_id');
  if (error) throw new Error('Företagsbehörigheten kunde inte kontrolleras. Försök igen.');
  const memberships=(data??[]) as CompanyMembership[];
  let hasSuspendedCompany=false;
  if(!memberships.length){
    const status=await (db as unknown as SupabaseClient<{public:{Tables:Record<string,never>;Views:Record<string,never>;Functions:{get_my_company_access_status:{Args:Record<string,never>;Returns:{actorUserId:string;hasSuspendedCompany:boolean}}}}}>).rpc('get_my_company_access_status',{});
    if(status.error||!status.data||status.data.actorUserId!==auth.user.id||typeof status.data.hasSuspendedCompany!=='boolean')throw new Error('Företagets åtkomststatus kunde inte verifieras. Försök igen.');
    hasSuspendedCompany=status.data.hasSuspendedCompany;
  }
  const selected = (await cookies()).get('trafexa-company');
  const membership = (selected ? memberships.find(member=>member.company_id.toLowerCase()===selected.value.toLowerCase()) : memberships[0])??null;
  return {db,user:{id:auth.user.id,email:auth.user.email??''},memberships,membership,selectionRequired:Boolean(selected&&!membership),accountAccess,hasSuspendedCompany};
});

/** A cookie chooses among current memberships; it never grants company access. */
export async function getActiveCompanyContext() {
  const session=await getCompanySession();
  if(!session)throw Object.assign(new Error('Logga in igen för att fortsätta.'),{code:'unauthenticated'});
  if(!session.membership)throw Object.assign(new Error('Välj ett företag där du har ett aktivt medlemskap för att fortsätta.'),{code:'access_denied'});
  return {db:session.db,company:session.membership.company_id,user:session.user.id,role:session.membership.role};
}
