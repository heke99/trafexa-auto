-- Internal sales locations under one legal company. No inventory or partner mapping.
begin;
create function private.company_branch_fields(p_fields jsonb)returns jsonb language plpgsql immutable security invoker set search_path='' as $$
declare k text;v text;minimum integer;maximum integer;
begin
 if p_fields is null or jsonb_typeof(p_fields)<>'object' or not(p_fields?&array['code','name','addressLine1','postalCode','city','publicEmail','publicPhone'])or p_fields-array['code','name','addressLine1','postalCode','city','publicEmail','publicPhone']<>'{}'::jsonb then raise exception 'Invalid branch fields' using errcode='22023';end if;
 foreach k in array array['code','name','addressLine1','postalCode','city','publicEmail','publicPhone']loop
 if k in('publicEmail','publicPhone')and p_fields->k='null'::jsonb then continue;end if;
 if jsonb_typeof(p_fields->k)<>'string'then raise exception 'Invalid branch fields' using errcode='22023';end if;
 v:=p_fields->>k;minimum:=case k when 'code'then 1 when 'postalCode'then 5 when 'publicEmail'then 3 when 'publicPhone'then 7 else 2 end;
 maximum:=case k when 'code'then 24 when 'name'then 120 when 'addressLine1'then 160 when 'postalCode'then 5 when 'city'then 100 when 'publicEmail'then 254 else 40 end;
 if not private.company_store_text_valid(v,minimum,maximum,false)
 or(k='code'and v!~'^[a-z0-9][a-z0-9-]{0,23}$')or(k='postalCode'and v!~'^[0-9]{5}$')
 or(k='publicEmail'and(v<>lower(v)or v!~'^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'or v~('['||chr(160)||chr(8239)||chr(65279)||']')))
 or(k='publicPhone'and(v!~'^\+?[0-9 ()-]+$'or length(regexp_replace(v,'[^0-9]','','g'))not between 7 and 15))then raise exception 'Invalid branch fields' using errcode='22023';end if;
 end loop;return p_fields;
end$$;
revoke all on function private.company_branch_fields(jsonb)from public,anon,authenticated,service_role;
create table private.company_branches(
 id uuid primary key,company_id uuid not null references public.companies(id),
 version bigint not null check(version between 1 and 9007199254740991),status text not null check(status in('active','archived')),
 fields jsonb not null check(fields=private.company_branch_fields(fields)),
 created_at timestamptz not null,updated_at timestamptz not null check(updated_at>=created_at),unique(company_id,id)
);
-- Archived location codes remain reserved. Renaming an active location releases its old code.
create unique index company_branch_code on private.company_branches(company_id,(fields->>'code'));
create index company_branch_page on private.company_branches(company_id,status,id);
create table private.company_branch_audit(
 id uuid primary key default gen_random_uuid(),company_id uuid not null references public.companies(id),
 actor_user_id uuid not null references auth.users(id),request_id uuid not null,action text not null check(action in('save','status')),
 payload jsonb not null,receipt jsonb not null,previous_value jsonb,current_value jsonb not null,
 created_at timestamptz not null default clock_timestamp(),unique(actor_user_id,request_id)
);
create index company_branch_audit_company on private.company_branch_audit(company_id,created_at desc);
alter table private.company_branches enable row level security;alter table private.company_branch_audit enable row level security;
revoke all on private.company_branches,private.company_branch_audit from public,anon,authenticated,service_role;
create function private.guard_company_branch()returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if tg_op='DELETE'then raise exception 'Branch deletion is forbidden'using errcode='55000';end if;
 if new.id<>old.id or new.company_id<>old.company_id or new.created_at<>old.created_at or new.version<>old.version+1 or new.updated_at<old.updated_at
 or(old.status='archived'and(new.status<>'active'or new.fields is distinct from old.fields))or(new.status<>old.status and new.fields is distinct from old.fields)then raise exception 'Invalid branch transition'using errcode='55000';end if;return new;
end$$;
revoke all on function private.guard_company_branch()from public,anon,authenticated,service_role;
create trigger guard_company_branch before update or delete on private.company_branches for each row execute function private.guard_company_branch();
create trigger immutable_company_branch_audit before update or delete on private.company_branch_audit for each row execute function private.reject_company_team_audit_mutation();
create function private.company_branch_json(b private.company_branches)returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('id',b.id,'companyId',b.company_id,'version',b.version,'status',b.status,'fields',b.fields,'createdAt',b.created_at,'updatedAt',b.updated_at);
$$;
create function private.list_company_branches(p_company_id uuid,p_status text,p_page_key uuid,p_limit integer)returns jsonb language plpgsql security definer set search_path='' as $$
declare a uuid;r text;c public.companies%rowtype;items jsonb;next_key uuid;
begin
 select user_id into a from private.company_team_identity(true);
 select * into c from public.companies where id=p_company_id for share;
 r:=private.company_team_manager(p_company_id,a,false);
 if p_status is null or p_status not in('active','archived')or p_limit is null or p_limit not between 1 and 50 then raise exception 'Invalid branch page'using errcode='22023';end if;
 if p_page_key is not null and not exists(select 1 from private.company_branches where company_id=p_company_id and status=p_status and id=p_page_key)then raise exception 'Branch page conflict'using errcode='40001';end if;
 select coalesce(jsonb_agg(private.company_branch_json(b)order by b.id),'[]')into items from(select * from private.company_branches where company_id=p_company_id and status=p_status and(p_page_key is null or id>p_page_key)order by id limit p_limit)b;
 if jsonb_array_length(items)=p_limit and exists(select 1 from private.company_branches where company_id=p_company_id and status=p_status and id>(items->(p_limit-1)->>'id')::uuid)then next_key:=(items->(p_limit-1)->>'id')::uuid;end if;
 return jsonb_build_object('companyId',p_company_id,'actorUserId',a,'actorRole',r,'branches',items,'nextPageKey',next_key,'status',p_status,'legalName',c.name,'organisationNumber',c.organisation_number);
end$$;
create function private.mutate_company_branch(p_action text,p_company_id uuid,p_branch_id uuid,p_expected_version bigint,p_fields jsonb,p_status text,p_reason text,p_acknowledged boolean,p_request_id uuid)returns jsonb language plpgsql security invoker set search_path='' as $$
declare a uuid;r text;b private.company_branches%rowtype;old_b jsonb;payload jsonb;receipt jsonb;prior private.company_branch_audit%rowtype;stamp timestamptz;
begin
 select user_id into a from private.company_team_identity(true);
 if p_request_id is null then raise exception 'Request UUID required'using errcode='22023';end if;
 -- Serialize actor-bound nonce across companies before company locks; no credential or external job.
 perform pg_advisory_xact_lock(hashtextextended('company_branches:'||a::text||':'||p_request_id::text,0));
 r:=private.company_team_manager(p_company_id,a);
 if p_action is null or p_action not in('save','status')or p_branch_id is null or p_expected_version is null or p_expected_version not between 0 and 9007199254740991 or p_acknowledged is distinct from true then raise exception 'Invalid branch review'using errcode='22023';end if;
 if p_action='save'then perform private.company_branch_fields(p_fields);
 elsif p_expected_version<1 or p_status is null or p_status not in('active','archived')or not private.company_store_text_valid(p_reason,1,500,false)then raise exception 'Invalid branch status review'using errcode='22023';end if;
 payload:=jsonb_build_object('action',p_action,'companyId',p_company_id,'branchId',p_branch_id,'expectedVersion',p_expected_version,'fields',p_fields,'status',p_status,'reason',p_reason,'acknowledged',p_acknowledged);
 select * into prior from private.company_branch_audit where actor_user_id=a and request_id=p_request_id;
 if found then if prior.payload is distinct from payload then raise exception 'Branch request payload conflict'using errcode='40001';end if;return prior.receipt;end if;
 select * into b from private.company_branches where id=p_branch_id for update;
 if b.id is not null and b.company_id<>p_company_id then raise exception 'Branch version conflict'using errcode='40001';end if;
 if(p_action='save'and p_expected_version=0 and b.id is not null)or(p_expected_version>0 and(b.id is null or b.version<>p_expected_version))then raise exception 'Branch version conflict'using errcode='40001';end if;
 if b.id is not null and b.version=9007199254740991 then raise exception 'Branch version limit conflict'using errcode='40001';end if;
 if p_action='save'and p_expected_version>0 and b.status<>'active'then raise exception 'Archived branch conflict'using errcode='40001';end if;
 if p_action='status'and b.status=p_status then raise exception 'Branch status conflict'using errcode='40001';end if;
 stamp:=clock_timestamp();old_b:=case when b.id is null then null else to_jsonb(b)end;
 if p_action='save'and p_expected_version=0 then
 insert into private.company_branches(id,company_id,version,status,fields,created_at,updated_at)values(p_branch_id,p_company_id,1,'active',p_fields,stamp,stamp)returning * into b;
 elsif p_action='save'then update private.company_branches set fields=p_fields,version=version+1,updated_at=stamp where id=p_branch_id returning * into b;
 else update private.company_branches set status=p_status,version=version+1,updated_at=stamp where id=p_branch_id returning * into b;end if;
 receipt:=jsonb_build_object('companyId',p_company_id,'actorUserId',a,'requestId',p_request_id,'action',p_action,'branch',private.company_branch_json(b));
 insert into private.company_branch_audit(company_id,actor_user_id,request_id,action,payload,receipt,previous_value,current_value)values(p_company_id,a,p_request_id,p_action,payload,receipt,old_b,to_jsonb(b));return receipt;
 exception when unique_violation then raise exception 'Branch code or request conflict'using errcode='40001';
end$$;
create function private.save_company_branch(p_company_id uuid,p_branch_id uuid,p_expected_version bigint,p_fields jsonb,p_acknowledged boolean,p_request_id uuid)returns jsonb language sql security definer set search_path='' as $$select private.mutate_company_branch('save',p_company_id,p_branch_id,p_expected_version,p_fields,null,null,p_acknowledged,p_request_id)$$;
create function private.set_company_branch_status(p_company_id uuid,p_branch_id uuid,p_expected_version bigint,p_status text,p_reason text,p_acknowledged boolean,p_request_id uuid)returns jsonb language sql security definer set search_path='' as $$select private.mutate_company_branch('status',p_company_id,p_branch_id,p_expected_version,null,p_status,p_reason,p_acknowledged,p_request_id)$$;
revoke all on function private.company_branch_json(private.company_branches),private.mutate_company_branch(text,uuid,uuid,bigint,jsonb,text,text,boolean,uuid)from public,anon,authenticated,service_role;
revoke all on function private.list_company_branches(uuid,text,uuid,integer),private.save_company_branch(uuid,uuid,bigint,jsonb,boolean,uuid),private.set_company_branch_status(uuid,uuid,bigint,text,text,boolean,uuid)from public,anon,authenticated,service_role;
grant execute on function private.list_company_branches(uuid,text,uuid,integer),private.save_company_branch(uuid,uuid,bigint,jsonb,boolean,uuid),private.set_company_branch_status(uuid,uuid,bigint,text,text,boolean,uuid)to authenticated;
create function public.list_company_branches(p_company_id uuid,p_status text,p_page_key uuid default null,p_limit integer default 50)returns jsonb language sql security invoker set search_path='' as $$select private.list_company_branches(p_company_id,p_status,p_page_key,p_limit)$$;
create function public.save_company_branch(p_company_id uuid,p_branch_id uuid,p_expected_version bigint,p_fields jsonb,p_acknowledged boolean,p_request_id uuid)returns jsonb language sql security invoker set search_path='' as $$select private.save_company_branch(p_company_id,p_branch_id,p_expected_version,p_fields,p_acknowledged,p_request_id)$$;
create function public.set_company_branch_status(p_company_id uuid,p_branch_id uuid,p_expected_version bigint,p_status text,p_reason text,p_acknowledged boolean,p_request_id uuid)returns jsonb language sql security invoker set search_path='' as $$select private.set_company_branch_status(p_company_id,p_branch_id,p_expected_version,p_status,p_reason,p_acknowledged,p_request_id)$$;
revoke all on function public.list_company_branches(uuid,text,uuid,integer),public.save_company_branch(uuid,uuid,bigint,jsonb,boolean,uuid),public.set_company_branch_status(uuid,uuid,bigint,text,text,boolean,uuid)from public,anon,authenticated,service_role;
grant execute on function public.list_company_branches(uuid,text,uuid,integer),public.save_company_branch(uuid,uuid,bigint,jsonb,boolean,uuid),public.set_company_branch_status(uuid,uuid,bigint,text,text,boolean,uuid)to authenticated;
commit;
