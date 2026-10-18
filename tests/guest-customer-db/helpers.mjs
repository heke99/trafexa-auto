import {randomBytes,createHash} from 'node:crypto';
import {createDatabase,asRole} from '../crm-db/helpers.mjs';
export const id=n=>`af230000-0000-4000-8000-${String(n).padStart(12,'0')}`;
export const U=id(1),C=id(3),D=id(4),CU=id(5),S=id(6),V=id(7),EMAIL='guest-buyer-af230000@example.invalid';
export const rpc=(db,user,name,args=[])=>asRole(db,'authenticated',user,async tx=>(await tx.query(`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) result`,args)).rows[0].result);
export const service=(db,name,args=[])=>asRole(db,'service_role',null,async tx=>(await tx.query(`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) result`,args)).rows[0].result);
export async function fixture(options={}){const db=await createDatabase({...options,approveEstablishedFixtures:false});await db.exec(`
create or replace function auth.role() returns text language sql stable as $$select current_setting('role',true)$$;
grant execute on function auth.role() to authenticated,anon,service_role;
insert into auth.users(id,email,email_confirmed_at)values('${U}','guest-owner-af230000@example.invalid',now());
insert into private.account_approvals(user_id,status,updated_by)values('${U}','approved','${U}');
insert into public.companies(id,name,organisation_number,created_by)values('${C}','Guest fixture dealer','5568554884','${U}');
insert into public.memberships(company_id,user_id,role)values('${C}','${U}','owner');
insert into public.customers(id,company_id,name,email)values('${CU}','${C}','Guest Buyer','${EMAIL}');
insert into public.vehicles(id,company_id,registration_number,make,model,model_year)values('${V}','${C}','AF23000','Fixture','Guest',2020);
insert into public.stock_items(id,company_id,vehicle_id,purchase_price_ore,asking_price_ore,vat_scheme)values('${S}','${C}','${V}',100,200,'standard');
insert into public.deals(id,company_id,stock_item_id,customer_id,sale_price_ore,created_by)values('${D}','${C}','${S}','${CU}',200,'${U}');
`);const offer=await rpc(db,U,'create_offer_version',[C,D,id(10),'Guest original terms',new Date().toISOString().slice(0,10),true]);const review=(await rpc(db,U,'publish_offer_review',[C,D,offer,id(11)])).review;return{db,offer,review};}
export async function capability(db,kind,reference){
 const lease=await service(db,'claim_transactional_email',[kind,reference]);
 const prepared=await service(db,'prepare_customer_contract_invitation',[lease.id,lease.leaseId]);
 const token=randomBytes(32).toString('base64url'),tokenHash=createHash('sha256').update(token).digest('hex');
 const opaque='v1.sql-only-guest-payload-'+randomBytes(48).toString('hex');
 await service(db,'bind_guest_document_invitation',[lease.id,lease.leaseId,prepared.invitationId,tokenHash,opaque]);
 const source=await service(db,'get_guest_customer_document',[prepared.invitationId,tokenHash]);
 return{...prepared,documentHash:source.documentHash,token,tokenHash,opaque,lease};
}
export const read=(db,cap)=>service(db,'get_guest_customer_document',[cap.invitationId,cap.tokenHash]);
export const approveOffer=(db,cap,nonce=id(20))=>service(db,'respond_guest_offer',[cap.invitationId,cap.tokenHash,1,'accepted','Guest Buyer',null,true,'2026-10-14',nonce]);
export const approveContract=(db,cap,revision=1,nonce=id(30))=>service(db,'sign_guest_contract',[cap.invitationId,cap.tokenHash,revision,capDocumentHash(cap),'Guest Buyer',[],true,'2026-10-14',nonce]);
function capDocumentHash(cap){if(!cap.documentHash)throw Error('Attach source documentHash from read result');return cap.documentHash;}
export const strokes=[{points:[{x:0,y:0},{x:5,y:20},{x:10,y:0}]}];
export async function createSigning(h,offerCap){await approveOffer(h.db,offerCap);const t=(await rpc(h.db,U,'create_contract_template_version',[C,id(21),0,'Guest contract','Seller {{company.name}} Buyer {{customer.name}} Price {{offer.price_ore}}',id(22)])).template;await rpc(h.db,U,'review_contract_template',[C,t.id,1,'approved','Reviewed guest contract',id(23)]);const draft=(await rpc(h.db,U,'create_sale_contract_draft',[C,D,h.offer,t.id,2,id(24)])).draft;return(await rpc(h.db,U,'request_contract_signing',[C,D,draft.id,true,id(25)])).signing;}
