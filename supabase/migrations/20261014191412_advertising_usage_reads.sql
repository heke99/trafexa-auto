begin;
create function private.advertising_usage_read(p_company uuid,p_month text,p_platform boolean default false) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); mr text; month_date date; period_start timestamptz; period_end timestamptz; channels jsonb; totals jsonb; new_count bigint; legacy_count bigint;
begin
 if actor is null then raise exception 'Authentication required' using errcode='42501';end if;
 -- Fresh account approval, actual Auth and membership; lock them throughout the read.
 perform private.company_team_account(actor,true);
 if p_platform then
  if not private.has_platform_admin() then raise exception 'Platform admin required' using errcode='42501';end if;
  perform 1 from private.platform_admins where user_id=actor and status='active' for share;
  if not found then raise exception 'Platform admin required' using errcode='42501';end if;
  perform 1 from public.companies where id=p_company for share;
  if not found then raise exception 'Company missing' using errcode='42501';end if;
  mr:='platform_admin';
 else
  perform private.advertising_context(p_company,null,actor,array['owner','admin','finance'],true);
  select role into mr from public.memberships where company_id=p_company and user_id=actor and status='active';
 end if;
 if p_month is null or p_month !~ '^(20[0-9]{2}|2100)-(0[1-9]|1[0-2])$' then raise exception 'Invalid advertising month' using errcode='22023';end if;
 month_date:=(p_month||'-01')::date;
 period_start:=month_date::timestamp at time zone 'Europe/Stockholm';
 period_end:=(month_date+interval '1 month')::timestamp at time zone 'Europe/Stockholm';
 select jsonb_agg(jsonb_build_object('channel',c.channel,
 'queued',(select count(*) from private.advertising_jobs j where j.company_id=p_company and j.channel=c.channel and j.status='queued'),
 'dispatching',(select count(*) from private.advertising_jobs j where j.company_id=p_company and j.channel=c.channel and j.status='dispatching'),
 'outcomeUnknown',(select count(*) from private.advertising_jobs j where j.company_id=p_company and j.channel=c.channel and j.status='outcome_unknown'),
 'submitted',(select count(*) from private.advertising_jobs j where j.company_id=p_company and j.channel=c.channel and j.status='submitted'),
 'published',(select count(*) from private.advertising_jobs j where j.company_id=p_company and j.channel=c.channel and j.status='published'),
 'rejected',(select count(*) from private.advertising_jobs j where j.company_id=p_company and j.channel=c.channel and j.status='rejected'),
 'retryable',(select count(*) from private.advertising_jobs j where j.company_id=p_company and j.channel=c.channel and j.status='retryable'),
 'newPublications',(select count(*) from private.advertising_publications p where p.company_id=p_company and p.channel=c.channel and p.first_published_at>=period_start and p.first_published_at<period_end)) order by c.channel) into channels from (values('blocket'),('wayke')) c(channel);
 select count(*) into new_count from private.advertising_publications p where p.company_id=p_company and p.first_published_at>=period_start and p.first_published_at<period_end;
 -- Pre-tracking published jobs are excluded, rather than assigned a fictitious month.
 select coalesce(sum(initial_job_count),0) into legacy_count from private.advertising_legacy_publications where company_id=p_company;
 select jsonb_build_object('drafts',(select count(*) from private.advertising_listings where company_id=p_company and status='draft'),
 'ready',(select count(*) from private.advertising_listings where company_id=p_company and status='ready'),
 'newPublications',new_count) || (select jsonb_object_agg(k, (select sum((x->>k)::bigint) from jsonb_array_elements(channels) x)) from unnest(array['queued','dispatching','outcomeUnknown','submitted','published','rejected','retryable']) k) into totals;
 return jsonb_build_object('companyId',p_company,'actorUserId',actor,'actorRole',mr,'month',p_month,'timeZone','Europe/Stockholm','periodStart',period_start,'periodEnd',period_end,
 'totals',totals,'channels',channels,'billing',jsonb_build_object('status','unconfigured','unitPriceOre',null,'totalOre',null,'unpricedPublications',new_count),
 'trackingStartedAt',(select started_at from private.advertising_usage_tracking),'legacyPublishedJobs',legacy_count);
end $$;
create function public.list_advertising_usage(p_company_id uuid,p_month text) returns jsonb language sql security invoker set search_path='' as $$select private.advertising_usage_read(p_company_id,p_month);$$;
create function public.get_platform_advertising_usage(p_company_id uuid,p_month text) returns jsonb language sql security invoker set search_path='' as $$select private.advertising_usage_read(p_company_id,p_month,true);$$;
revoke all on function public.get_platform_advertising_usage(uuid,text) from public,anon,service_role;
grant execute on function public.get_platform_advertising_usage(uuid,text) to authenticated;
revoke all on function private.advertising_usage_read(uuid,text,boolean),public.list_advertising_usage(uuid,text) from public,anon,service_role;
grant execute on function private.advertising_usage_read(uuid,text,boolean),public.list_advertising_usage(uuid,text) to authenticated;
commit;
