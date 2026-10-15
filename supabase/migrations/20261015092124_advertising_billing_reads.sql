begin;
create function private.advertising_billing_context(p_company uuid,p_platform boolean) returns text language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid();mr text;
begin
 perform private.company_team_account(actor,true);
 if p_platform then
  if not private.has_platform_admin() then raise exception 'Platform administrator required' using errcode='42501';end if;
  perform 1 from private.platform_admins where user_id=actor and status='active' for share;
  if not found then raise exception 'Platform administrator required' using errcode='42501';end if;
  perform 1 from public.companies where id=p_company for share;
  if not found then raise exception 'Company missing' using errcode='42501';end if;
  mr:='platform_admin';
 else
  perform private.advertising_context(p_company,null,actor,array['owner','admin','finance'],true);
  select role into mr from public.memberships where company_id=p_company and user_id=actor and status='active';
 end if;
 perform pg_advisory_xact_lock(hashtextextended('advertising-billing:'||p_company::text,0));
 return mr;
end $$;
create function private.advertising_billing_read(p_company uuid,p_month text,p_platform boolean default false) returns jsonb language plpgsql security definer set search_path='' as $$
declare mr text;ps timestamptz;pe timestamptz;tracking timestamptz;items jsonb;rates jsonb;total numeric;n bigint;unpriced bigint;snapshot jsonb;token text;closed private.advertising_billing_periods;
begin
 mr:=private.advertising_billing_context(p_company,p_platform);
 if p_month is null or p_month !~ '^(20[0-9]{2}|2100)-(0[1-9]|1[0-2])$' then raise exception 'Invalid month' using errcode='22023';end if;
 ps:=(p_month||'-01')::date::timestamp at time zone 'Europe/Stockholm';
 pe:=((p_month||'-01')::date+interval '1 month')::timestamp at time zone 'Europe/Stockholm';
 select started_at into tracking from private.advertising_usage_tracking;
 select count(*),count(*) filter(where pp.publication_id is null),coalesce(sum(pp.unit_price_ore::numeric),0) into n,unpriced,total
 from private.advertising_publications p left join private.advertising_publication_prices pp on pp.publication_id=p.id where p.company_id=p_company and p.first_published_at>=ps and p.first_published_at<pe;
 if n>2000 or total>9223372036854775807 then raise exception 'Billing period too large' using errcode='22023';end if;
 select coalesce(jsonb_agg(jsonb_build_object('publicationId',p.id,'listingId',p.listing_id,'channel',p.channel,'publishedAt',p.first_published_at,'unitPriceOre',pp.unit_price_ore::text,'priceSource',pp.source,'rateVersion',r.version) order by p.first_published_at,p.id),'[]') into items
 from private.advertising_publications p left join private.advertising_publication_prices pp on pp.publication_id=p.id left join private.advertising_channel_rates r on r.id=pp.rate_id
 where p.company_id=p_company and p.first_published_at>=ps and p.first_published_at<pe;
 select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'channel',r.channel,'version',r.version,'unitPriceOre',r.unit_price_ore::text,'effectiveAt',r.effective_at) order by r.channel),'[]') into rates from (select distinct on(channel) * from private.advertising_channel_rates where company_id=p_company order by channel,version desc) r;
 snapshot:=jsonb_build_object('companyId',p_company,'month',p_month,'periodStart',ps,'periodEnd',pe,'trackingStartedAt',tracking,'coverage',case when tracking<=ps then 'full' else 'partial' end,'items',items,'count',n,'unpricedCount',unpriced,'totalOre',case when unpriced=0 then total::text else null end,'legacyPublishedJobs',(select coalesce(sum(initial_job_count),0) from private.advertising_legacy_publications where company_id=p_company));
 token:=encode(sha256(convert_to(snapshot::text,'UTF8')),'hex');
 select * into closed from private.advertising_billing_periods where company_id=p_company and month=p_month;
 return snapshot||jsonb_build_object('actorUserId',auth.uid(),'actorRole',mr,'ended',clock_timestamp()>=pe,'rates',rates,'reviewToken',token,'hasChangesSinceLock',closed.id is not null and closed.review_token<>token,
 'locked',case when closed.id is null then null else jsonb_build_object('id',closed.id,'lockedAt',closed.locked_at,'totalOre',closed.snapshot->'totalOre','count',closed.snapshot->'count','items',closed.snapshot->'items','reviewToken',closed.review_token,'partialCoverageAcknowledged',closed.partial_coverage_acknowledged,'companyId',closed.snapshot->'companyId','month',closed.snapshot->'month','periodStart',closed.snapshot->'periodStart','periodEnd',closed.snapshot->'periodEnd','trackingStartedAt',closed.snapshot->'trackingStartedAt','coverage',closed.snapshot->'coverage','legacyPublishedJobs',closed.snapshot->'legacyPublishedJobs','canonicalSnapshot',closed.canonical_snapshot) end);
end $$;
revoke all on function private.advertising_billing_context(uuid,boolean),private.advertising_billing_read(uuid,text,boolean) from public,anon,service_role;
grant execute on function private.advertising_billing_read(uuid,text,boolean) to authenticated;
-- Context is reachable only through the guarded domain functions.
revoke all on function private.advertising_billing_context(uuid,boolean) from authenticated;
commit;
