import {createDatabase,asRole} from '../crm-db/helpers.mjs';
export const id=n=>`af190000-0000-4000-8000-${String(n).padStart(12,'0')}`;
export const A=id(1),U=id(2),C=id(3),V=id(4),S=id(5),L=id(6),P=id(7),SALES=id(8),FOREIGN=id(9);
export const fixtureSql=`
insert into auth.users(id,email,email_confirmed_at) values('${A}','priced-admin@example.invalid',now()),('${U}','priced-owner@example.invalid',now()),('${SALES}','priced-sales@example.invalid',now()),('${FOREIGN}','priced-other@example.invalid',now());
insert into private.account_approvals(user_id,status,updated_by) select id,'approved',id from auth.users where id in('${A}','${U}','${SALES}','${FOREIGN}') on conflict(user_id) do nothing;
insert into private.platform_admins(user_id,created_by) values('${A}','${A}');
insert into public.companies(id,name,organisation_number,created_by) values('${C}','Reviewed send fixture','5568554884','${U}');
insert into public.memberships(company_id,user_id,role) values('${C}','${U}','owner'),('${C}','${SALES}','sales');
insert into public.vehicles(id,company_id,registration_number,make,model,model_year) values('${V}','${C}','AF19001','Volvo','V60',2022);
insert into public.stock_items(id,company_id,vehicle_id,purchase_price_ore,asking_price_ore,vat_scheme) values('${S}','${C}','${V}',100,25000000,'standard');
insert into private.vehicle_photos(id,company_id,stock_id,object_path,content_type,size_bytes,created_by) values('${P}','${C}','${S}','${C}/${S}/${P}.jpg','image/jpeg',100,'${U}');
insert into private.advertising_listings(id,company_id,stock_id,version,status,created_by) values('${L}','${C}','${S}',2,'ready','${U}');
insert into private.advertising_versions(company_id,listing_id,version,snapshot,created_by) select '${C}','${L}',2,private.advertising_snapshot('${C}','${S}','Volvo V60','Fixture',array['${P}']::uuid[],false),'${U}';
insert into private.advertising_dispatchers(id,channel,available_until) values('priced_bl','blocket',clock_timestamp()+interval '5 minutes'),('priced_wa','wayke',clock_timestamp()+interval '5 minutes');
insert into private.advertising_connections(company_id,channel,account_reference,status,dispatcher_id,created_by) values('${C}','blocket','fixture','verified','priced_bl','${U}'),('${C}','wayke','fixture','verified','priced_wa','${U}');
`;
export async function fixture(){const db=await createDatabase({includeSigningArchive:false});await db.exec(fixtureSql);return db;}
export const call=(db,sql,args=[],user=U,role='authenticated')=>asRole(db,role,user,async tx=>(await tx.query(sql,args)).rows[0]?.r);
export const quote=(db,channels=['blocket','wayke'],user=U)=>call(db,'select public.get_advertising_send_quote($1,$2,2,$3) r',[C,L,channels],user);
export const rate=(db,channel='blocket',unit='12500',version=0,request=id(20))=>call(db,'select public.save_advertising_channel_rate($1,$2,$3,$4,$5) r',[C,channel,unit,version,request],A);
export const send=(db,q,channels=q.channels,request=id(30),user=U)=>call(db,'select public.send_vehicle_advertisement_priced($1,$2,2,$3,$4,$5) r',[C,L,channels,request,q.reviewToken],user);
export const counts=async db=>(await db.query("select jsonb_build_object('jobs',(select count(*) from private.advertising_jobs),'commitments',(select count(*) from private.advertising_charge_commitments),'bindings',(select count(*) from private.advertising_job_price_commitments),'audits',(select count(*) from private.advertising_audit),'publications',(select count(*) from private.advertising_publications),'prices',(select count(*) from private.advertising_publication_prices)) r")).rows[0].r;
export const fail=(p,code)=>import('node:assert/strict').then(({default:a})=>a.rejects(p,e=>{a.equal(e.code,code,e.message);return true;}));
export async function publish(db,job,ad='priced-ad') {const claimed=await call(db,'select public.claim_advertising_job($1,$2,$3) r',[job.id,job.version,id(80)],null,'service_role');return call(db,"select public.save_advertising_job($1,$2,$3,'published',$4,null,null) r",[job.id,claimed.version,id(80),ad],null,'service_role');}
