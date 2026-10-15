// Actual SSR, context, parsers and actions against the complete migrated SQL.
// Only Supabase transport and request cookies are adapted. No hosted writes.
import assert from 'node:assert/strict';
import {before,beforeEach,after,test} from 'node:test';
import {AsyncLocalStorage} from 'node:async_hooks';
import {createDatabase,asRole} from '../crm-db/helpers.mjs';
import {createSourceLoader,createRequestReact} from '../helpers/source-loader.mjs';
const id=n=>`fd220000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const COMPANY=id(100),STOCK=id(200),VEHICLE=id(201),CUSTOMER=id(300),DEAL=id(301);
const roles=['owner','admin','sales','finance','viewer'];let database;
before(async()=>{database=await createDatabase();});
beforeEach(async()=>{await database.exec(`begin;truncate auth.users cascade;
 insert into auth.users(id,email,email_confirmed_at)select ('fd220000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'finance-scope-'||n||'@fixture.invalid',now()from generate_series(1,5)n;
 insert into public.companies(id,name,organisation_number,created_by)values('${COMPANY}','Financial scope fixture','5568554884','${id(1)}');
 insert into public.memberships(company_id,user_id,role)values ${roles.map((r,i)=>`('${COMPANY}','${id(i+1)}','${r}')`).join(',')};
 insert into public.vehicles(id,company_id,registration_number,make,model,model_year)values('${VEHICLE}','${COMPANY}','ABC123','Volvo','V60',2022);
 insert into public.stock_items(id,company_id,vehicle_id,purchase_price_ore,asking_price_ore,vat_scheme)values('${STOCK}','${COMPANY}','${VEHICLE}',12345678,20000000,'standard');
 insert into public.vehicle_costs(company_id,stock_item_id,category,description,amount_ore,incurred_on)values('${COMPANY}','${STOCK}','repair','Private repair',345678,current_date);
 insert into public.customers(id,company_id,name)values('${CUSTOMER}','${COMPANY}','Public commercial customer');
 insert into public.deals(id,company_id,customer_id,stock_item_id,sale_price_ore,created_by)values('${DEAL}','${COMPANY}','${CUSTOMER}','${STOCK}',20000000,'${id(1)}');commit;`);});
after(async()=>{await database?.close();});
async function integration(role){
 const state={actor:id(roles.indexOf(role)+1),company:COMPANY,rpcs:[],afterRpc:null,errors:[]};const requests=new AsyncLocalStorage();
 const run=async work=>{try{return{data:await asRole(database,'authenticated',state.actor,work),error:null};}catch(error){state.errors.push({code:error.code,message:error.message});return{data:null,error:{code:error.code,message:'Private provider diagnostic'}};}};
 const client={auth:{async getUser(){const row=(await database.query('select id,email,email_confirmed_at::text,is_anonymous from auth.users where id=$1',[state.actor])).rows[0];return{data:{user:row??null},error:null};}},
 from(table){assert.ok(['memberships','customers','deals','finance_applications','documents','activities','finance_partners','dealer_approvals','stock_items','vehicle_costs'].includes(table));const filters=[],orders=[];let countLimit=null,selection='*',countRequested=false;
  const builder={select(value='*',options={}){selection=value;countRequested=options.count==='exact';return builder;},eq(k,v){assert.match(k,/^[a-z_.]+$/);filters.push([k,v]);return builder;},order(k,opts={}){assert.match(k,/^[a-z_]+$/);orders.push([k,opts.ascending!==false]);return builder;},limit(n){countLimit=n;return builder;},abortSignal(){return builder;},async maybeSingle(){const r=await execute();return{...r,data:r.data?.[0]??null};},then(resolve,reject){return execute().then(resolve,reject);}};
  async function execute(){const result=await run(async tx=>{const values=[],predicates=filters.map(([key,value])=>{values.push(value);return `${key.startsWith('companies.')?'c.'+key.slice(10):'t.'+key}=$${values.length}`;});const select=table==='memberships'?"t.*,jsonb_build_object('id',c.id,'name',c.name,'organisation_number',c.organisation_number,'status',c.status)companies":selection==='*'?'t.*':selection.split(',').map(key=>{assert.match(key,/^[a-z_]+$/);return key==='incurred_on'?'t.incurred_on::text as incurred_on':'t.'+key;}).join(',');const join=table==='memberships'?' join public.companies c on c.id=t.company_id':'';const sort=orders.length?' order by '+orders.map(([k,asc])=>`t.${k} ${asc?'asc':'desc'}`).join(','):'';return(await tx.query(`select ${select} from public.${table} t${join}${predicates.length?' where '+predicates.join(' and '):''}${sort}${countLimit?' limit '+countLimit:''}`,values)).rows;});return{...result,data:result.data?JSON.parse(JSON.stringify(result.data)):null,...(countRequested?{count:result.data?.length??null}:{})};}
  return builder;
 },rpc(name,args){assert.match(name,/^(get_account_access|get_workspace_inventory|inventory_dashboard_totals|get_vehicle_calculation|dealer_register_page)$/);state.rpcs.push(name);const promise=(async()=>{const entries=Object.entries(args);const result=await run(async tx=>(await tx.query(`select public.${name}(${entries.map(([k],i)=>`${k}=>$${i+1}`).join(',')}) result`,entries.map(([,v])=>v))).rows[0].result);if(state.afterRpc)await state.afterRpc(name);return result;})();promise.abortSignal=()=>promise;return promise;}};
 const loader=await createSourceLoader({'react':createRequestReact(requests),'@/lib/supabase/server':{async createServerSupabaseClient(){return client;}},'next/headers':{async cookies(){return{get:()=>({value:state.company})};}},'next/cache':{revalidatePath(){throw Error('Read path cannot invalidate');}}});
 return{state,request:work=>requests.run({reactCache:new Map()},work),workspace:loader.load('@/lib/data/workspace'),costs:loader.load('@/lib/data/vehicle-cost-actions'),calculation:loader.load('@/lib/data/calculation-actions'),register:loader.load('@/lib/data/register-actions')};
}
for(const role of roles)test(`${role}: real SSR data and register SQL obey private financial visibility while retaining commercial fields`,async()=>{
 const h=await integration(role);const snapshot=await h.request(()=>h.workspace.getWorkspaceSnapshot());assert.equal(snapshot.inventory.length,1,JSON.stringify(h.state.errors));assert.equal(snapshot.inventory[0].asking_price_ore,20000000);assert.equal(snapshot.customers[0].name,'Public commercial customer');
 const allowed=['owner','admin','finance'].includes(role);assert.equal(snapshot.inventory[0].purchase_price_ore,allowed?12345678:null);assert.equal(snapshot.dashboardTotals.purchaseValueOre,allowed?'12345678':null);assert.deepEqual(snapshot.vehicle_costs,[]);
 const page=await h.request(()=>h.register.loadDealerRegisterPage({kind:'inventory',expectedCompanyId:COMPANY,query:'',status:'all',sort:'recent'}));assert.equal(page.ok,true,JSON.stringify({page,errors:h.state.errors}));assert.equal(page.page.rows[0].purchase_price_ore,allowed?12345678:null);
 if(!allowed)assert.doesNotMatch(JSON.stringify({snapshot,page}),/12345678|345678|purchase_vat_ore|calculation_version/);
});
test('restricted financial actions deny before private RPC or cost query and permitted finance reads remain intact',async()=>{
 for(const role of ['sales','viewer','finance']){const h=await integration(role);const costs=await h.request(()=>h.costs.loadVehicleCosts({stockItemId:STOCK,expectedCompanyId:COMPANY}));const calc=await h.request(()=>h.calculation.getVehicleCalculationAction({companyId:COMPANY,stockItemId:STOCK}));if(role==='finance'){assert.equal(costs.ok,true,JSON.stringify(h.state.errors));assert.equal(costs.costs[0].amount_ore,345678);assert.equal(calc.ok,true,JSON.stringify({calc,errors:h.state.errors}));}else{assert.equal(costs.ok,false);assert.equal(calc.ok,false);assert.equal(h.state.rpcs.includes('get_vehicle_calculation'),false);}}
});
test('live owner downgrade after inventory SQL withholds the already-read private SSR response',async()=>{
 const h=await integration('owner');h.state.afterRpc=async name=>{if(name==='get_workspace_inventory')await database.query("update public.memberships set role='sales',version=version+1 where company_id=$1 and user_id=$2",[COMPANY,h.state.actor]);};await assert.rejects(h.request(()=>h.workspace.getWorkspaceSnapshot()));
});
