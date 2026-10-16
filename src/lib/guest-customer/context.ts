import 'server-only';
import {createHash} from 'node:crypto';
import {cookies} from 'next/headers';
import {createClient} from '@supabase/supabase-js';
import {guestDocumentCookie,parseGuestDocumentCookie} from './token';
export type GuestClient={rpc(name:string,args:Record<string,unknown>):Promise<{data:unknown;error:unknown}>};
export class GuestDocumentError extends Error{constructor(readonly code:'access_denied'|'unavailable'|'invalid_input'|'conflict'){super('Dokumentåtkomsten kunde inte verifieras.');}}
/** The capability comes only from the HttpOnly document cookie; no Auth account is used. */
export async function requireGuestCustomerContext(){
 const cookie=parseGuestDocumentCookie((await cookies()).get(guestDocumentCookie)?.value);
 if(!cookie)throw new GuestDocumentError('access_denied');
 const url=process.env.NEXT_PUBLIC_SUPABASE_URL,secret=process.env.SUPABASE_SECRET_KEY;
 if(url!=='https://buqdtssxrotkzndublrt.supabase.co'||!secret)throw new GuestDocumentError('unavailable');
 const db=createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:(input,init)=>fetch(input,{...init,signal:AbortSignal.timeout(15_000)})}}) as unknown as GuestClient;
 return{db,invitationId:cookie.invitationId,tokenHash:createHash('sha256').update(cookie.token,'utf8').digest('hex')};
}
