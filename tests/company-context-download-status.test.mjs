import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createSourceLoader } from './helpers/source-loader.mjs';

const id='00000000-0000-4000-8000-000000000001';
for(const [scenario,status] of [['anonymous',401],['no membership',403],['database unavailable',503]]) {
  test(`issued invoice uses actual company context: ${scenario} returns ${status} without reading or rendering`,async()=>{
    const forbidden=()=>assert.fail('Denied context must not reach financial data or rendering');
    const query={select(){return this;},eq(){return this;},async order(){return {data:[],error:scenario==='database unavailable'?{message:'private provider diagnostic'}:null};}};
    const loader=await createSourceLoader({
      react:{cache:fn=>fn},
      'next/headers':{async cookies(){return {get(){return undefined;}};}},
      '@/lib/supabase/server':{async createServerSupabaseClient(){return {
        auth:{async getUser(){return {data:{user:scenario==='anonymous'?null:{id,email:'fixture@example.invalid'}},error:null};}},
        from(){return query;},
      };}},
      '@/lib/account-access/context':{async readAccountAccess(){return {status:'approved',emailVerified:true};}},
      '@/lib/contracts/context':{requireContractContext:forbidden},
      '@/lib/platform-admin/context':{requirePlatformAdminContext:forbidden},
      '@/lib/advertising/issuance-actions':{getAdvertisingIssuedInvoiceAction:forbidden,getPlatformAdvertisingIssuedInvoiceAction:forbidden},
      '@/lib/documents/advertising-issued-invoice-pdf':{generateAdvertisingIssuedInvoicePdf:forbidden},
    });
    const route=loader.load('src/app/api/advertising/issued/[id]/pdf/route.ts');
    const response=await route.GET(new Request(`https://app.trafexa.com/api/advertising/issued/${id}/pdf`),{params:Promise.resolve({id})});
    assert.equal(response.status,status);
    assert.match(response.headers.get('cache-control'),/private, no-store/);
    assert.doesNotMatch(await response.text(),/private provider diagnostic|%PDF/);
  });
}
