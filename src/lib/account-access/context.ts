import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import type { AccountDatabase } from './database.types';
import type { AccountAccessContext } from './types';
export class AccountAccessError extends Error {
 constructor(readonly code: 'access_denied' | 'unavailable') { super('Kontots godkännande kunde inte verifieras.'); }
}
/** Fresh actual Auth plus private approval; user-editable metadata never authorizes. */
export async function getAccountAccessContext(): Promise<AccountAccessContext | null> {
 const db = await createServerSupabaseClient() as unknown as SupabaseClient<AccountDatabase>;
 const {data,error}=await db.auth.getUser();
 if(error || !data?.user) return null;
 const user=data.user;
 if(user.is_anonymous || !user.email) throw new AccountAccessError('access_denied');
 return readAccountAccess(db,user);
}
/** Existing request's freshly verified Auth user; no cached JWT claims. */
export async function readAccountAccess(db: SupabaseClient<AccountDatabase>, user: {id:string;email?:string;email_confirmed_at?:string;is_anonymous?:boolean}): Promise<AccountAccessContext> {
 if(user.is_anonymous || !user.email) throw new AccountAccessError('access_denied');
 const result=await db.rpc('get_account_access',{});
 if(result.error) throw new AccountAccessError(result.error.code==='42501'?'access_denied':'unavailable');
 const row=result.data;
 if(!row || typeof row!=='object' || Array.isArray(row) || row.userId!==user.id || row.email!==user.email || typeof row.emailVerified!=='boolean' || row.emailVerified!==Boolean(user.email_confirmed_at) || typeof row.version!=='number' || !Number.isInteger(row.version) || row.version<0 || row.version>2147483647 || !['pending','approved','rejected','suspended'].includes(String(row.status)) || typeof row.isPlatformAdmin!=='boolean' || (row.isPlatformAdmin && (!row.emailVerified || row.status!=='approved'))) throw new AccountAccessError('unavailable');
 return {userId:user.id,email:user.email,emailVerified:row.emailVerified,status:row.status as AccountAccessContext['status'],version:row.version,isPlatformAdmin:row.isPlatformAdmin};
}

export async function requireApprovedAccountAccess(): Promise<AccountAccessContext> {
 const context=await getAccountAccessContext();
 if(!context || !context.emailVerified || context.status!=='approved') throw new AccountAccessError('access_denied');
 return context;
}
