-- Synthetic, collision-checked, rollback-only proof. No committed message or email.
begin;
do $$begin
 if exists(select 1 from auth.users where id::text like 'fd250000-0000-4000-8000-%')
 or exists(select 1 from public.companies where id::text like 'fd250000-0000-4000-8000-%')
 or exists(select 1 from private.dealer_network_listings where company_id::text like 'fd250000-0000-4000-8000-%')
 then raise exception 'Dealer network proof collision';end if;
end$$;
insert into auth.users(id,email,email_confirmed_at)
 select ('fd250000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'network-proof-'||n||'@fixture.invalid',now() from generate_series(1,4)n;
insert into private.account_approvals(user_id,status,updated_by)
 select id,'approved','fd250000-0000-4000-8000-000000000001' from auth.users where id::text like 'fd250000-0000-4000-8000-%' on conflict do nothing;
insert into public.companies(id,name,organisation_number,created_by)
 select ('fd250000-0000-4000-8000-'||lpad((100+n)::text,12,'0'))::uuid,
 'Network rollback fd250000 '||case n when 1 then 'publisher'when 2 then 'buyer'else 'third'end,'5568554884',('fd250000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid from generate_series(1,3)n;
insert into public.memberships(id,company_id,user_id,role)
 select ('fd250000-0000-4000-8000-'||lpad((200+n)::text,12,'0'))::uuid,('fd250000-0000-4000-8000-'||lpad((100+n)::text,12,'0'))::uuid,('fd250000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'owner' from generate_series(1,3)n;
insert into public.memberships(id,company_id,user_id,role) values('fd250000-0000-4000-8000-000000000204','fd250000-0000-4000-8000-000000000101','fd250000-0000-4000-8000-000000000004','viewer');
insert into public.vehicles(id,company_id,registration_number,make,model,model_year)
 values('fd250000-0000-4000-8000-000000000301','fd250000-0000-4000-8000-000000000101','NWF250','Volvo','V60',2022);
insert into public.stock_items(id,company_id,vehicle_id,purchase_price_ore,asking_price_ore,vat_scheme)
 values('fd250000-0000-4000-8000-000000000302','fd250000-0000-4000-8000-000000000101','fd250000-0000-4000-8000-000000000301',13712345,25000000,'standard');
create temporary table dealer_network_proof(k text primary key,v jsonb);grant select,insert on dealer_network_proof to authenticated;
set local role authenticated;
set local request.jwt.claim.sub='fd250000-0000-4000-8000-000000000001';
insert into dealer_network_proof values('before',public.dealer_network_page('fd250000-0000-4000-8000-000000000101','',0));
insert into dealer_network_proof values('publishPayload',jsonb_build_object('action','publish','stockId','fd250000-0000-4000-8000-000000000302','version',0,'consent',true,'source',(select v->'own'->0->'source'from dealer_network_proof where k='before')));
insert into dealer_network_proof values('published',public.dealer_network_mutate('fd250000-0000-4000-8000-000000000101','fd250000-0000-4000-8000-000000000901',(select v from dealer_network_proof where k='publishPayload')));
do $$begin
 if public.dealer_network_mutate('fd250000-0000-4000-8000-000000000101','fd250000-0000-4000-8000-000000000901',(select v from dealer_network_proof where k='publishPayload'))is distinct from(select v from dealer_network_proof where k='published')then raise exception 'Network replay changed';end if;
end$$;
set local request.jwt.claim.sub='fd250000-0000-4000-8000-000000000002';
insert into dealer_network_proof values('browse',public.dealer_network_page('fd250000-0000-4000-8000-000000000102','Network rollback fd250000 publisher',0));
do $$declare p jsonb;item jsonb;begin
 select v into p from dealer_network_proof where k='browse';
 select x into item from jsonb_array_elements(p->'items')x where x->>'id'=(select v->'receipt'->>'id'from dealer_network_proof where k='published');
 if item is null or item->'vehicle'->>'priceOre'<>'25000000'then raise exception 'Published vehicle missing';end if;
 if item->'vehicle' ?| array['purchase_price_ore','purchasePriceOre','registration','registration_number','company_id','stock_id','costs','customer','finance']or position('13712345'in item::text)>0 then raise exception 'Private vehicle fields leaked';end if;
 if (select count(*)from jsonb_object_keys(item->'vehicle'))<>9 then raise exception 'Unexpected vehicle fields';end if;
 begin perform 1 from private.dealer_network_inquiries;raise exception 'Private inquiries directly readable';exception when insufficient_privilege then null;end;
end$$;
insert into dealer_network_proof values('interestPayload',jsonb_build_object('action','inquire','listingId',(select v->'receipt'->>'id'from dealer_network_proof where k='published'),'version',1,'message','Synthetic network interest','consent',true));
insert into dealer_network_proof values('interested',public.dealer_network_mutate('fd250000-0000-4000-8000-000000000102','fd250000-0000-4000-8000-000000000902',(select v from dealer_network_proof where k='interestPayload')));
do $$begin
 if public.dealer_network_mutate('fd250000-0000-4000-8000-000000000102','fd250000-0000-4000-8000-000000000902',(select v from dealer_network_proof where k='interestPayload'))is distinct from(select v from dealer_network_proof where k='interested')then raise exception 'Inquiry replay changed';end if;
end$$;
set local request.jwt.claim.sub='fd250000-0000-4000-8000-000000000003';
do $$begin
 if jsonb_array_length(public.dealer_network_page('fd250000-0000-4000-8000-000000000103','',0)->'threads')<>0 then raise exception 'Third-party inbox leak';end if;
 begin perform public.dealer_network_mutate('fd250000-0000-4000-8000-000000000103','fd250000-0000-4000-8000-000000000903',jsonb_build_object('action','reply','inquiryId',(select v->'receipt'->>'id'from dealer_network_proof where k='interested'),'message','Forbidden third-party reply'));raise exception 'Third-party reply allowed';exception when insufficient_privilege then null;end;
end$$;
set local request.jwt.claim.sub='fd250000-0000-4000-8000-000000000004';
do $$begin
 if jsonb_array_length(public.dealer_network_page('fd250000-0000-4000-8000-000000000101','',0)->'threads')<>0 then raise exception 'Viewer inbox leak';end if;
 begin perform public.dealer_network_mutate('fd250000-0000-4000-8000-000000000101','fd250000-0000-4000-8000-000000000904',jsonb_build_object('action','reply','inquiryId',(select v->'receipt'->>'id'from dealer_network_proof where k='interested'),'message','Forbidden viewer reply'));raise exception 'Viewer reply allowed';exception when insufficient_privilege then null;end;
end$$;
set local request.jwt.claim.sub='fd250000-0000-4000-8000-000000000001';
do $$declare p jsonb;t jsonb;begin
 p:=public.dealer_network_page('fd250000-0000-4000-8000-000000000101','',0);t:=p->'threads'->0;
 if t->>'senderEmail'<>'network-proof-2@fixture.invalid'or t->'messages'->0->>'text'<>'Synthetic network interest'then raise exception 'Seller inbox missing consented inquiry';end if;
end$$;
insert into dealer_network_proof values('replied',public.dealer_network_mutate('fd250000-0000-4000-8000-000000000101','fd250000-0000-4000-8000-000000000905',jsonb_build_object('action','reply','inquiryId',(select v->'receipt'->>'id'from dealer_network_proof where k='interested'),'message','Synthetic network response')));
reset role;
update public.stock_items set status='reserved'where id='fd250000-0000-4000-8000-000000000302';
set local role authenticated;set local request.jwt.claim.sub='fd250000-0000-4000-8000-000000000002';
do $$declare p jsonb;begin
 p:=public.dealer_network_page('fd250000-0000-4000-8000-000000000102','Network rollback fd250000 publisher',0);
 if exists(select 1 from jsonb_array_elements(p->'items')x where x->>'id'=(select v->'receipt'->>'id'from dealer_network_proof where k='published'))then raise exception 'Reserved vehicle advertised as available';end if;
 if jsonb_array_length(p->'threads'->0->'messages')<>2 then raise exception 'Buyer response missing or duplicate';end if;
end$$;
set local request.jwt.claim.sub='fd250000-0000-4000-8000-000000000001';
insert into dealer_network_proof values('withdrawn',public.dealer_network_mutate('fd250000-0000-4000-8000-000000000101','fd250000-0000-4000-8000-000000000906',jsonb_build_object('action','withdraw','stockId','fd250000-0000-4000-8000-000000000302','version',1)));
reset role;
do $$begin
 if(select count(*)from private.dealer_network_requests where company_id::text like 'fd250000-0000-4000-8000-%')<>4 then raise exception 'Unexpected network receipt count';end if;
 if(select count(*)from private.dealer_network_messages where company_id::text like 'fd250000-0000-4000-8000-%')<>2 then raise exception 'Unexpected network message count';end if;
 if(select status from public.stock_items where id='fd250000-0000-4000-8000-000000000302')<>'reserved'then raise exception 'Network changed reservation state';end if;
end$$;
rollback;
