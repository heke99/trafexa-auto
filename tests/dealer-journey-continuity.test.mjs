import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createSourceLoader} from './helpers/source-loader.mjs';
import {snapshot} from './helpers/register-ui/fixtures.mjs';

async function onboarding({data=snapshot({size:0}),admin=null,access={emailVerified:true,status:'approved'}}={}) {
 const loader=await createSourceLoader({
  'next/link':({children,...props})=>createElement('a',props,children),
  'next/navigation':{redirect:path=>{throw Error(`redirect:${path}`);}},
  '@/lib/data/workspace':{getWorkspaceSnapshot:async()=>data},
  '@/lib/platform-admin/context':{getPlatformAdminContext:async()=>admin},
  '@/lib/account-access/context':{getAccountAccessContext:async()=>access},
  '@/lib/data/actions':{signOutAction:()=>{}},
  '@/components/auth-shell':{AuthShell:({children})=>createElement('div',null,children)},
  '@/components/company-onboarding':{CompanyOnboarding:()=>createElement('section',{'aria-label':'Company creation fixture'})},
 });
 return loader.load('src/app/onboarding/page.tsx').default({searchParams:Promise.resolve({})});
}

test('existing active company membership has an explicit return from additional-company onboarding',async()=>{
 const html=renderToStaticMarkup(await onboarding());
 assert.match(html,/<a href="\/settings#settings-account">Tillbaka till företagsinställningar<\/a>/);
 assert.match(html,/Company creation fixture/);
});
test('first company onboarding does not claim an existing company and keeps invitations reachable',async()=>{
 const data=snapshot({size:0});data.organization=null;data.membership=null;data.memberships=[];
 const html=renderToStaticMarkup(await onboarding({data}));
 assert.equal(html.includes('Tillbaka till företagsinställningar'),false);
 assert.match(html,/href="\/invitations"/);
});
test('stale company selection still offers active membership selection instead of trapping onboarding',async()=>{
 const data=snapshot({size:0});data.organization=null;data.membership=null;
 const html=renderToStaticMarkup(await onboarding({data}));
 assert.match(html,/href="\/settings#settings-account"/);
});
test('onboarding return navigation preserves the existing superadmin and account approval gates',async()=>{
 await assert.rejects(onboarding({admin:{userId:'synthetic-admin'}}),/redirect:\/admin/);
 await assert.rejects(onboarding({access:null}),/redirect:\/login/);
 await assert.rejects(onboarding({access:{emailVerified:true,status:'pending'}}),/redirect:\/account-pending/);
 await assert.rejects(onboarding({access:{emailVerified:false,status:'approved'}}),/redirect:\/account-pending/);
});
