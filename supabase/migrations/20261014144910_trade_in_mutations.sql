begin;
create function private.create_trade_in_version(p_company_id uuid,p_deal_id uuid,p_expected_version integer,p_expected_sale_price_ore bigint,p_registration text,p_make text,p_model text,p_model_year integer,p_mileage_km integer,p_condition_notes text,p_equipment_notes text,p_value_ore bigint,p_debt_known boolean,p_debt_ore bigint,p_lender_name text,p_request_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare a uuid;r text;d public.deals;t private.trade_in_versions;old private.trade_in_audit;p jsonb;v jsonb;latest integer;
begin
 select actor,actor_role into a,r from private.customer_contact_access(p_company_id,true);
 select * into d from public.deals where company_id=p_company_id and id=p_deal_id for update;
 if not found then raise exception 'Deal access denied' using errcode='42501';end if;
 if p_request_id is null or p_expected_version is null or p_expected_version not between 0 and 2147483646 or p_expected_sale_price_ore is null or p_expected_sale_price_ore not between 1 and 999999999999 then raise exception 'Invalid request' using errcode='22023';end if;
 p:=jsonb_build_object('company',p_company_id,'deal',p_deal_id,'version',p_expected_version,'salePrice',p_expected_sale_price_ore::text,'registration',p_registration,'make',p_make,'model',p_model,'year',p_model_year,'mileage',p_mileage_km,'condition',p_condition_notes,'equipment',p_equipment_notes,'value',p_value_ore::text,'debtKnown',p_debt_known,'debt',p_debt_ore::text,'lender',p_lender_name);
 perform pg_advisory_xact_lock(hashtextextended(a::text||p_request_id::text,0));
 select * into old from private.trade_in_audit where actor_user_id=a and request_id=p_request_id;
 if found then if old.payload is distinct from p then raise exception 'Request conflict' using errcode='40001';end if;return old.receipt;end if;
 select coalesce(max(version),0) into latest from private.trade_in_versions where company_id=p_company_id and deal_id=p_deal_id;
 if d.status not in ('draft','reserved') or d.sale_price_ore<>p_expected_sale_price_ore or latest<>p_expected_version or exists(select 1 from private.offer_reviews where company_id=p_company_id and deal_id=p_deal_id and status='accepted') then raise exception 'Trade-in agreement conflict' using errcode='40001';end if;
 if p_model_year is null or p_model_year not between 1900 and extract(year from clock_timestamp() at time zone 'Europe/Stockholm')::integer+1 then raise exception 'Invalid year' using errcode='22023';end if;
 insert into private.trade_in_versions(company_id,deal_id,customer_id,version,registration,make,model,model_year,mileage_km,condition_notes,equipment_notes,value_ore,debt_known,debt_ore,lender_name,sale_price_ore,net_trade_in_ore,amount_to_pay_ore,created_by)
 values(p_company_id,p_deal_id,d.customer_id,latest+1,p_registration,p_make,p_model,p_model_year,p_mileage_km,p_condition_notes,p_equipment_notes,p_value_ore,p_debt_known,p_debt_ore,p_lender_name,d.sale_price_ore,case when p_debt_known then p_value_ore-p_debt_ore end,case when p_debt_known then d.sale_price_ore-p_value_ore+p_debt_ore end,a) returning * into t;
 v:=jsonb_build_object('companyId',p_company_id,'actorUserId',a,'requestId',p_request_id,'tradeIn',private.trade_in_json(t));
 insert into private.trade_in_audit(company_id,actor_user_id,request_id,payload,receipt)values(p_company_id,a,p_request_id,p,v);return v;
end$$;
create function public.create_trade_in_version(p_company_id uuid,p_deal_id uuid,p_expected_version integer,p_expected_sale_price_ore bigint,p_registration text,p_make text,p_model text,p_model_year integer,p_mileage_km integer,p_condition_notes text,p_equipment_notes text,p_value_ore bigint,p_debt_known boolean,p_debt_ore bigint,p_lender_name text,p_request_id uuid) returns jsonb language sql security invoker set search_path='' as $$select private.create_trade_in_version(p_company_id,p_deal_id,p_expected_version,p_expected_sale_price_ore,p_registration,p_make,p_model,p_model_year,p_mileage_km,p_condition_notes,p_equipment_notes,p_value_ore,p_debt_known,p_debt_ore,p_lender_name,p_request_id);$$;
revoke all on function private.create_trade_in_version(uuid,uuid,integer,bigint,text,text,text,integer,integer,text,text,bigint,boolean,bigint,text,uuid),public.create_trade_in_version(uuid,uuid,integer,bigint,text,text,text,integer,integer,text,text,bigint,boolean,bigint,text,uuid) from public,anon,authenticated,service_role;
grant execute on function private.create_trade_in_version(uuid,uuid,integer,bigint,text,text,text,integer,integer,text,text,bigint,boolean,bigint,text,uuid),public.create_trade_in_version(uuid,uuid,integer,bigint,text,text,text,integer,integer,text,text,bigint,boolean,bigint,text,uuid) to authenticated;
commit;
