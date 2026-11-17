/** A dependency outage is never proof that a user's session has ended. */
export class AuthUnavailableError extends Error {
 readonly code='unavailable';
 constructor(){super('Inloggningen kunde inte kontrolleras just nu. Försök igen.');}
}
export function throwIfAuthUnavailable(error:unknown):void {
 if(!error)return;
 const value=error as {name?:unknown;status?:unknown;code?:unknown};
 // Supabase's local missing-session result has no HTTP status.
 if(value.name==='AuthSessionMissingError')return;
 const status=typeof value.status==='number'?value.status:0;
 if(status===0&&value.code==='session_not_found')return;
 if([400,401,403].includes(status))return;
 throw new AuthUnavailableError();
}
export function isAuthUnavailable(error:unknown):boolean {
 return Boolean(error&&typeof error==='object'&&'code'in error&&error.code==='unavailable');
}
/** Thrown fetch/network failures must take the same recoverable path as 5xx. */
export async function authAvailabilityRead<T>(read:()=>Promise<T>):Promise<T>{
 try{return await read();}catch{throw new AuthUnavailableError();}
}
