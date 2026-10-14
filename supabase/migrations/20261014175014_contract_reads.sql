begin;
create function private.list_contract_templates(p_company_id uuid,p_before_template_id uuid,p_template_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$declare a uuid;r text;rows jsonb;tids uuid[];n uuid;begin
 select actor,actor_role into a,r from private.sale_contract_access(p_company_id,false);
 if p_template_id is not null and p_before_template_id is not null then raise exception 'Invalid targeted page' using errcode='22023';end if;
 if p_template_id is not null and not exists(select 1 from private.sale_contract_template_versions where company_id=p_company_id and template_id=p_template_id and(r<>'finance' or status='approved')) then raise exception 'Template access denied' using errcode='42501';end if;
 if p_before_template_id is not null and not exists(select 1 from private.sale_contract_template_versions where company_id=p_company_id and template_id=p_before_template_id and(r<>'finance' or status='approved')) then raise exception 'Cursor conflict' using errcode='40001';end if;
 select array_agg(template_id order by template_id desc) into tids from(select distinct template_id from private.sale_contract_template_versions where company_id=p_company_id and(r<>'finance' or status='approved') and(p_before_template_id is null or template_id<p_before_template_id) and(p_template_id is null or template_id=p_template_id) order by template_id desc limit 51)x;
 if array_length(tids,1)>50 then n:=tids[50];end if;
 select coalesce(jsonb_agg(private.sale_contract_template_json(t) order by t.template_id desc,t.version desc),'[]') into rows from private.sale_contract_template_versions t where company_id=p_company_id and(r<>'finance' or t.status='approved') and template_id=any(tids[1:50]) and(t.version=(select max(version) from private.sale_contract_template_versions x where x.company_id=t.company_id and x.template_id=t.template_id) or t.status='approved');
 return jsonb_build_object('companyId',p_company_id,'actorUserId',a,'actorRole',r,'businessDate',(clock_timestamp() at time zone 'Europe/Stockholm')::date,'templates',rows,'nextBeforeTemplateId',n);end$$;
create function private.list_deal_contracts(p_company_id uuid,p_deal_id uuid,p_before_draft_version integer) returns jsonb language plpgsql security definer set search_path='' as $$declare a uuid;r text;templates jsonb;drafts jsonb;accepted jsonb;latest integer;n integer;template_cursor uuid;deal_status text;begin
 select actor,actor_role into a,r from private.sale_contract_access(p_company_id,false);
 select status into deal_status from public.deals where company_id=p_company_id and id=p_deal_id for share;
 if not found then raise exception 'Deal access denied' using errcode='42501';end if;
 if p_before_draft_version is not null and not exists(select 1 from private.sale_contract_drafts where company_id=p_company_id and deal_id=p_deal_id and version=p_before_draft_version) then raise exception 'Cursor conflict' using errcode='40001';end if;
 select coalesce(max(version),0) into latest from private.sale_contract_drafts where company_id=p_company_id and deal_id=p_deal_id;
 select coalesce(jsonb_agg(private.sale_contract_template_json(t) order by t.template_id desc),'[]') into templates from(select * from private.sale_contract_template_versions where company_id=p_company_id and status='approved' order by template_id desc limit 50)t;
 if jsonb_array_length(templates)=50 and exists(select 1 from private.sale_contract_template_versions where company_id=p_company_id and status='approved' and template_id<(templates->49->>'templateId')::uuid) then template_cursor:=(templates->49->>'templateId')::uuid;end if;
 select coalesce(jsonb_agg(private.sale_contract_draft_json(d) order by d.version desc),'[]') into drafts from(select * from private.sale_contract_drafts where company_id=p_company_id and deal_id=p_deal_id and(p_before_draft_version is null or version<p_before_draft_version) order by version desc limit 50)d;
 if jsonb_array_length(drafts)=50 and exists(select 1 from private.sale_contract_drafts where company_id=p_company_id and deal_id=p_deal_id and version<(drafts->49->>'version')::integer) then n:=(drafts->49->>'version')::integer;end if;
 select jsonb_build_object('id',o.id,'version',o.version,'snapshot',private.offer_review_snapshot(o.snapshot)) into accepted from public.offers o join private.offer_reviews v on v.company_id=o.company_id and v.deal_id=o.deal_id and v.offer_id=o.id and v.offer_version=o.version and v.status='accepted' where o.company_id=p_company_id and o.deal_id=p_deal_id order by o.version desc limit 1;
 return jsonb_build_object('companyId',p_company_id,'actorUserId',a,'actorRole',r,'dealId',p_deal_id,'templates',templates,'drafts',drafts,'acceptedOffer',accepted,'canCreate',deal_status in ('draft','reserved'),'latestVersion',latest,'nextBeforeDraftVersion',n,'nextBeforeTemplateId',template_cursor);end$$;
create function private.get_sale_contract_draft(p_company_id uuid,p_draft_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$declare a uuid;r text;d private.sale_contract_drafts;begin
 select actor,actor_role into a,r from private.sale_contract_access(p_company_id,false);
 select * into d from private.sale_contract_drafts where company_id=p_company_id and id=p_draft_id;
 if not found then raise exception 'Draft access denied' using errcode='42501';end if;
 return jsonb_build_object('companyId',p_company_id,'actorUserId',a,'actorRole',r,'draft',private.sale_contract_draft_json(d));end$$;
revoke all on function private.list_contract_templates(uuid,uuid,uuid),private.list_deal_contracts(uuid,uuid,integer),private.get_sale_contract_draft(uuid,uuid) from public,anon,authenticated,service_role;
commit;
