begin;
create function private.advertising_receivables_context() returns uuid language plpgsql set search_path='' as $$
declare actor uuid:=auth.uid();begin
 perform private.company_team_account(actor,true);
 if not private.has_platform_admin() then raise exception 'Platform administrator required' using errcode='42501';end if;
 perform 1 from private.platform_admins where user_id=actor and status='active' for share;
 if not found then raise exception 'Platform administrator required' using errcode='42501';end if;return actor;
end $$;
create function private.advertising_receivables_item(p_source jsonb,p_paid numeric,p_day date) returns jsonb language plpgsql immutable set search_path='' as $$
declare gross numeric:=(p_source->>'grossTotalOre')::numeric;due numeric;outstanding numeric;surplus numeric;credited boolean:=p_source->'credit'<>'null'::jsonb;begin
 due:=case when credited then 0 else gross end;outstanding:=greatest(due-p_paid,0);surplus:=greatest(p_paid-due,0);
 return p_source||jsonb_build_object('receivableOre',due::text,'receivedOre',p_paid::text,'outstandingOre',outstanding::text,'surplusOre',surplus::text,'status',case when credited then 'credited' when surplus>0 then 'overpaid' when outstanding=0 then 'settled' when p_paid>0 then 'partial' else 'unpaid' end,'isOverdue',outstanding>0 and (p_source->>'dueDate')::date<p_day);
end $$;
revoke all on function private.advertising_receivables_item(jsonb,numeric,date) from public,anon,authenticated,service_role;
revoke all on function private.advertising_receivables_context() from public,anon,authenticated,service_role;
commit;
