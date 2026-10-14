begin;
create function private.list_deal_contract_signings(p_company_id uuid,p_deal_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$declare a uuid;r text;rows jsonb;begin
 select actor,actor_role into a,r from private.sale_contract_access(p_company_id,false);
 perform 1 from public.deals where company_id=p_company_id and id=p_deal_id for share;if not found then raise exception 'Deal denied' using errcode='42501';end if;
 select coalesce(jsonb_agg(private.contract_signing_json(x,a,r) order by x.id desc),'[]') into rows from(select * from private.contract_signings where company_id=p_company_id and deal_id=p_deal_id order by id desc limit 50)x;
 return jsonb_build_object('companyId',p_company_id,'dealId',p_deal_id,'actorUserId',a,'actorRole',r,'signings',rows,'nextBeforeId',null);end$$;
create function private.list_my_contract_signings(p_before_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$declare a uuid;e text;rows jsonb;n uuid;begin
 select user_id,email into a,e from private.company_team_identity(true);
 if p_before_id is not null and not exists(select 1 from private.contract_signings s join public.companies c on c.id=s.company_id and c.status='active' where s.id=p_before_id and s.customer_email=e) then raise exception 'Cursor denied' using errcode='40001';end if;
 select coalesce(jsonb_agg(private.contract_signing_json(x,a,'customer') order by x.id desc),'[]') into rows from(select s.* from private.contract_signings s join public.companies c on c.id=s.company_id and c.status='active' where s.customer_email=e and(p_before_id is null or s.id<p_before_id) order by s.id desc limit 50)x;
 if jsonb_array_length(rows)=50 and exists(select 1 from private.contract_signings s join public.companies c on c.id=s.company_id and c.status='active' where s.customer_email=e and s.id<(rows->49->>'id')::uuid) then n:=(rows->49->>'id')::uuid;end if;
 return jsonb_build_object('actorUserId',a,'recipientEmail',e,'signings',rows,'nextBeforeId',n);end$$;
create function private.get_contract_signing(p_signing_id uuid,p_company_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$declare a uuid;r text;e text;s private.contract_signings;begin
 if p_company_id is null then select user_id,email into a,e from private.company_team_identity(true);r:='customer';select * into s from private.contract_signings where id=p_signing_id and customer_email=e;
 else select actor,actor_role into a,r from private.sale_contract_access(p_company_id,false);select * into s from private.contract_signings where id=p_signing_id and company_id=p_company_id;end if;
 if s.id is null then raise exception 'Signing denied' using errcode='42501';end if;
 perform 1 from public.companies where id=s.company_id and status='active' for share;if not found then raise exception 'Company denied' using errcode='42501';end if;
 return jsonb_build_object('companyId',s.company_id,'actorUserId',a,'actorRole',r,'recipientEmail',e,'signing',private.contract_signing_json(s,a,r));end$$;
revoke all on function private.list_deal_contract_signings(uuid,uuid),private.list_my_contract_signings(uuid),private.get_contract_signing(uuid,uuid) from public,anon,authenticated,service_role;
commit;
