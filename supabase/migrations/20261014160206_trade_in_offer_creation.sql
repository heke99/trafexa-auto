begin;
create function private.create_offer_version_with_trade_in(company uuid,deal uuid,submission uuid,terms text,valid_until date,gross_confirmed boolean,trade_in_id uuid,expected_trade_in_version integer,expected_offer_version integer,expected_sale_price_ore bigint) returns uuid language plpgsql security definer set search_path='' as $$
declare actor uuid;role_name text;d public.deals;t private.trade_in_versions;old private.offer_submissions;p jsonb;s jsonb;latest integer;result uuid;issued timestamptz:=clock_timestamp();today date:=(clock_timestamp() at time zone 'Europe/Stockholm')::date;
begin
 select a.actor,a.actor_role into actor,role_name from private.customer_contact_access(company,true)a;
 if submission is null or gross_confirmed is distinct from true or terms is null or length(terms)>2000 or translate(terms,E'\t\n\r','') ~ '[[:cntrl:]]' or valid_until is null then raise exception 'Invalid offer request' using errcode='22023';end if;
 if trade_in_id is not null and (expected_offer_version is null or expected_sale_price_ore is null) then raise exception 'Offer expectations required' using errcode='22023';end if;
 if (trade_in_id is null and expected_trade_in_version is not null) or (trade_in_id is not null and (expected_trade_in_version is null or expected_trade_in_version<1)) or (expected_offer_version is not null and expected_offer_version not between 0 and 2147483646) or (expected_sale_price_ore is not null and expected_sale_price_ore not between 1 and 999999999999) then raise exception 'Invalid offer expectation' using errcode='22023';end if;
 select * into d from public.deals where id=deal and company_id=company for update;
 if not found then if expected_offer_version is null and trade_in_id is null then raise exception 'Deal unavailable' using errcode='P0002';end if;raise exception 'Deal unavailable' using errcode='42501';end if;
 p:=jsonb_build_object('terms',terms,'valid_until',valid_until,'gross_confirmed',gross_confirmed);
 -- Legacy requests retain their exact historical payload for backward-compatible replay.
 if trade_in_id is not null or expected_offer_version is not null or expected_sale_price_ore is not null then p:=p||jsonb_build_object('trade_in_id',trade_in_id,'expected_trade_in_version',expected_trade_in_version,'expected_offer_version',expected_offer_version,'expected_sale_price_ore',expected_sale_price_ore::text);end if;
 select * into old from private.offer_submissions r where r.company_id=company and r.user_id=actor and r.deal_id=deal and r.submission_id=submission;
 if found then if old.payload is distinct from p then if expected_offer_version is null and trade_in_id is null then raise exception 'Offer request conflict' using errcode='22023';end if;raise exception 'Offer request conflict' using errcode='40001';end if;return old.offer_id;end if;
 if valid_until<today or valid_until>today+90 then raise exception 'Invalid offer expiry' using errcode='22023';end if;
 select coalesce(max(version),0) into latest from public.offers where company_id=company and deal_id=deal;
 if d.status not in ('draft','reserved') and expected_offer_version is null and trade_in_id is null then raise exception 'Deal unavailable' using errcode='P0002';end if;
 if d.status not in ('draft','reserved') or expected_offer_version is not null and latest<>expected_offer_version or expected_sale_price_ore is not null and d.sale_price_ore<>expected_sale_price_ore or exists(select 1 from private.offer_reviews where company_id=company and deal_id=deal and status='accepted') then raise exception 'Offer agreement conflict' using errcode='40001';end if;
 if d.sale_price_ore not between 1 and 999999999999 then raise exception 'Invalid offer price' using errcode='22023';end if;
 s:=private.offer_base_snapshot(d,latest+1,terms,valid_until,issued);
 if trade_in_id is not null then
  select * into t from private.trade_in_versions where id=trade_in_id and company_id=company and deal_id=deal;
  if not found or t.customer_id<>d.customer_id or t.version<>expected_trade_in_version or t.version<>(select max(version) from private.trade_in_versions where company_id=company and deal_id=deal) or t.sale_price_ore<>d.sale_price_ore then raise exception 'Trade-in selection conflict' using errcode='40001';end if;
  if not t.debt_known or t.debt_ore is null then raise exception 'Known reviewed debt required' using errcode='22023';end if;
  s:=s||jsonb_build_object('trade_in',jsonb_build_object('id',t.id,'version',t.version,'registration',t.registration,'make',t.make,'model',t.model,'model_year',t.model_year,'mileage_km',t.mileage_km,'value_ore',t.value_ore::text,'debt_known',true,'debt_ore',t.debt_ore::text,'net_trade_in_ore',(t.value_ore-t.debt_ore)::text,'amount_to_pay_ore',(d.sale_price_ore-t.value_ore+t.debt_ore)::text));
 end if;
 insert into public.offers(company_id,deal_id,version,snapshot,created_at)values(company,deal,latest+1,s,issued) returning id into result;
 insert into private.offer_submissions(company_id,user_id,deal_id,submission_id,payload,offer_id)values(company,actor,deal,submission,p,result);return result;
end$$;
revoke all on function private.create_offer_version_with_trade_in(uuid,uuid,uuid,text,date,boolean,uuid,integer,integer,bigint) from public,anon,authenticated,service_role;
commit;
