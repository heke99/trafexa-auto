create function private.web_application_json(p_row private.demo_requests) returns jsonb
 language sql immutable security invoker set search_path='' as $$
 select jsonb_build_object('id',p_row.id,'name',p_row.name,'email',p_row.email,'company',p_row.company,'phone',p_row.phone,
 'organisation_number',p_row.organisation_number,'seeking',coalesce(p_row.seeking,'{}'::text[]),'message',p_row.message,'privacy_version',p_row.privacy_version,
 'privacy_acknowledged_at',p_row.privacy_acknowledged_at,'legacy',p_row.legacy,'status',p_row.status,'version',p_row.version,'created_at',p_row.created_at);$$;
revoke all on function private.web_application_json(private.demo_requests) from public,anon,authenticated,service_role;
create or replace function private.list_platform_contact_requests(p_page_key uuid,p_limit integer) returns jsonb
 language plpgsql security definer set search_path='' as $$
declare cursor_time timestamptz;item private.demo_requests;items jsonb:='[]';last_id uuid;more boolean:=false;
begin
 if not private.has_platform_admin() then raise exception 'Platform administrator required' using errcode='42501';end if;
 if p_limit is null or p_limit not between 1 and 100 then raise exception 'Invalid page limit' using errcode='22023';end if;
 if p_page_key is not null then select created_at into cursor_time from private.demo_requests where id=p_page_key;
 if not found then raise exception 'Invalid page key' using errcode='22023';end if;end if;
 for item in select d.* from private.demo_requests d where p_page_key is null or (d.created_at,d.id)<(cursor_time,p_page_key)
 order by d.created_at desc,d.id desc limit p_limit+1 loop
 if jsonb_array_length(items)=p_limit then more:=true;exit;end if;
 items:=items||jsonb_build_array(private.web_application_json(item));last_id:=item.id;end loop;
 return jsonb_build_object('requests',items,'next_page_key',case when more then last_id else null end);
end $$;
create function private.get_platform_web_application(p_application_id uuid) returns jsonb
 language plpgsql security definer set search_path='' as $$
declare item private.demo_requests;audit jsonb;
begin
 if not private.has_platform_admin() then raise exception 'Platform administrator required' using errcode='42501';end if;
 select * into item from private.demo_requests where id=p_application_id;
 if not found then raise exception 'Application unavailable' using errcode='P0002';end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'actor_user_id',a.actor_user_id,'previous_status',a.previous_status,'status',a.status,
 'version',a.version,'reason',a.reason,'changed',a.changed,'created_at',a.created_at) order by a.created_at,a.id),'[]'::jsonb)
 into audit from (select * from private.web_application_status_audit where application_id=item.id order by created_at desc,id desc limit 1000) a;
 return jsonb_build_object('application',private.web_application_json(item),'audit',audit);
end $$;
revoke all on function private.get_platform_web_application(uuid) from public,anon,service_role;
grant execute on function private.get_platform_web_application(uuid) to authenticated;
create function public.get_platform_web_application(p_application_id uuid) returns jsonb
 language sql security invoker set search_path='' as $$select private.get_platform_web_application(p_application_id);$$;
revoke all on function public.get_platform_web_application(uuid) from public,anon,service_role;
grant execute on function public.get_platform_web_application(uuid) to authenticated;

create function private.set_platform_web_application_status(p_application_id uuid,p_expected_version integer,p_status text,p_reason text,p_request_id uuid) returns jsonb
 language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid();item private.demo_requests;receipt private.web_application_status_audit;payload jsonb;reason text:=btrim(p_reason);changed boolean; previous text;
begin
 -- Lock Auth before registry, then the case row, matching revocation-safe order.
 perform 1 from auth.users u where u.id=actor and u.email_confirmed_at is not null and not coalesce(u.is_anonymous,false)
 and not coalesce(u.is_sso_user,false) and (u.banned_until is null or u.banned_until<=now()) for share;
 if not found or current_setting('role',true)<>'authenticated' then raise exception 'Platform administrator required' using errcode='42501';end if;
 perform 1 from private.platform_admins a where a.user_id=actor and a.status='active' for share;
 if not found then raise exception 'Platform administrator required' using errcode='42501';end if;
 if p_application_id is null or p_request_id is null or p_expected_version is null or p_expected_version<1
 or p_status is null or p_status not in ('new','in_review','contacted','closed') or reason is null or length(reason) not between 2 and 500
 or reason ~ '[[:cntrl:]]' then raise exception 'Invalid status request' using errcode='22023';end if;
 payload:=jsonb_build_object('application_id',p_application_id,'expected_version',p_expected_version,'status',p_status,'reason',reason);
 perform pg_advisory_xact_lock(hashtextextended('trafexa-web-application:'||actor::text||':'||p_request_id::text,0));
 select * into receipt from private.web_application_status_audit where actor_user_id=actor and request_id=p_request_id;
 if found then
 if receipt.request_payload is distinct from payload then raise exception 'Application status conflict' using errcode='40001';end if;
 else
 select * into item from private.demo_requests where id=p_application_id for update;
 if not found then raise exception 'Application unavailable' using errcode='P0002';end if;
 if item.version<>p_expected_version then raise exception 'Application status conflict' using errcode='40001';end if;
 previous:=item.status;changed:=item.status<>p_status;
 if changed then update private.demo_requests set status=p_status,version=version+1 where id=item.id returning * into item;end if;
 insert into private.web_application_status_audit(application_id,actor_user_id,request_id,request_payload,previous_status,status,version,reason,changed)
 values(item.id,actor,p_request_id,payload,previous,item.status,item.version,reason,changed) returning * into receipt;
 end if;
 return jsonb_build_object('application_id',receipt.application_id,'actor_user_id',receipt.actor_user_id,'request_id',receipt.request_id,
 'previous_status',receipt.previous_status,'status',receipt.status,'version',receipt.version,'changed',receipt.changed,'reason',receipt.reason,'created_at',receipt.created_at);
end $$;
revoke all on function private.set_platform_web_application_status(uuid,integer,text,text,uuid) from public,anon,service_role;
grant execute on function private.set_platform_web_application_status(uuid,integer,text,text,uuid) to authenticated;
create function public.set_platform_web_application_status(p_application_id uuid,p_expected_version integer,p_status text,p_reason text,p_request_id uuid) returns jsonb
 language sql security invoker set search_path='' as $$ select private.set_platform_web_application_status(p_application_id,p_expected_version,p_status,p_reason,p_request_id);$$;
revoke all on function public.set_platform_web_application_status(uuid,integer,text,text,uuid) from public,anon,service_role;
grant execute on function public.set_platform_web_application_status(uuid,integer,text,text,uuid) to authenticated;
