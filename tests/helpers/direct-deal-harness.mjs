import {createDatabase,asRole} from '../crm-db/helpers.mjs';
import {createSourceLoader} from './source-loader.mjs';
const id=n=>`dd130000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const U=id(1),C=id(2),S=id(3),V=id(4),OTHER=id(5),OTHER_C=id(6),CU=id(7),D=id(8);
const checksum=base=>{let sum=0;for(const[i,c]of [...base.slice(-9)].entries()){const n=Number(c)*(i%2===0?2:1);sum+=Math.floor(n/10)+n%10;}return String((10-sum%10)%10);};
const PN='19900101001'+checksum('900101001');
const customer={kind:'person',name:'Synthetic Test Buyer',email:'direct-buyer@example.invalid',phone:'0701234567',address:'Testgatan 1',identityNumber:PN};
async function fixture(){const db=await createDatabase();await db.exec(`create or replace function auth.role() returns text language sql stable as $$select current_setting('role',true)$$;grant execute on function auth.role() to authenticated,anon,service_role;
insert into auth.users(id,email,email_confirmed_at)values('${U}','direct-owner@example.invalid',now()),('${OTHER}','other@example.invalid',now());
insert into public.companies(id,name,organisation_number,created_by)values('${C}','Direct Test Dealer','5568554884','${U}'),('${OTHER_C}','Other Test Dealer','5568554884','${OTHER}');
insert into public.memberships(company_id,user_id,role)values('${C}','${U}','owner'),('${OTHER_C}','${OTHER}','owner');
insert into public.vehicles(id,company_id,registration_number,make,model,model_year)values('${V}','${C}','TST130','Synthetic','Car',2025);
insert into public.stock_items(id,company_id,vehicle_id,purchase_price_ore,asking_price_ore,vat_scheme)values('${S}','${C}','${V}',10000000,15000000,'standard');`);return db;}
async function call(db,name,args,actor=U){return asRole(db,'authenticated',actor,async tx=>(await tx.query(`select public.${name}(${Object.keys(args).map((k,i)=>k+'=>$'+(i+1)).join(',')}) r`,Object.values(args))).rows[0].r);}
const prepare=(overrides={})=>({p_company_id:C,p_request_id:id(20),p_deal_id:null,p_stock_item_id:S,p_customer_id:null,p_customer:customer,p_expected_customer_version:null,p_price_ore:12505000,p_template_version_id:null,p_expected_template_approval_version:0,...overrides});
const approve=(review,overrides={})=>({p_company_id:C,p_deal_id:review.dealId,p_draft_id:review.draft.id,p_review_hash:review.reviewHash,p_seller_name:'Synthetic Seller',p_acknowledged:true,p_request_id:id(21),...overrides});
async function actionHarness(db,{revokeAfterRpc=null,actorId=U}={}){let reads=0,revoke=false;const calls=[];
class CrmError extends Error{constructor(code){super(code);this.code=code;}}
async function scope(companyId,approval=false){reads++;const row=(await db.query("select m.role from public.memberships m join public.companies c on c.id=m.company_id where m.company_id=$1 and m.user_id=$2 and m.status='active' and c.status='active'",[companyId,actorId])).rows[0];if(revoke||companyId!==C||!row||!['owner','admin','sales'].includes(row.role)||approval&&!['owner','admin'].includes(row.role))throw new CrmError('access_denied');return{companyId:C,userId:actorId,role:row.role,db:{async rpc(name,args){calls.push({name,args});try{const data=await call(db,name,args,actorId);if(name===revokeAfterRpc)revoke=true;return{data,error:null};}catch(error){return{data:null,error};}}}};}
const loader=await createSourceLoader({'next/cache':{revalidatePath(){}},'./company-context':{async getActiveCompanyContext(){return{company:C,user:actorId};}},'@/lib/crm/context':{CrmError,requireCrmContext:scope},'@/lib/account-access/context':{async requireApprovedAccountAccess(){if(revoke)throw new CrmError('access_denied');return{userId:actorId};}},'@/lib/contracts/signing-context':{async requireDealerSigningContext(companyId){return scope(companyId,true);}},'@/lib/email/server':{contractEmailConfigurationStatus(){return{transport:'configured'};},async dispatchTransactionalEvent(kind,reference){calls.push({kind,reference});return{status:'empty'};}}});return{actions:loader.load('@/lib/data/direct-deal-actions'),calls,revoke(){revoke=true;},get reads(){return reads;}};}


export{id,U,C,S,V,OTHER,OTHER_C,CU,D,PN,customer,fixture,call,prepare,approve,actionHarness};
export async function createDirectDealHarness(){const db=await fixture(),h=await actionHarness(db);return{db,...h,companyId:C,userId:U,stockItemId:S,customerFixture:customer,inventory:[{id:S,status:'available',acquired_on:'2026-11-13',purchase_price_ore:10000000,asking_price_ore:15000000,vat_scheme:'standard',vehicles:{id:V,registration_number:'TST130',make:'Synthetic',model:'Car',model_year:2025,mileage_km:0,fuel:'other',gearbox:'automatic'}}],customers:[],async dispose(){await db.close();}};}
