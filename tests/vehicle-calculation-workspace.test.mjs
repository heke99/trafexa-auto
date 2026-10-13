import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createSourceLoader } from './helpers/source-loader.mjs';
const COMPANY='10000000-0000-4000-8000-000000000001', OTHER='10000000-0000-4000-8000-000000000002';
const organization={id:COMPANY,name:'Fixture dealer',organisation_number:'1234567890'};
const membership={company_id:COMPANY,role:'owner',companies:organization};
const totals={companyId:COMPANY,activeStockCount:'900',availableStockCount:'750',purchaseValueOre:'9007199254740993',activeDealCount:'700',reservedDealCount:'510',customerCount:'800'};
const stock=Array.from({length:501},(_,index)=>({id:`stock-${index}`,company_id:COMPANY,status:'available',acquired_on:'2026-10-13',purchase_price_ore:10000,asking_price_ore:20000,vat_scheme:'unknown',vehicles:{id:`vehicle-${index}`,make:'Fixture',model:'Vehicle',registration_number:`FIX${index}`,model_year:2020,mileage_km:0,fuel:'petrol',gearbox:'automatic'}}));
async function harness({data=totals,error=null}={}) {
 const calls=[];
 const db={rpc:async(name,args)=>{calls.push({name,args});return {data,error};},from(table){let cap=Infinity;const query={select(){return query;},eq(key,value){assert.equal(value,COMPANY);return query;},order(){return query;},limit(value){cap=value;return query;},range(){return query;},then(resolve,reject){return Promise.resolve({data:table==='stock_items'?stock.slice(0,cap):[],error:null}).then(resolve,reject);}};return query;}};
 const loader=await createSourceLoader({'./company-context':{getCompanySession:async()=>({db,user:{id:'verified-user',email:'fixture@example.test'},membership,memberships:[membership]})},
  'next/dynamic':loader=>function DynamicSlot(props){return loader.toString().includes('advertising-workspace')?createElement('section',{'data-advertising-company':props.companyId,'data-advertising-role':props.role,'data-demo':String(props.demo)}):null;},
  'next/link':props=>createElement('a',props,props.children), '@/lib/data/actions':{}, './stock-import':{StockImport:()=>null}, './deal-offers':{DealOffers:()=>null}, './customer-leads':{CustomerLeads:()=>null},
 });
 return {calls,loader,workspace:loader.load('./src/lib/data/workspace.ts'),DealerWorkspace:loader.load('./src/components/dealer-workspace.tsx').DealerWorkspace};
}
test('real snapshot includes typed full-company RPC totals while table samples remain capped at500',async()=>{
 const {workspace,calls}=await harness();const snapshot=await workspace.getWorkspaceSnapshot();
 assert.equal(snapshot.inventory.length,500);assert.deepEqual(snapshot.dashboardTotals,totals);
 assert.deepEqual(calls,[{name:'inventory_dashboard_totals',args:{p_company_id:COMPANY}}]);
});
test('actual live dashboard renders authoritative counts and exact ore instead of sampled rows',async()=>{
 const {workspace,DealerWorkspace}=await harness();const snapshot=await workspace.getWorkspaceSnapshot();
 const html=renderToStaticMarkup(createElement(DealerWorkspace,{snapshot,section:'dashboard'}));
 for(const count of ['900','700','800'])assert.ok(html.includes(`<strong>${count}</strong>`));
 assert.ok(html.includes('750 tillgängliga'));assert.ok(html.includes('510 reservationer'));
 assert.ok(html.includes('90 071 992 547 409,93 kr'));assert.equal(html.includes('<strong>500</strong>'),false);
});
test('missing, wrong-company and numeric monetary RPC totals produce no sampled fallback in the live dashboard',async()=>{
 for(const config of [{error:{message:'private diagnostics'}},{data:{...totals,companyId:OTHER}},{data:{...totals,purchaseValueOre:Number.MAX_SAFE_INTEGER+1}}]){
  const {workspace,DealerWorkspace}=await harness(config);const snapshot=await workspace.getWorkspaceSnapshot();assert.equal(snapshot.dashboardTotals,undefined);
  const html=renderToStaticMarkup(createElement(DealerWorkspace,{snapshot,section:'dashboard'}));
  assert.ok(html.includes('Företagets totalsiffror kunde inte verifieras'));assert.equal((html.match(/<strong>—<\/strong>/g)??[]).length,4);
  assert.equal(html.includes('<strong>500</strong>'),false);assert.equal(html.includes('private diagnostics'),false);
 }
});
test('advertising route, actual navigation and section pass the correct company/role scope without changing company context',async()=>{
 const {workspace,DealerWorkspace,loader}=await harness();const snapshot=await workspace.getWorkspaceSnapshot();
 const routing=loader.load('./src/lib/routing.mjs');assert.ok(routing.WORKSPACE_SECTIONS.includes('advertising'));
 assert.equal(routing.domainRedirect('trafexa.com','/advertising'),'https://app.trafexa.com/advertising');
 const html=renderToStaticMarkup(createElement(DealerWorkspace,{snapshot,section:'advertising'}));
 assert.ok(html.includes('href="/advertising"'));assert.ok(html.includes(`data-advertising-company="${COMPANY}"`));assert.ok(html.includes('data-advertising-role="owner"'));assert.ok(html.includes('data-demo="false"'));
});
