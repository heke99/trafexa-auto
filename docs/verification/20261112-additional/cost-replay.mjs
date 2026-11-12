import assert from 'node:assert/strict';
import {createDatabase,asRole} from '../../../tests/crm-db/helpers.mjs';
import {createSourceLoader} from '../../../tests/helpers/source-loader.mjs';
const U='10000000-0000-4000-8000-000000000001',C='10000000-0000-4000-8000-000000000002',V='10000000-0000-4000-8000-000000000003',S='10000000-0000-4000-8000-000000000004';
const db=await createDatabase();
try {
 await db.query("insert into auth.users(id,email,email_confirmed_at) values($1,'cost-review@example.invalid',now())",[U]);
 await db.query("insert into public.companies(id,name,organisation_number,created_by) values($1,'Isolated cost review','1234567890',$2)",[C,U]);
 await db.query("insert into public.memberships(company_id,user_id,role) values($1,$2,'owner')",[C,U]);
 await db.query("insert into public.vehicles(id,company_id,registration_number,make,model,model_year) values($1,$2,'COST01','Fixture','Fixture',2024)",[V,C]);
 await db.query("insert into public.stock_items(id,company_id,vehicle_id,purchase_price_ore,asking_price_ore,vat_scheme) values($1,$2,$3,1000000,2000000,'unknown')",[S,C,V]);
 let loseFirstResponse=true;
 const client={from(table){let values,filters={};const q={select(){return q;},eq(k,v){filters[k]=v;return q;},insert(v){values=v;return q;},async maybeSingle(){assert.equal(table,'stock_items');const r=await asRole(db,'authenticated',U,tx=>tx.query('select id from public.stock_items where company_id=$1 and id=$2',[filters.company_id,filters.id]));return {data:r.rows[0]??null,error:null};},async single(){assert.equal(table,'vehicle_costs');const r=await asRole(db,'authenticated',U,tx=>tx.query('insert into public.vehicle_costs(company_id,stock_item_id,category,description,amount_ore,incurred_on) values($1,$2,$3,$4,$5,$6) returning id',[values.company_id,values.stock_item_id,values.category,values.description,values.amount_ore,values.incurred_on]));if(loseFirstResponse){loseFirstResponse=false;throw Error('Fixture: committed response was lost');}return {data:r.rows[0],error:null};}};return q;}};
 const loader=await createSourceLoader({'./company-context':{getCompanySession:async()=>({db:client,user:{id:U},membership:{company_id:C,role:'owner'},memberships:[{company_id:C,role:'owner'}]})},'next/cache':{revalidatePath(){}},'next/navigation':{redirect(url){throw Object.assign(Error('Redirect'),{digest:'NEXT_REDIRECT;',url});}},'next/headers':{cookies:async()=>({get(){},set(){},delete(){}})}});
 const action=loader.load('src/lib/data/actions.ts').createVehicleCostAction;
 const form=new FormData();for(const [k,v]of Object.entries({stock_item_id:S,category:'repair',description:'One service receipt',amount:'1250',incurred_on:'2026-11-12'}))form.set(k,v);
 const redirects=[];for(let i=0;i<2;i++){try{await action(form);}catch(e){assert.ok(e.digest?.startsWith('NEXT_REDIRECT'));redirects.push(e.url);}}
 const r=await db.query('select count(*)::int as count,sum(amount_ore)::text as total from public.vehicle_costs where company_id=$1 and stock_item_id=$2',[C,S]);
 assert.equal(r.rows[0].count,2);assert.equal(r.rows[0].total,'250000');
 console.log(JSON.stringify({finding:'Identical cost retry after lost committed response duplicates cost',oneReceiptAmountOre:'125000',persisted:r.rows[0],redirects,boundary:'Actual server action and complete migrated PGlite/RLS; synthetic active company context and controlled dropped transport response'},null,2));
}finally{await db.close();}
