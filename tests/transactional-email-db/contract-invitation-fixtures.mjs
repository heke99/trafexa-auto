import {createDatabase,asRole} from '../crm-db/helpers.mjs';
export const id=n=>`af200000-0000-4000-8000-${String(n).padStart(12,'0')}`;
export const U=id(1),K=id(2),C=id(3),D=id(4),CUSTOMER=id(5),STOCK=id(6),VEHICLE=id(7);
export const strokes=[{points:[{x:0,y:0},{x:5,y:20},{x:10,y:0}]}];
export const rpc=(db,user,name,args)=>asRole(db,'authenticated',user,async tx=>(await tx.query(`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) result`,args)).rows[0].result);
export const baseFixtureSql=`
insert into auth.users(id,email,email_confirmed_at)values('${U}','invitation-owner-af200000@example.invalid',now()),('${K}','invitation-customer-af200000@example.invalid',now());
insert into private.account_approvals(user_id,status,updated_by)values('${U}','approved','${U}'),('${K}','approved','${U}');
insert into public.companies(id,name,organisation_number,created_by)values('${C}','Invitation rollback fixture','5568554884','${U}');
insert into public.memberships(company_id,user_id,role)values('${C}','${U}','owner');
insert into public.customers(id,company_id,name,email)values('${CUSTOMER}','${C}','Invitation Customer','invitation-customer-af200000@example.invalid');
insert into public.vehicles(id,company_id,registration_number,make,model,model_year)values('${VEHICLE}','${C}','AF20000','Fixture','Invitation',2020);
insert into public.stock_items(id,company_id,vehicle_id,purchase_price_ore,asking_price_ore,vat_scheme)values('${STOCK}','${C}','${VEHICLE}',100,200,'standard');
insert into public.deals(id,company_id,stock_item_id,customer_id,sale_price_ore,created_by)values('${D}','${C}','${STOCK}','${CUSTOMER}',200,'${U}');
`;
export async function fixture(){const db=await createDatabase({approveEstablishedFixtures:false});await db.exec("create or replace function auth.role() returns text language sql stable as $$select nullif(current_setting('request.jwt.claim.role',true),'')$$;grant execute on function auth.role() to service_role,authenticated,anon;");await db.exec(baseFixtureSql);const offer=await rpc(db,U,'create_offer_version',[C,D,id(10),'Invitation terms',new Date().toISOString().slice(0,10),true]);const review=(await rpc(db,U,'publish_offer_review',[C,D,offer,id(11)])).review;await rpc(db,K,'respond_offer_review',[review.id,1,'accepted','Invitation Customer',null,'2026-10-14',id(12)]);const t=(await rpc(db,U,'create_contract_template_version',[C,id(13),0,'Invitation contract','Seller {{company.name}} Buyer {{customer.name}} Price {{offer.price_ore}}',id(14)])).template;await rpc(db,U,'review_contract_template',[C,t.id,1,'approved','Reviewed invitation contract',id(15)]);const draft=(await rpc(db,U,'create_sale_contract_draft',[C,D,offer,t.id,2,id(16)])).draft;const signing=(await rpc(db,U,'request_contract_signing',[C,D,draft.id,true,id(17)])).signing;return{db,signing};}
export const sign=(db,signing,party='customer',request=id(20))=>rpc(db,party==='customer'?K:U,'sign_contract',[signing.id,party==='customer'?null:C,signing.revision,signing.documentHash,party==='customer'?'Invitation Customer':'Invitation Owner',strokes,true,'2026-10-14',request]);
export const service=(db,name,args=[])=>asRole(db,'service_role',null,async tx=>{await tx.query("select set_config('request.jwt.claim.role','service_role',true)");return(await tx.query(`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) result`,args)).rows[0].result;});
export const claim=(db,signing,kind='contract_invitation')=>service(db,'claim_transactional_email',[kind,signing.id]);
export const check=(db,lease)=>service(db,'check_transactional_email_lease',[lease.id,lease.leaseId]);
