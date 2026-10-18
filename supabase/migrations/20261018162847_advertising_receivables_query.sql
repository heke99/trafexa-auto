begin;
create function private.get_advertising_receivables(p_filter text,p_cursor jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid;at_time timestamptz;day date;before_at timestamptz;before_id uuid;result jsonb;begin
 actor:=private.advertising_receivables_context();at_time:=clock_timestamp();day:=(at_time at time zone 'Europe/Stockholm')::date;
 if p_filter is null or p_filter not in ('all','unpaid','partial','settled','overpaid','credited','overdue') then raise exception 'Invalid receivables filter' using errcode='22023';end if;
 if p_cursor is not null then
  if jsonb_typeof(p_cursor)<>'object' or (select count(*) from jsonb_object_keys(p_cursor))<>4 or not(p_cursor?&array['filter','createdAt','id','actorUserId']) or p_cursor->>'filter' is distinct from p_filter or p_cursor->>'actorUserId' is distinct from actor::text or jsonb_typeof(p_cursor->'createdAt')<>'string' or jsonb_typeof(p_cursor->'id')<>'string' or p_cursor->>'createdAt' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?(Z|[+-][0-9]{2}:[0-9]{2})$' or p_cursor->>'id' !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then raise exception 'Invalid receivables cursor' using errcode='22023';end if;
  begin before_at:=(p_cursor->>'createdAt')::timestamptz;before_id:=(p_cursor->>'id')::uuid;exception when others then raise exception 'Invalid receivables cursor' using errcode='22023';end;
  if before_at is null or not isfinite(before_at) or before_id is null then raise exception 'Invalid receivables cursor' using errcode='22023';end if;
 end if;
 with payments as materialized (
  select company_id,invoice_id,sum(case when kind='receipt' then amount_ore::numeric else -amount_ore::numeric end) paid from private.advertising_payment_entries group by company_id,invoice_id
 ), rows as materialized (
  select i.id,i.created_at,private.advertising_receivables_item(jsonb_build_object('companyId',i.company_id,'companyLabel',co.name,'companyStatus',co.status,'buyerLegalName',i.snapshot#>>'{assessment,snapshot,draft,snapshot,buyerProfile,fields,legalName}','buyerOrganisationNumber',i.snapshot#>>'{assessment,snapshot,draft,snapshot,buyerProfile,fields,organisationNumber}','sellerOrganisationNumber',i.snapshot#>>'{series,sellerOrganisationNumber}','invoiceId',i.id,'invoiceSourceHash',i.source_hash,'invoiceNumber',i.invoice_number,'month',i.month,'createdAt',i.created_at,'invoiceDate',i.invoice_date,'dueDate',i.due_date,'grossTotalOre',i.snapshot->>'grossTotalOre','credit',case when cr.id is null then null else jsonb_build_object('id',cr.id,'creditNumber',cr.credit_number,'sourceHash',cr.source_hash,'grossTotalOre',cr.snapshot->>'grossTotalOre') end),coalesce(p.paid,0),day) item
  from private.advertising_issued_invoices i join public.companies co on co.id=i.company_id left join private.advertising_credit_invoices cr on cr.company_id=i.company_id and cr.original_invoice_id=i.id left join payments p on p.company_id=i.company_id and p.invoice_id=i.id
 ), filtered as materialized (
  select * from rows where p_filter='all' or item->>'status'=p_filter or (p_filter='overdue' and (item->>'isOverdue')::boolean)
 ), selected as materialized (
  select * from filtered where p_cursor is null or (created_at,id)<(before_at,before_id) order by created_at desc,id desc limit 26
 ), page_rows as materialized (select * from selected order by created_at desc,id desc limit 25)
 select jsonb_build_object('actorUserId',actor,'actorRole','platform_admin','filter',p_filter,'generatedAt',at_time,'businessDate',day,
 'summary',(select jsonb_build_object('totalCount',count(*)::text,'counts',jsonb_build_object('unpaid',count(*) filter(where item->>'status'='unpaid')::text,'partial',count(*) filter(where item->>'status'='partial')::text,'settled',count(*) filter(where item->>'status'='settled')::text,'overpaid',count(*) filter(where item->>'status'='overpaid')::text,'credited',count(*) filter(where item->>'status'='credited')::text),'overdueCount',count(*) filter(where (item->>'isOverdue')::boolean)::text,'grossTotalOre',coalesce(sum((item->>'grossTotalOre')::numeric),0)::text,'creditTotalOre',coalesce(sum((item#>>'{credit,grossTotalOre}')::numeric),0)::text,'receivableOre',coalesce(sum((item->>'receivableOre')::numeric),0)::text,'receivedOre',coalesce(sum((item->>'receivedOre')::numeric),0)::text,'outstandingOre',coalesce(sum((item->>'outstandingOre')::numeric),0)::text,'surplusOre',coalesce(sum((item->>'surplusOre')::numeric),0)::text,'overdueOutstandingOre',coalesce(sum((item->>'outstandingOre')::numeric) filter(where (item->>'isOverdue')::boolean),0)::text) from rows),
 'filteredCount',(select count(*)::text from filtered),'items',(select coalesce(jsonb_agg(item order by created_at desc,id desc),'[]') from page_rows),
 'nextCursor',case when (select count(*) from selected)>25 then (select jsonb_build_object('filter',p_filter,'createdAt',item->>'createdAt','id',id,'actorUserId',actor) from page_rows order by created_at,id limit 1) else null end) into result;return result;
end $$;
revoke all on function private.get_advertising_receivables(text,jsonb) from public,anon,service_role;
grant execute on function private.get_advertising_receivables(text,jsonb) to authenticated;
commit;
