'use server';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getCompanySession } from './company-context';
import { enumField,integerField,moneyField,requiredField,textField,uuidField } from './validation';
import { safeNextPath } from '@/lib/routing.mjs';
import { getAuthAppOrigin } from '@/lib/auth/app-origin';
import { getAuthenticatedLandingPath } from '@/lib/auth/landing';
import { passwordChangeUnconfirmedWarning, savedPasswordSignOutWarning, sessionSignOutUnconfirmedWarning, tryGlobalSignOut } from '@/lib/auth/sign-out';
import { getPasswordRecoveryFingerprint } from '@/lib/auth/password-recovery-intent';
import { PASSWORD_RECOVERY_COOKIE, PASSWORD_RECOVERY_COOKIE_PATH, validPasswordRecoveryToken } from '@/lib/auth/password-recovery-token';
import { canManageStockIntake, canWriteInternalFinance } from '@/lib/access/dealer-capabilities';
import { createCustomerRequestAction, createFinanceIntakeRequestAction } from './create-record-actions';

function outcome(path:string,type:'error'|'success',message:string):never {redirect(`${path}${path.includes('?')?'&':'?'}${type}=${encodeURIComponent(message)}`);}
function friendlyError(error:unknown) {
 const e=error as {code?:string;message?:string};
 if(e.code==='23505') return 'Posten finns redan eller bilen är redan reserverad.';
 if(e.code==='23503') return 'Kunden och bilen måste tillhöra samma företag.';
 if(e.code==='42501')return 'Du har inte behörighet att göra detta.';
 if(e.code) return 'Uppgifterna kunde inte sparas. Kontrollera formuläret och försök igen.';
 return e.message??'Något gick fel. Försök igen.';
}
function authEmail(form:FormData,path:string) {
 try {
  const email=textField(form,'email',254);
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw new Error('Ange en giltig e-postadress.');
  return email;
 } catch(error) {outcome(path,'error',friendlyError(error));}
}
function authPassword(form:FormData,path:string,min:number) {
 const password=form.get('password');
 if(typeof password!=='string'||password.length<min||password.length>256) {
  outcome(path,'error',min===12?'Använd ett lösenord med 12–256 tecken.':'Ange ditt lösenord med högst 256 tecken.');
 }
 return password;
}
export async function loginAction(form:FormData) {
 const nextPath=safeNextPath(form.get('next'));
 const errorPath=`/login?${new URLSearchParams({next:nextPath})}`;
 const email=authEmail(form,errorPath),password=authPassword(form,errorPath,1);
 let failed=false;
 try {
  const db=await createServerSupabaseClient();
  const {error}=await db.auth.signInWithPassword({email,password});
  failed=Boolean(error);
 } catch {failed=true;}
 if(failed)redirect(`/login?${new URLSearchParams({next:nextPath,error:'Inloggningen misslyckades. Kontrollera e-post och lösenord.'})}`);
 redirect(await getAuthenticatedLandingPath(nextPath));
}
export async function signupAction(_form:FormData) {
 // Keep stale form submissions safe after open registration has been closed.
 redirect('https://trafexa.com/#kontakt');
}
export async function signOutAction(form?:FormData) {
 const nextPath=safeNextPath(form?.get('next'));
 let signedOut=false;
 try {signedOut=await tryGlobalSignOut(await createServerSupabaseClient());}catch{/* An unavailable provider never confirms global session revocation. */}
 (await cookies()).delete('trafexa-company');
 const query=new URLSearchParams(nextPath==='/dashboard'?{}:{next:nextPath});
 if(!signedOut)query.set('error',sessionSignOutUnconfirmedWarning);
 redirect(`/login${query.size?`?${query}`:''}`);
}
async function context(expectedCompany?:string) {
 const session=await getCompanySession();
 if(!session)redirect('/login');
 if(!session.membership)redirect(session.memberships.length?'/settings':'/onboarding');
 if(expectedCompany!==undefined&&session.membership.company_id.toLowerCase()!==expectedCompany.toLowerCase())throw new Error('Det aktiva företaget har ändrats. Öppna formuläret igen innan du sparar.');
 return {db:session.db,company:session.membership.company_id,user:session.user.id,role:session.membership.role};
}
export async function createCompanyAction(form:FormData) {
 let company='';
 try {
 const db=await createServerSupabaseClient();const {data:auth}=await db.auth.getClaims();if(!auth?.claims?.sub)redirect('/login');
 const name=requiredField(form,'name',2);const org=requiredField(form,'organisation_number').replace(/[-\s]/g,'');
 if(!/^\d{10}$/.test(org))throw new Error('Ange organisationsnummer med tio siffror.');
 const {data,error}=await db.rpc('create_company',{company_name:name,org_number:org});if(error)throw error;company=String(data);
 } catch(e) {if((e as {digest?:string}).digest?.startsWith('NEXT_REDIRECT'))throw e;outcome('/onboarding','error',friendlyError(e));}
 (await cookies()).set('trafexa-company',company,{httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'lax',path:'/'});redirect('/dashboard');
}
export async function selectCompanyAction(form:FormData) {
 const session=await getCompanySession();if(!session)redirect('/login');
 let requested='';try {requested=uuidField(form,'company_id');}catch{outcome('/settings','error','Välj ett företag du har tillgång till.');}
 const member=session.memberships.find(item=>item.company_id.toLowerCase()===requested.toLowerCase());
 if(!member)outcome('/settings','error','Du har inte tillgång till företaget.');
 const company=member.company_id;
 (await cookies()).set('trafexa-company',company,{httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'lax',path:'/'});redirect('/dashboard');
}
async function mutate(path:string,work:()=>Promise<void>,success:string,invalidate=true) {
 let failure:string|null=null;try {await work();}catch(e){if((e as {digest?:string}).digest?.startsWith('NEXT_REDIRECT'))throw e;failure=friendlyError(e);}
 if(failure)outcome(path,'error',failure);if(invalidate){revalidatePath('/dashboard');revalidatePath(path);}outcome(path,'success',success);
}
export async function createVehicleAction(form:FormData) {
 await mutate('/inventory',async()=>{
 const {db,company,role}=await context(uuidField(form,'expected_company_id'));
 if(!canManageStockIntake(role))throw new Error('Endast företagets ägare och administratörer kan registrera lagerinköp.');
 const {error}=await db.rpc('create_stock',{
 company,registration:requiredField(form,'registration_number',2,15).toUpperCase().replace(/\s/g,''),make_name:requiredField(form,'make'),model_name:requiredField(form,'model'),
 year:integerField(form,'model_year',1900,new Date().getUTCFullYear()+2),mileage:integerField(form,'mileage_km',0,3000000,0),
 fuel_type:enumField(form,'fuel',['petrol','diesel','electric','hybrid','other'],'petrol'),gearbox_type:enumField(form,'gearbox',['automatic','manual'],'automatic'),
 purchase_ore:moneyField(form,'purchase_price',true),asking_ore:moneyField(form,'asking_price'),vat:enumField(form,'vat_scheme',['standard','vmb','unknown'],'unknown')
 });if(error)throw error;
 },'Bilen har lagts till i lagret.');
}
export async function createCustomerAction(form:FormData) {
 await mutate('/customers',async()=>{const {company}=await context(uuidField(form,'expected_company_id'));
 const result=await createCustomerRequestAction({companyId:company,requestId:uuidField(form,'request_id'),name:requiredField(form,'name',2),kind:enumField(form,'kind',['person','business'],'person')as 'person'|'business',email:textField(form,'email',254),phone:textField(form,'phone',60),address:textField(form,'address',500),notes:textField(form,'notes',2000)});if(!result.ok)throw new Error(result.message);
 },'Kunden har lagts till.',false);
}
export async function createDealAction(form:FormData) {
 await mutate('/deals',async()=>{const {db,company}=await context();const {error}=await db.rpc('create_deal',{company,stock:uuidField(form,'stock_item_id'),customer:uuidField(form,'customer_id'),price_ore:moneyField(form,'sale_price')});if(error)throw error;},'Affärsutkastet har skapats.');
}
export async function reserveVehicleAction(form:FormData) {
 await mutate('/deals',async()=>{const {db,company}=await context();const {error}=await db.rpc('reserve_vehicle',{company,deal:uuidField(form,'deal_id'),hours:48});if(error)throw error;},'Bilen är reserverad i 48 timmar.');
}
export async function releaseReservationAction(form:FormData) {
 await mutate('/deals',async()=>{const {db,company}=await context();const {error}=await db.rpc('release_reservation',{company,deal:uuidField(form,'deal_id')});if(error)throw error;},'Reservationen har släppts.');
}
export async function createFinanceRequestAction(form:FormData) {
 await mutate('/finance',async()=>{const {company}=await context(uuidField(form,'expected_company_id'));const deal=textField(form,'deal_id');
 const result=await createFinanceIntakeRequestAction({companyId:company,requestId:uuidField(form,'request_id'),product:enumField(form,'product',['purchase','stock'])as 'purchase'|'stock',dealId:deal?uuidField(form,'deal_id'):null,requestedAmount:requiredField(form,'requested_amount'),deposit:textField(form,'deposit'),termMonths:textField(form,'term_months'),note:textField(form,'note',2000)});if(!result.ok)throw new Error(result.message);
 },'Förfrågan har sparats i Trafexa. Den är inte skickad till en finanspartner.',false);
}
export async function updateVehiclePriceAction(form:FormData) {
 await mutate('/inventory',async()=>{const {db,company}=await context();const {data,error}=await db.from('stock_items').update({asking_price_ore:moneyField(form,'asking_price')}).eq('company_id',company).eq('id',uuidField(form,'stock_item_id')).select('id');if(error)throw error;if(!data?.length)throw new Error('Bilen kunde inte hittas.');},'Försäljningspriset har uppdaterats.');
}

export async function createVehicleCostAction(form:FormData) {
 await mutate('/inventory',async()=>{
  const {db,company,role}=await context();
  if(!canWriteInternalFinance(role))throw new Error('Du har inte behörighet att registrera kostnader.');
  const stock=uuidField(form,'stock_item_id');
  const category=enumField(form,'category',['repair','transport','inspection','finance','other']);
  const description=requiredField(form,'description',1,500);
  const amount=moneyField(form,'amount',true);
  const incurredOn=requiredField(form,'incurred_on',10,10);
  const date=new Date(`${incurredOn}T00:00:00Z`);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(incurredOn)||incurredOn.startsWith('0000')||Number.isNaN(date.getTime())||date.toISOString().slice(0,10)!==incurredOn)throw new Error('Ange ett giltigt kostnadsdatum.');
  const {data:vehicle,error:stockError}=await db.from('stock_items').select('id').eq('company_id',company).eq('id',stock).maybeSingle();
  if(stockError)throw stockError;
  if(!vehicle)throw new Error('Bilen kunde inte hittas i ditt företag.');
  const {data:saved,error}=await db.from('vehicle_costs').insert({company_id:company,stock_item_id:stock,category,description,amount_ore:amount,incurred_on:incurredOn}).select('id').single();
  if(error)throw error;
  if(!saved)throw new Error('Kostnaden kunde inte sparas. Försök igen.');
 },'Kostnaden har registrerats på bilen.');
}

export async function forgotPasswordAction(form:FormData) {
 const nextPath=safeNextPath(form.get('next'));
 const errorPath=nextPath==='/dashboard'?'/forgot-password':`/forgot-password?${new URLSearchParams({next:nextPath})}`;
 const email=authEmail(form,errorPath);
 const callback=new URL('/auth/callback',getAuthAppOrigin());
 callback.search=nextPath==='/dashboard'?'?next=/reset-password':new URLSearchParams({next:`/reset-password?${new URLSearchParams({next:nextPath})}`}).toString();
 let failed=false;
 try {
 const db=await createServerSupabaseClient();
 const {error}=await db.auth.resetPasswordForEmail(email,{redirectTo:callback.toString()});
 failed=Boolean(error);
 } catch {failed=true;}
 if(failed)outcome(errorPath,'error','Återställningsförfrågan kunde inte behandlas just nu. Försök igen senare.');
 outcome(errorPath,'success','Om adressen har ett konto får du ett mejl med instruktioner för återställning.');
}
export async function updatePasswordAction(form:FormData) {
 const nextPath=safeNextPath(form.get('next'));
 const route=(path:string)=>nextPath==='/dashboard'?path:`${path}?${new URLSearchParams({next:nextPath})}`;
 const password=authPassword(form,route('/reset-password'),12);
 const store=await cookies(),recoveryToken=store.get(PASSWORD_RECOVERY_COOKIE)?.value;
 const mode=form.get('passwordMode'),fingerprint=form.get('recoveryFingerprint'),expectedUserId=form.get('expectedUserId');
 const single=(name:string)=>form.getAll(name).length===1;
 const validMode=single('passwordMode')&&(mode==='recovery'
  ? single('recoveryFingerprint')&&expectedUserId===null&&validPasswordRecoveryToken(recoveryToken)&&typeof fingerprint==='string'&&fingerprint===getPasswordRecoveryFingerprint(recoveryToken)
  : mode==='session'&&fingerprint===null&&single('expectedUserId')&&typeof expectedUserId==='string'&&expectedUserId.length>0&&expectedUserId.length<=128&&recoveryToken===undefined);
 // An old tab must not adopt another tab's link or silently fall back to an existing account.
 if(!validMode)outcome(route('/reset-password'),'error','Återställningsflödet har ändrats. Läs in sidan igen innan du väljer ett lösenord.');
 const clearRecovery=()=>store.set(PASSWORD_RECOVERY_COOKIE,'',{httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'lax',path:PASSWORD_RECOVERY_COOKIE_PATH,maxAge:0});
 let db:Awaited<ReturnType<typeof createServerSupabaseClient>>;
 try {db=await createServerSupabaseClient();}catch{outcome(route(recoveryToken===undefined?'/forgot-password':'/reset-password'),'error','Återställningen kunde inte verifieras just nu. Försök igen senare.');}
 let recoveryUserId:string|undefined;
 if(recoveryToken!==undefined){
  let accepted=false;
  try{const result=await db.auth.verifyOtp({token_hash:recoveryToken,type:'recovery'});const user=result.data?.user;accepted=!result.error&&Boolean(user?.id&&user.email_confirmed_at);if(accepted)recoveryUserId=user!.id;}catch{/* A lost verification response never authorizes a password change. */}
  clearRecovery();
  if(!accepted)outcome(route('/forgot-password'),'error','Återställningslänken har gått ut eller redan använts. Begär en ny länk.');
 }
 let verified=false;
 try{const {data,error}=await db.auth.getUser();verified=!error&&Boolean(data?.user)&&(mode==='recovery'?data.user!.id===recoveryUserId:data.user!.id===expectedUserId);}catch{outcome(route('/forgot-password'),'error','Återställningen kunde inte verifieras just nu. Försök igen senare.');}
 if(!verified)outcome(route('/forgot-password'),'error','Återställningslänken har gått ut. Begär en ny länk.');
 let rejected=false;
 try{const {error}=await db.auth.updateUser({password});rejected=Boolean(error);}catch{outcome(route('/login'),'error',passwordChangeUnconfirmedWarning);}
 if(rejected)outcome(route('/reset-password'),'error','Lösenordet kunde inte ändras. Begär en ny länk och försök igen.');
 const signedOut=await tryGlobalSignOut(db);(await cookies()).delete('trafexa-company');
 if(!signedOut)outcome(route('/login'),'error',savedPasswordSignOutWarning);
 outcome(route('/login'),'success','Lösenordet har ändrats. Logga in igen.');
}
