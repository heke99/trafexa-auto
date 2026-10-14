begin;
create function private.get_platform_overview() returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid; generated timestamptz:=statement_timestamp(); today date:=(statement_timestamp() at time zone 'Europe/Stockholm')::date;
begin
 select i.user_id into actor from private.company_team_identity(true) i;
 perform 1 from private.platform_admins a where a.user_id=actor and a.status='active' for share;
 if not found then raise exception 'Platform access denied' using errcode='42501';end if;
 return jsonb_build_object('actorUserId',actor,'generatedAt',generated,
'companies',(select jsonb_build_object('total',(count(*) filter(where true))::text,'active',(count(*) filter(where status='active'))::text,'suspended',(count(*) filter(where status='suspended'))::text) from public.companies),
'users',(select jsonb_build_object('total',(count(*) filter(where true))::text,'verified',(count(*) filter(where email_confirmed_at is not null))::text,'activeMemberships',(select count(*)::text from public.memberships where status='active')) from auth.users),
'applications',(select jsonb_build_object('total',(count(*) filter(where true))::text,'new',(count(*) filter(where status='new'))::text,'inReview',(count(*) filter(where status='in_review'))::text,'contacted',(count(*) filter(where status='contacted'))::text,'closed',(count(*) filter(where status='closed'))::text,'legacyIncomplete',(count(*) filter(where legacy))::text) from private.demo_requests),
'inventory',(select jsonb_build_object('total',(count(*) filter(where true))::text,'available',(count(*) filter(where status='available'))::text,'reserved',(count(*) filter(where status='reserved'))::text,'sold',(count(*) filter(where status='sold'))::text,'archived',(count(*) filter(where status='archived'))::text) from public.stock_items),
'deals',(select jsonb_build_object('total',(count(*) filter(where true))::text,'draft',(count(*) filter(where status='draft'))::text,'reserved',(count(*) filter(where status='reserved'))::text,'cancelled',(count(*) filter(where status='cancelled'))::text) from public.deals),
'offers',(select jsonb_build_object('customerReviews',(count(*) filter(where true))::text,'accepted',(count(*) filter(where status='accepted'))::text,'declined',(count(*) filter(where status='declined'))::text,'versions',(select count(*)::text from public.offers)) from private.offer_reviews),
'advertising',(select jsonb_build_object('draft',(count(*) filter(where status='draft'))::text,'ready',(count(*) filter(where status='ready'))::text,'connectionsRequested',(select count(*)::text from private.advertising_connections where status='requested'),'connectionsVerified',(select count(*)::text from private.advertising_connections where status='verified')) from private.advertising_listings),
'financing',(select jsonb_build_object('intakeRequests',(count(*) filter(where status='intake'))::text) from public.finance_applications),
 'stockAskingPriceOre',(select coalesce(sum(asking_price_ore),0)::text from public.stock_items where status in ('available','reserved')),
 'daily',(select jsonb_agg(jsonb_build_object('date',d::text,
  'applications',(select count(*)::text from private.demo_requests where created_at>=d::timestamp at time zone 'Europe/Stockholm' and created_at<(d+1)::timestamp at time zone 'Europe/Stockholm'),
  'companies',(select count(*)::text from public.companies where created_at>=d::timestamp at time zone 'Europe/Stockholm' and created_at<(d+1)::timestamp at time zone 'Europe/Stockholm'),
  'deals',(select count(*)::text from public.deals where created_at>=d::timestamp at time zone 'Europe/Stockholm' and created_at<(d+1)::timestamp at time zone 'Europe/Stockholm')) order by d)
  from (select today-6+i as d from generate_series(0,6) i) days));
end $$;
revoke all on function private.get_platform_overview() from public,anon,authenticated,service_role;
grant execute on function private.get_platform_overview() to authenticated;
create function public.get_platform_overview() returns jsonb language sql security invoker set search_path='' as $$select private.get_platform_overview()$$;
revoke all on function public.get_platform_overview() from public,anon,authenticated,service_role;
grant execute on function public.get_platform_overview() to authenticated;
commit;
