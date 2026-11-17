import {writeFile,chmod} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {createClient} from '@supabase/supabase-js';
import {localState,localSql} from './local-state.mjs';
const {url,publishable,secret}=localState();
const email='starter-admin@example.invalid',password='Local-Trafexa-Fixture-Only-2026!';
const service=createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}});
const listed=await service.auth.admin.listUsers({perPage:1000});if(listed.error)throw Error('Local Auth user catalog is unavailable');
let user=listed.data.users.find(u=>u.email===email);
if(!user){const created=await service.auth.admin.createUser({email,password,email_confirm:true});if(created.error)throw Error('Synthetic local Auth bootstrap failed');user=created.data.user;}
if(!user?.id||!/^[a-f0-9-]{36}$/i.test(user.id)||!user.email_confirmed_at)throw Error('Synthetic local user was not verified');
localSql(`begin;insert into private.account_approvals(user_id,status,updated_by)values('${user.id}','approved','${user.id}')on conflict(user_id)do nothing;insert into private.platform_admin_bootstrap_reservations(email,approval_reference)values('${email}','Local starter fixture only')on conflict(email)do nothing;commit;`);
const actor=createClient(url,publishable,{auth:{persistSession:false,autoRefreshToken:false}});
const login=await actor.auth.signInWithPassword({email,password});if(login.error||login.data.user.id!==user.id)throw Error('Synthetic local login failed; inspect the local fixture, do not change a real account');
const claim=await actor.rpc('claim_platform_admin_access');if(claim.error||claim.data?.user_id!==user.id||claim.data?.is_platform_admin!==true)throw Error('Local bootstrap UUID binding failed');
await actor.auth.signOut();
const target=new URL('../.env.local',import.meta.url);
const env=`NEXT_PUBLIC_SUPABASE_URL=${url}\nNEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=${publishable}\nSUPABASE_SECRET_KEY=${secret}\nNEXT_PUBLIC_APP_URL=http://localhost:3000\nNEXT_PUBLIC_SITE_URL=http://localhost:3000\nNEXT_PUBLIC_TRAFEXA_DEPLOYMENT_TARGET=local\nUPLOADED_PDF_LINK_SECRET=${randomBytes(32).toString('hex')}\nTRANSACTIONAL_EMAIL_ENABLED=false\nCONTRACT_EMAIL_ENABLED=false\nTRANSACTIONAL_EMAIL_DOMAIN_VERIFIED=false\nADVERTISING_INVOICE_EMAIL_ENABLED=false\nBLOCKET_DISPATCH_ENABLED=false\n`;
try{await writeFile(target,env,{flag:'wx',mode:0o600});await chmod(target,0o600);}catch(e){if(e.code!=='EEXIST')throw e;console.log('.env.local already exists and was preserved. Inspect the local configuration securely without logging credentials.');}
console.log(`Local bootstrap verified for synthetic ${email}. Local-only fixture password is documented in docs/LOCAL_SETUP.md. No external email transport is enabled.`);
