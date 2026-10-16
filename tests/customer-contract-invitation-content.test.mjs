import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import { createSourceLoader } from './helpers/source-loader.mjs';

const emailId = 'bb260000-0000-4000-8000-000000000001';
const invitationId = 'bb260000-0000-4000-8000-000000000002';
const referenceId = 'bb260000-0000-4000-8000-000000000003';
const token = randomBytes(32).toString('base64url');
const loader = await createSourceLoader();
const { renderCustomerContractInvitationBody } = loader.load('@/lib/email/customer-contract-invitation-content');
const { guestDocumentToken, parseGuestDocumentCookie } = loader.load('@/lib/guest-customer/token');
const input = { emailId, invitationId, referenceId, kind: 'contract_invitation', recipient: 'synthetic@example.invalid', token, expiresAt: new Date(Date.now()+7*86400_000).toISOString() };

test('offer, contract and completion mails use personal document links without creating accounts or asking for passwords', () => {
  for (const kind of ['offer_invitation','contract_invitation','contract_completed']) {
    const body = JSON.parse(renderCustomerContractInvitationBody({ ...input, kind }));
    assert.deepEqual(body.to,[input.recipient]);
    assert.match(body.text,/Du behöver inget konto eller lösenord/);
    assert.doesNotMatch(body.text,/Aktivera|Logga in|Välj.*lösenord|ansökan|godkänd|företagskonto/);
    const url = new URL(body.text.match(/https:\/\/\S+/)[0]);
    assert.equal(url.origin,'https://app.trafexa.com');assert.equal(url.pathname,'/customer-document/invitation');
    assert.equal(url.searchParams.get('token'),token);assert.equal(url.searchParams.get('invitation'),invitationId);
    assert.match(body.html,/&amp;token=/);assert.match(body.text,/Länken gäller till/);
    if(kind==='contract_completed'){assert.equal(body.subject,'Avtalet är undertecknat');assert.match(body.text,/Hämta ditt avtal/);}
  }
});

test('guest cookie strictly binds an intent and a canonical 256-bit capability, never a recipient or account', () => {
  const value=guestDocumentToken(invitationId.toUpperCase(),token);
  assert.equal(value.invitationId,invitationId);assert.deepEqual(parseGuestDocumentCookie(value.value),value);
  for(const candidate of [null,'',token,`v2.${invitationId}.${token}`,`v1.${invitationId}.${token}.extra`,`v1.${invitationId}.${'x'.repeat(42)}`]) assert.equal(parseGuestDocumentCookie(candidate),null);
  for(const altered of [{token:'x'.repeat(42)},{invitationId:'invalid'},{recipient:'forged\nrecipient@example.invalid'}])assert.throws(()=>renderCustomerContractInvitationBody({...input,...altered}));
});

test('document-link GET only deposits an HttpOnly capability and cleans URL without Auth, review, signing or token consumption', async()=>{
  const changes=[];
  const source=await createSourceLoader({
    '@/lib/auth/app-origin':{getAuthAppOrigin:()=> 'https://app.trafexa.com'},
    '@/lib/supabase/server':{createServerSupabaseClient:()=>assert.fail('GET must never use Auth')},
    'next/server':{NextResponse:{redirect:url=>({url:String(url),headers:new Headers(),cookies:{set:(...args)=>changes.push(args)}})}},
  });
  const handler=source.load('src/app/customer-document/invitation/route.ts').GET;
  const response=await handler({nextUrl:new URL(`https://app.trafexa.com/customer-document/invitation?invitation=${invitationId}&token=${token}&next=https://attacker.invalid`)});
  assert.equal(response.url,'https://app.trafexa.com/customer-document');
  assert.equal(response.headers.get('cache-control'),'private, no-store');assert.equal(response.headers.get('referrer-policy'),'no-referrer');
  assert.deepEqual(changes[0],['trafexa-guest-document',`v1.${invitationId}.${token}`,{httpOnly:true,secure:true,sameSite:'lax',path:'/customer-document',maxAge:604800}]);
  const invalid=await handler({nextUrl:new URL('https://app.trafexa.com/customer-document/invitation?invitation=invalid&token=invalid')});
  assert.equal(new URL(invalid.url).pathname,'/customer-document');assert.equal(changes[1][1],'');assert.equal(changes[1][2].maxAge,0);
});
