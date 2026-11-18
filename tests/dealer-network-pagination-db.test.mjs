import{test}from'node:test';import assert from'node:assert/strict';import{createDatabase,asRole}from'./company-team-db/helpers.mjs';
const id=n=>`bb171700-0000-4000-8000-${String(n).padStart(12,'0')}`;
test('network keyset pages reach all 503 own cars, 103 conversations and 153 messages without tenant leakage',async()=>{
 const db=await createDatabase();try{
  await db.query("insert into auth.users(id,email,email_confirmed_at)values($1,'owner-pagination@example.test',now()),($2,'foreign-pagination@example.test',now()),($3,'finance-pagination@example.test',now())",[id(1),id(2),id(3)]);
  await db.query("insert into public.companies(id,name,organisation_number,created_by)values($1,'Ours','5568554884',$3),($2,'Other','5568554884',$4)",[id(101),id(102),id(1),id(2)]);
  await db.query("insert into public.memberships(company_id,user_id,role)values($1,$3,'owner'),($2,$4,'owner'),($1,$5,'finance')",[id(101),id(102),id(1),id(2),id(3)]);
  await db.query("insert into public.vehicles(id,company_id,registration_number,make,model,model_year)select ('bb171700-0000-4000-8000-'||lpad((1000+n)::text,12,'0'))::uuid,$1,'REG'||n,'Volvo','V60',2022 from generate_series(1,503)n",[id(101)]);
  await db.query("insert into public.stock_items(id,company_id,vehicle_id,purchase_price_ore,asking_price_ore,vat_scheme)select ('bb171700-0000-4000-8000-'||lpad((right(id::text,12)::bigint+1000)::text,12,'0'))::uuid,$1,id,10000,20000,'unknown'from public.vehicles where company_id=$1",[id(101)]);
  await db.query("insert into private.dealer_network_listings(id,company_id,stock_id,source)select ('bb171700-0000-4000-8000-'||lpad((3000+n)::text,12,'0'))::uuid,$1,('bb171700-0000-4000-8000-'||lpad((2000+n)::text,12,'0'))::uuid,'{}' from generate_series(1,103)n",[id(101)]);
  await db.query("insert into private.dealer_network_inquiries(id,listing_id,buyer_company_id,seller_company_id,sender_email,vehicle_title,created_at)select ('bb171700-0000-4000-8000-'||lpad((4000+n)::text,12,'0'))::uuid,('bb171700-0000-4000-8000-'||lpad((3000+n)::text,12,'0'))::uuid,$2,$1,'contact@example.test','Vehicle'||n,'2026-11-17T12:00:00Z' from generate_series(1,103)n",[id(101),id(102)]);
  await db.query("insert into private.dealer_network_messages(id,inquiry_id,company_id,message,created_at)select ('bb171700-0000-4000-8000-'||lpad((5000+n)::text,12,'0'))::uuid,$1,$2,'Message'||n,'2026-11-17T12:00:00Z' from generate_series(1,153)n",[id(4001),id(101)]);
  const call=(fn,args,actor=id(1))=>asRole(db,'authenticated',actor,async tx=>(await tx.query(`select public.${fn}(${args.map((_,i)=>'$'+(i+1)).join(',')})data`,args)).rows[0].data);
  const page=await call('dealer_network_page',[id(101),'',0]);assert.equal(page.own.length,50);assert.equal(page.threads.length,50);assert.equal(page.hasMoreOwn,true);assert.equal(page.hasMoreThreads,true);
  const own=[...page.own],threads=[...page.threads];let more=true;
  while(more){const next=await call('dealer_network_more',[id(101),'own',own.at(-1).stockId,null]);own.push(...next.own);more=next.hasMore;}assert.equal(own.length,503);assert.equal(new Set(own.map(x=>x.stockId)).size,503);
  more=true;while(more){const next=await call('dealer_network_more',[id(101),'threads',threads.at(-1).id,null]);threads.push(...next.threads);more=next.hasMore;}assert.equal(threads.length,103);assert.equal(new Set(threads.map(x=>x.id)).size,103);
  const messages=[...page.threads[0].messages];assert.equal(messages.length,100);more=true;while(more){const next=await call('dealer_network_more',[id(101),'messages',messages[0].id,id(4001)]);messages.unshift(...next.messages);more=next.hasMore;}assert.equal(messages.length,153);assert.equal(messages[0].text,'Message1');assert.equal(messages.at(-1).text,'Message153');
  await assert.rejects(()=>call('dealer_network_more',[id(101),'own',own[0].stockId,null],id(2)),error=>error.code==='42501');await assert.rejects(()=>call('dealer_network_more',[id(101),'own',own[0].stockId,null],id(3)),error=>error.code==='42501');await assert.rejects(()=>call('dealer_network_more',[id(102),'threads',id(9999),null],id(2)),error=>error.code==='42501');
 }finally{await db.close();}
});
