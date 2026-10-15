import assert from 'node:assert/strict';
import {test} from 'node:test';
import {Webhook} from 'svix';
import {createSourceLoader} from './helpers/source-loader.mjs';
import {id,digest} from './helpers/advertising-invoice-email-fixture.mjs';
const secret=`whsec_${Buffer.alloc(32,9).toString('base64')}`;
async function environment(run,patch={}){const names=['RESEND_WEBHOOK_SECRET','SUPABASE_SECRET_KEY','NEXT_PUBLIC_SUPABASE_URL'],before=Object.fromEntries(names.map(k=>[k,process.env[k]]));try{Object.assign(process.env,{RESEND_WEBHOOK_SECRET:secret,SUPABASE_SECRET_KEY:'TEST-SERVICE',NEXT_PUBLIC_SUPABASE_URL:'https://buqdtssxrotkzndublrt.supabase.co'},patch);await run();}finally{for(const k of names){if(before[k]===undefined)delete process.env[k];else process.env[k]=before[k];}}}
function request(options={}){
 const now=new Date(),body=options.body??JSON.stringify({type:options.type??'email.delivered',created_at:now.toISOString(),data:{email_id:'provider-1',to:['billing@example.test'],tags:{trafexa_invoice_email_id:id(96)},...options.data}}),headers=new Headers({'svix-id':'msg_invoice_route_1','svix-timestamp':String(Math.floor(now.getTime()/1000)),'svix-signature':new Webhook(secret).sign('msg_invoice_route_1',now,body),...options.headers});
 return new Request('https://app.trafexa.com/api/webhooks/resend/invoice-email',{method:'POST',headers,body:options.tamper?body+' ':body});
}
async function harness(options={}){const calls=[];const loader=await createSourceLoader({'@supabase/supabase-js':{createClient(url,key,config){assert.equal(url,'https://buqdtssxrotkzndublrt.supabase.co');assert.equal(key,'TEST-SERVICE');assert.equal(config.auth.persistSession,false);return{rpc:async(name,args)=>{calls.push([name,args]);return options.result??{data:{ok:true},error:null};}};}}});return{route:loader.load('src/app/api/webhooks/resend/invoice-email/route.ts'),calls};}
function privateResponse(r){assert.match(r.headers.get('cache-control'),/private, no-store/);assert.equal(r.headers.get('x-content-type-options'),'nosniff');}
test('real signed raw provider delivery is durably acknowledged through service-only fact RPC with verified outbox tag',async()=>environment(async()=>{
 const h=await harness(),r=await h.route.POST(request());assert.equal(r.status,200);privateResponse(r);assert.equal(h.calls.length,1);const [name,args]=h.calls[0];assert.equal(name,'apply_advertising_invoice_email_event');assert.equal(args.p_email_id,id(96));assert.equal(args.p_event_id,'msg_invoice_route_1');assert.equal(args.p_provider_id,'provider-1');assert.equal(args.p_event_type,'delivered');assert.equal(args.p_recipient_hash,digest('billing@example.test'));assert.ok(!JSON.stringify(args).includes('billing@example.test'));
}));
test('forged signatures, excessive bodies, malformed UTF8/JSON or recipient lists cannot reach database',async()=>environment(async()=>{
 for(const options of [{tamper:true},{headers:{'svix-signature':'v1,invalid'}},{body:'x'.repeat(65537)},{headers:{'content-length':'65537'}},{body:'{'},{data:{to:['a@example.test','b@example.test']}}]){const h=await harness(),r=await h.route.POST(request(options));assert.equal(r.status,400);privateResponse(r);assert.equal(h.calls.length,0);assert.ok(!(await r.text()).includes(secret));}
 const h=await harness(),r=await h.route.POST(new Request('https://app.trafexa.com/api/webhooks/resend/invoice-email',{method:'POST',body:new Uint8Array([0xff])}));assert.equal(r.status,400);assert.equal(h.calls.length,0);
}));
test('unrelated generic email and tracking events are acknowledged without storing recipient or changing invoice state',async()=>environment(async()=>{
 for(const options of [{type:'email.opened'},{type:'email.sent'},{data:{tags:{}}}]){const h=await harness(),r=await h.route.POST(request(options));assert.equal(r.status,200);assert.equal(h.calls.length,0);}
}));
test('missing server configuration fails closed and transient or malformed database acknowledgements request provider retry',async()=>{
 for(const patch of [{SUPABASE_SECRET_KEY:''},{RESEND_WEBHOOK_SECRET:''},{NEXT_PUBLIC_SUPABASE_URL:'https://foreign.supabase.co'}])await environment(async()=>{const h=await harness(),r=await h.route.POST(request());assert.equal(r.status,503);privateResponse(r);assert.equal(h.calls.length,0);},patch);
 await environment(async()=>{for(const result of [{data:null,error:{code:'08006',message:'PRIVATE DB DETAILS'}},{data:null,error:null},{data:{ok:false},error:null}]){const h=await harness({result}),r=await h.route.POST(request());assert.equal(r.status,503);privateResponse(r);assert.ok(!(await r.text()).includes('PRIVATE DB'));}});
});
