begin;
create function private.create_customer_contact(p_company_id uuid,p_customer_id uuid,p_kind text,p_contact_on date,p_summary text,p_follow_up_on date,p_request_id uuid)
 returns jsonb language plpgsql security definer set search_path='' as $$
declare a uuid; r text; payload jsonb; receipt jsonb; c private.customer_contacts%rowtype;
begin
 select actor,actor_role into a,r from private.customer_contact_access(p_company_id,true);
 perform 1 from public.customers where company_id=p_company_id and id=p_customer_id for share;
 if not found then raise exception 'Customer access denied' using errcode='42501'; end if;
 if p_kind is null or p_kind not in ('call','email','meeting','note') or p_contact_on is null
 or p_contact_on not between date '1900-01-01' and (clock_timestamp() at time zone 'Europe/Stockholm')::date
 or p_summary is null or length(p_summary) not between 2 and 2000 or p_summary<>btrim(p_summary) or translate(p_summary,E'\n\r\t','') ~ '[[:cntrl:]]'
 or (p_follow_up_on is not null and (p_follow_up_on not between date '1900-01-01' and date '9999-12-31' or p_follow_up_on<p_contact_on)) then
 raise exception 'Invalid contact' using errcode='22023'; end if;
 payload:=jsonb_build_object('action','create','companyId',p_company_id,'customerId',p_customer_id,'kind',p_kind,'contactOn',p_contact_on,'summary',p_summary,'followUpOn',p_follow_up_on);
 receipt:=private.customer_contact_replay(a,p_request_id,payload); if receipt is not null then return receipt; end if;
 insert into private.customer_contacts(company_id,customer_id,kind,contact_on,summary,follow_up_on,follow_up_status,created_by)
 values(p_company_id,p_customer_id,p_kind,p_contact_on,p_summary,p_follow_up_on,case when p_follow_up_on is null then 'none' else 'pending' end,a) returning * into c;
 receipt:=jsonb_build_object('companyId',p_company_id,'actorUserId',a,'requestId',p_request_id,'contact',private.customer_contact_json(c));
 insert into private.customer_contact_audit(company_id,actor_user_id,request_id,payload,receipt,current_value) values(p_company_id,a,p_request_id,payload,receipt,private.customer_contact_json(c));
 return receipt;
end $$;
create function private.update_customer_follow_up(p_company_id uuid,p_customer_id uuid,p_contact_id uuid,p_expected_version integer,p_status text,p_reason text,p_request_id uuid)
 returns jsonb language plpgsql security definer set search_path='' as $$
declare a uuid; r text; payload jsonb; receipt jsonb; c private.customer_contacts%rowtype; previous jsonb;
begin
 select actor,actor_role into a,r from private.customer_contact_access(p_company_id,true);
 perform 1 from public.customers where company_id=p_company_id and id=p_customer_id for share;
 if not found then raise exception 'Customer access denied' using errcode='42501'; end if;
 if p_expected_version is null or p_expected_version<1 or p_status is null or p_status not in ('pending','done','cancelled')
 or p_reason is null or length(p_reason) not between 2 and 500 or p_reason<>btrim(p_reason) or p_reason ~ '[[:cntrl:]]' then raise exception 'Invalid follow-up change' using errcode='22023'; end if;
 payload:=jsonb_build_object('action','follow_up','companyId',p_company_id,'customerId',p_customer_id,'contactId',p_contact_id,'expectedVersion',p_expected_version,'status',p_status,'reason',p_reason);
 receipt:=private.customer_contact_replay(a,p_request_id,payload); if receipt is not null then return receipt; end if;
 select * into c from private.customer_contacts where company_id=p_company_id and customer_id=p_customer_id and id=p_contact_id for update;
 if not found then raise exception 'Contact access denied' using errcode='42501'; end if;
 if c.version<>p_expected_version or c.follow_up_on is null or c.follow_up_status=p_status or c.version=2147483647 then raise exception 'Follow-up conflict' using errcode='40001'; end if;
 previous:=private.customer_contact_json(c);
 update private.customer_contacts set follow_up_status=p_status,version=version+1 where id=c.id returning * into c;
 receipt:=jsonb_build_object('companyId',p_company_id,'actorUserId',a,'requestId',p_request_id,'contact',private.customer_contact_json(c));
 insert into private.customer_contact_audit(company_id,actor_user_id,request_id,payload,receipt,previous_value,current_value) values(p_company_id,a,p_request_id,payload,receipt,previous,private.customer_contact_json(c));
 return receipt;
end $$;
create function public.create_customer_contact(p_company_id uuid,p_customer_id uuid,p_kind text,p_contact_on date,p_summary text,p_follow_up_on date,p_request_id uuid) returns jsonb language sql security invoker set search_path='' as $$ select private.create_customer_contact(p_company_id,p_customer_id,p_kind,p_contact_on,p_summary,p_follow_up_on,p_request_id); $$;
create function public.update_customer_follow_up(p_company_id uuid,p_customer_id uuid,p_contact_id uuid,p_expected_version integer,p_status text,p_reason text,p_request_id uuid) returns jsonb language sql security invoker set search_path='' as $$ select private.update_customer_follow_up(p_company_id,p_customer_id,p_contact_id,p_expected_version,p_status,p_reason,p_request_id); $$;
revoke all on function private.create_customer_contact(uuid,uuid,text,date,text,date,uuid),private.update_customer_follow_up(uuid,uuid,uuid,integer,text,text,uuid),public.create_customer_contact(uuid,uuid,text,date,text,date,uuid),public.update_customer_follow_up(uuid,uuid,uuid,integer,text,text,uuid) from public,anon,authenticated,service_role;
grant execute on function private.create_customer_contact(uuid,uuid,text,date,text,date,uuid),private.update_customer_follow_up(uuid,uuid,uuid,integer,text,text,uuid),public.create_customer_contact(uuid,uuid,text,date,text,date,uuid),public.update_customer_follow_up(uuid,uuid,uuid,integer,text,text,uuid) to authenticated;
commit;
