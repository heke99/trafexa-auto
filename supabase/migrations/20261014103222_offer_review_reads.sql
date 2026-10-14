begin;
create function private.offer_review_snapshot(s jsonb) returns jsonb language sql immutable set search_path='' as $$
 select (select jsonb_object_agg(k,s->k) from unnest(array['schema_version','document_type','version','deal_id','issued_at','valid_until','terms','currency','price_basis','sale_price_ore']) k)
 || jsonb_build_object('company',(select jsonb_object_agg(k,s->'company'->k) from unnest(array['id','name','organisation_number']) k),'customer',(select jsonb_object_agg(k,s->'customer'->k) from unnest(array['id','kind','name','email','phone','address']) k),'stock',(select jsonb_object_agg(k,s->'stock'->k) from unnest(array['id','vat_scheme']) k),'vehicle',(select jsonb_object_agg(k,s->'vehicle'->k) from unnest(array['id','registration_number','vin','make','model','model_year','mileage_km','fuel','gearbox']) k),'vat',(select jsonb_object_agg(k,s->'vat'->k) from unnest(array['rate_percent','amount_ore','net_price_ore']) k)); $$;
create function private.offer_review_json(r private.offer_reviews,p_snapshot boolean default false) returns jsonb language sql set search_path='' as $$
 select jsonb_build_object('id',r.id,'companyId',r.company_id,'dealId',r.deal_id,'offerId',r.offer_id,'offerVersion',r.offer_version,'recipientEmail',r.recipient_email,'status',case when r.status<>'pending' then r.status when c.status<>'active' or d.status not in ('draft','reserved') then 'unavailable' when o.version<>(select max(version) from public.offers where company_id=r.company_id and deal_id=r.deal_id) then 'superseded' when (o.snapshot->>'valid_until')::date<(clock_timestamp() at time zone 'Europe/Stockholm')::date then 'expired' else 'pending' end,'version',r.version,'createdAt',r.created_at,'decidedAt',r.decided_at,'responderName',r.responder_name,'reason',r.reason)
 || case when p_snapshot then jsonb_build_object('snapshot',private.offer_review_snapshot(o.snapshot)) else '{}'::jsonb end
 from public.offers o join public.deals d on d.company_id=r.company_id and d.id=r.deal_id join public.companies c on c.id=r.company_id where o.company_id=r.company_id and o.id=r.offer_id;
$$;
revoke all on function private.offer_review_snapshot(jsonb),private.offer_review_json(private.offer_reviews,boolean) from public,anon,authenticated,service_role;
create function private.list_deal_offer_reviews(p_company_id uuid,p_deal_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare a uuid;r text;rows jsonb;latest jsonb;begin
 select actor,actor_role into a,r from private.customer_contact_access(p_company_id,false);
 perform 1 from public.deals where company_id=p_company_id and id=p_deal_id for share;
 if not found then raise exception 'Deal access denied' using errcode='42501';end if;
 select coalesce(jsonb_agg(private.offer_review_json(x) order by x.offer_version desc,x.id desc),'[]') into rows from (select * from private.offer_reviews where company_id=p_company_id and deal_id=p_deal_id order by offer_version desc,id desc limit 50)x;
 select jsonb_build_object('offerId',id,'offerVersion',version,'recipientEmail',nullif(lower(btrim(snapshot#>>'{customer,email}')),''),'validUntil',snapshot->>'valid_until','vatScheme',snapshot#>>'{stock,vat_scheme}') into latest from public.offers where company_id=p_company_id and deal_id=p_deal_id order by version desc limit 1;
 return jsonb_build_object('companyId',p_company_id,'actorUserId',a,'actorRole',r,'reviews',rows,'latestOffer',latest);end $$;
create function private.list_my_offer_reviews(p_page_key uuid,p_limit integer) returns jsonb language plpgsql security definer set search_path='' as $$
declare a uuid;e text;rows jsonb;n uuid;begin
 select user_id,email into a,e from private.company_team_identity(true);
 if p_limit is null or p_limit not between 1 and 50 then raise exception 'Invalid limit' using errcode='22023';end if;
 if p_page_key is not null and not exists(select 1 from private.offer_reviews r join public.companies c on c.id=r.company_id and c.status='active' where r.id=p_page_key and r.recipient_email=e) then raise exception 'Cursor conflict' using errcode='40001';end if;
 select coalesce(jsonb_agg(private.offer_review_json(x,true) order by x.id desc),'[]') into rows from (select r.* from private.offer_reviews r join public.companies c on c.id=r.company_id and c.status='active' where r.recipient_email=e and (p_page_key is null or r.id<p_page_key) order by r.id desc limit p_limit)x;
 if jsonb_array_length(rows)=p_limit and exists(select 1 from private.offer_reviews r join public.companies c on c.id=r.company_id and c.status='active' where r.recipient_email=e and r.id<(rows->(p_limit-1)->>'id')::uuid) then n:=(rows->(p_limit-1)->>'id')::uuid;end if;
 return jsonb_build_object('actorUserId',a,'recipientEmail',e,'reviews',rows,'nextPageKey',n);end $$;
create function public.list_deal_offer_reviews(p_company_id uuid,p_deal_id uuid) returns jsonb language sql security invoker set search_path='' as $$select private.list_deal_offer_reviews(p_company_id,p_deal_id);$$;
create function public.list_my_offer_reviews(p_page_key uuid default null,p_limit integer default 50) returns jsonb language sql security invoker set search_path='' as $$select private.list_my_offer_reviews(p_page_key,p_limit);$$;
revoke all on function private.list_deal_offer_reviews(uuid,uuid),private.list_my_offer_reviews(uuid,integer),public.list_deal_offer_reviews(uuid,uuid),public.list_my_offer_reviews(uuid,integer) from public,anon,authenticated,service_role;
grant execute on function private.list_deal_offer_reviews(uuid,uuid),private.list_my_offer_reviews(uuid,integer),public.list_deal_offer_reviews(uuid,uuid),public.list_my_offer_reviews(uuid,integer) to authenticated;
commit;
