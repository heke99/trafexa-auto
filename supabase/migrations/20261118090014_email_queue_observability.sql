begin;
create function private.transactional_email_queue_status()returns jsonb language plpgsql security definer set search_path=''as $$
declare actor uuid;result jsonb;
begin
 actor:=private.account_approval_admin_identity();
 with source as materialized(
  select e.*,e.status='pending' and e.attempts<5 and private.customer_document_email_latest(e)
   and private.transactional_email_recipient_current(e)
   and not exists(select 1 from public.companies c where c.id=private.transactional_email_company_id(e)and c.status='suspended') as sendable
  from private.transactional_email_outbox e
 ), kinds as(
  select kind,count(*)filter(where status='pending') pending,count(*)filter(where sendable) sendable,min(created_at)filter(where sendable) oldest from source group by kind
 )select jsonb_build_object('pending',count(*)filter(where status='pending'),'processing',count(*)filter(where status='processing'),'accepted',count(*)filter(where status='accepted'),'rejected',count(*)filter(where status='rejected'),'unknown',count(*)filter(where status='unknown'),'cancelled',count(*)filter(where status='cancelled'),
 'queue',jsonb_build_object('sendableCount',count(*)filter(where sendable),'oldestSendableAt',min(created_at)filter(where sendable),
 'oldestSendableAgeSeconds',case when min(created_at)filter(where sendable)is null then null else greatest(0,floor(extract(epoch from clock_timestamp()-min(created_at)filter(where sendable))))::bigint end,
 'byKind',coalesce((select jsonb_agg(jsonb_build_object('kind',kind,'pending',pending,'sendable',sendable,'oldestSendableAt',oldest)order by kind)from kinds),'[]'::jsonb)))into result from source;
 if private.account_approval_admin_identity()<>actor then raise exception 'Admin changed'using errcode='42501';end if;
 return result;
end$$;
revoke all on function private.transactional_email_queue_status()from public,anon,service_role;
grant execute on function private.transactional_email_queue_status()to authenticated;
create or replace function public.get_transactional_email_status()returns jsonb language sql security invoker set search_path=''as $$select private.transactional_email_queue_status();$$;
revoke all on function public.get_transactional_email_status()from public,anon,service_role;
grant execute on function public.get_transactional_email_status()to authenticated;
commit;
