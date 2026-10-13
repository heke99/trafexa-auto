-- PROPOSAL ONLY. Not applied and excluded from supabase/migrations.
-- Automatic approval review rejected persistent production scheduling.
-- Requires explicit approval before enabling pg_cron or creating this job.
-- Process a bounded batch, including when no dealer is viewing the application.
create or replace function private.expire_reservations() returns integer
language plpgsql security definer set search_path='' as $$
declare item record; processed integer:=0;
begin
 for item in
  select s.id from public.stock_items s
  where exists (
   select 1 from public.reservations r
   where r.stock_item_id=s.id and r.status='active' and r.expires_at<=now()
  )
  order by s.id limit 500 for update of s skip locked
 loop
  perform private.expire_stock_reservations(item.id);
  processed:=processed+1;
 end loop;
 return processed;
end $$;
revoke all on function private.expire_reservations() from public,anon,authenticated;

-- Supabase Cron runs as postgres. Browser roles cannot manage scheduled jobs.
create extension if not exists pg_cron with schema pg_catalog;
revoke all on schema cron from public,anon,authenticated;
revoke all on all functions in schema cron from public,anon,authenticated;
grant usage on schema cron to postgres;
grant all privileges on all tables in schema cron to postgres;

select cron.schedule(
 'trafexa-expire-reservations',
 '* * * * *',
 'set statement_timeout=''30s''; select private.expire_reservations();'
);
