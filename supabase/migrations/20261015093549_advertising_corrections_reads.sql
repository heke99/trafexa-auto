begin;
create function private.advertising_corrections_read(p_company uuid,p_month text,p_platform boolean default false) returns jsonb language plpgsql security definer set search_path='' as $$
declare mr text;closed private.advertising_billing_periods;original jsonb:=null;adjustments jsonb:='[]';snapshot jsonb;total numeric:=0;n bigint;
begin
 mr:=private.advertising_billing_context(p_company,p_platform);
 if p_month is null or p_month !~ '^(20[0-9]{2}|2100)-(0[1-9]|1[0-2])$' then raise exception 'Invalid month' using errcode='22023';end if;
 select * into closed from private.advertising_billing_periods where company_id=p_company and month=p_month;
 if found then
  original:=jsonb_build_object('id',closed.id,'lockedAt',closed.locked_at,'totalOre',closed.snapshot->'totalOre','count',closed.snapshot->'count','items',closed.snapshot->'items','reviewToken',closed.review_token,'partialCoverageAcknowledged',closed.partial_coverage_acknowledged,'companyId',closed.snapshot->'companyId','month',closed.snapshot->'month','periodStart',closed.snapshot->'periodStart','periodEnd',closed.snapshot->'periodEnd','trackingStartedAt',closed.snapshot->'trackingStartedAt','coverage',closed.snapshot->'coverage','legacyPublishedJobs',closed.snapshot->'legacyPublishedJobs','canonicalSnapshot',closed.canonical_snapshot);
  select count(*),coalesce(sum(amount_ore::numeric),0) into n,total from private.advertising_billing_reductions where period_id=closed.id and company_id=p_company;
  if n>2000 or total>(closed.snapshot->>'totalOre')::numeric then raise exception 'Invalid reduction total' using errcode='22023';end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'publicationId',publication_id,'amountOre',amount_ore::text,'reason',reason,'createdAt',created_at,'createdBy','Superadmin') order by created_at,id),'[]') into adjustments from private.advertising_billing_reductions where period_id=closed.id and company_id=p_company;
 end if;
 snapshot:=jsonb_build_object('companyId',p_company,'month',p_month,'originalId',closed.id,'originalReviewToken',closed.review_token,'adjustments',adjustments,'reductionTotalOre',total::text,'netTotalOre',case when closed.id is null then null else ((closed.snapshot->>'totalOre')::numeric-total)::text end);
 return snapshot||jsonb_build_object('original',original,'actorUserId',auth.uid(),'actorRole',mr,'reviewToken',encode(sha256(convert_to(snapshot::text,'UTF8')),'hex'),'canonicalSnapshot',snapshot::text);
end $$;
revoke all on function private.advertising_corrections_read(uuid,text,boolean) from public,anon,service_role;
grant execute on function private.advertising_corrections_read(uuid,text,boolean) to authenticated;
commit;
