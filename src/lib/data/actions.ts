'use server';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getCompanySession } from './company-context';
import { enumField,integerField,moneyField,requiredField,textField,uuidField } from './validation';

function outcome(path:string,type:'error'|'success',message:string):never {redirect(`${path}?${type}=${encodeURIComponent(message)}`);}
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
 const email=authEmail(form,'/login'),password=authPassword(form,'/login',1);
 const db=await createServerSupabaseClient();
 const {error}=await db.auth.signInWithPassword({email,password});
 if(error)outcome('/login','error','Inloggningen misslyckades. Kontrollera e-post och lösenord.');
 redirect('/dashboard');
}
export async function signupAction(form:FormData) {
 const email=authEmail(form,'/register'),password=authPassword(form,'/register',12);
 if(form.get('acknowledgement')!=='yes')outcome('/register','error','Godkänn villkoren och bekräfta att du har läst integritetsinformationen.');
 const db=await createServerSupabaseClient();
 const {error}=await db.auth.signUp({email,password,options:{emailRedirectTo:`${process.env.NEXT_PUBLIC_APP_URL??'https://app.trafexa.com'}/auth/callback`}});
 if(error)outcome('/register','error','Kontot kunde inte skapas. Försök igen senare.');
 outcome('/login','success','Kontrollera din e-post och bekräfta kontot innan du loggar in.');
}
export async function signOutAction() {const db=await createServerSupabaseClient();await db.auth.signOut();(await cookies()).delete('trafexa-company');redirect('/login');}
async function context() {
 const session=await getCompanySession();
 if(!session)redirect('/login');
 if(!session.membership)redirect(session.memberships.length?'/settings':'/onboarding');
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
async function mutate(path:string,work:()=>Promise<void>,success:string) {
 let failure:string|null=null;try {await work();}catch(e){if((e as {digest?:string}).digest?.startsWith('NEXT_REDIRECT'))throw e;failure=friendlyError(e);}
 if(failure)outcome(path,'error',failure);revalidatePath('/dashboard');revalidatePath(path);outcome(path,'success',success);
}
export async function createVehicleAction(form:FormData) {
 await mutate('/inventory',async()=>{
 const {db,company}=await context();const {error}=await db.rpc('create_stock',{
 company,registration:requiredField(form,'registration_number',2,15).toUpperCase().replace(/\s/g,''),make_name:requiredField(form,'make'),model_name:requiredField(form,'model'),
 year:integerField(form,'model_year',1900,new Date().getUTCFullYear()+2),mileage:integerField(form,'mileage_km',0,3000000,0),
 fuel_type:enumField(form,'fuel',['petrol','diesel','electric','hybrid','other'],'petrol'),gearbox_type:enumField(form,'gearbox',['automatic','manual'],'automatic'),
 purchase_ore:moneyField(form,'purchase_price',true),asking_ore:moneyField(form,'asking_price'),vat:enumField(form,'vat_scheme',['standard','vmb','unknown'],'unknown')
 });if(error)throw error;
 },'Bilen har lagts till i lagret.');
}
export async function createCustomerAction(form:FormData) {
 await mutate('/customers',async()=>{const {db,company}=await context();const email=textField(form,'email',254);if(email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw new Error('Ange en giltig e-postadress.');
 const {error}=await db.from('customers').insert({company_id:company,name:requiredField(form,'name',2),kind:enumField(form,'kind',['person','business'],'person'),email:email||null,phone:textField(form,'phone',60)||null,address:textField(form,'address',500)||null,notes:textField(form,'notes',2000)||null});if(error)throw error;
 },'Kunden har lagts till.');
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
 await mutate('/finance',async()=>{const {db,company,user}=await context();const deal=textField(form,'deal_id');
 const {error}=await db.from('finance_applications').insert({company_id:company,created_by:user,product:enumField(form,'product',['purchase','stock']),deal_id:deal?uuidField(form,'deal_id'):null,requested_amount_ore:moneyField(form,'requested_amount'),deposit_ore:textField(form,'deposit')?moneyField(form,'deposit',true):0,term_months:textField(form,'term_months')?integerField(form,'term_months',1,120):null,note:textField(form,'note',2000)||null,status:'intake'});if(error)throw error;
 },'Förfrågan har sparats i Trafexa. Den är inte skickad till en finanspartner.');
}
export async function updateVehiclePriceAction(form:FormData) {
 await mutate('/inventory',async()=>{const {db,company}=await context();const {data,error}=await db.from('stock_items').update({asking_price_ore:moneyField(form,'asking_price')}).eq('company_id',company).eq('id',uuidField(form,'stock_item_id')).select('id');if(error)throw error;if(!data?.length)throw new Error('Bilen kunde inte hittas.');},'Försäljningspriset har uppdaterats.');
}

export async function createVehicleCostAction(form:FormData) {
 await mutate('/inventory',async()=>{
  const {db,company,role}=await context();
  if(!['owner','admin','sales'].includes(role))throw new Error('Du har inte behörighet att registrera kostnader.');
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
 const email=authEmail(form,'/forgot-password');
 let failed=false;
 try {
 const db=await createServerSupabaseClient();
 const {error}=await db.auth.resetPasswordForEmail(email,{redirectTo:`${process.env.NEXT_PUBLIC_APP_URL??'https://app.trafexa.com'}/auth/callback?next=/reset-password`});
 failed=Boolean(error);
 } catch {failed=true;}
 if(failed)outcome('/forgot-password','error','Återställningsförfrågan kunde inte behandlas just nu. Försök igen senare.');
 outcome('/forgot-password','success','Om adressen har ett konto får du ett mejl med instruktioner för återställning.');
}
export async function updatePasswordAction(form:FormData) {
 const password=authPassword(form,'/reset-password',12);
 const db=await createServerSupabaseClient();const {data,error:authError}=await db.auth.getClaims();
 if(authError||!data?.claims?.sub)outcome('/forgot-password','error','Återställningslänken har gått ut. Begär en ny länk.');
 const {error}=await db.auth.updateUser({password});
 if(error)outcome('/reset-password','error','Lösenordet kunde inte ändras. Begär en ny länk och försök igen.');
 await db.auth.signOut({scope:'global'});(await cookies()).delete('trafexa-company');
 outcome('/login','success','Lösenordet har ändrats. Logga in igen.');
}
