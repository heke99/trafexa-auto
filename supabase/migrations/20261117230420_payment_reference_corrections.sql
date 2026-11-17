begin;

-- Keep the original posting, reversal and every corrected posting in the ledger.
alter table private.deal_payment_entries
 add column correction_of uuid unique references private.deal_payment_entries(id),
 add constraint deal_payment_correction_requires_posting
 check(correction_of is null or (reversal_of is null and correction_of<>id));
drop index private.deal_payment_bank_reference;
create unique index deal_payment_bank_reference
 on private.deal_payment_entries(company_id,bank_reference)
 where reversal_of is null and correction_of is null;
create index deal_payment_bank_reference_history
 on private.deal_payment_entries(company_id,bank_reference)
 where reversal_of is null;

create function private.attach_payment_correction() returns trigger
language plpgsql set search_path='' as $$
declare predecessor private.deal_payment_entries;
begin
 if new.correction_of is not null then
  raise exception 'Payment correction is derived from the ledger' using errcode='22023';
 end if;
 if new.reversal_of is not null then return new;end if;
 select p.* into predecessor
 from private.deal_payment_entries p
 where p.company_id=new.company_id and p.bank_reference=new.bank_reference and p.reversal_of is null
 and not exists(select 1 from private.deal_payment_entries n where n.correction_of=p.id);
 if not found then return new;end if;
 if predecessor.deal_id<>new.deal_id or predecessor.category<>new.category
 or not exists(select 1 from private.deal_payment_entries r where r.reversal_of=predecessor.id) then
  raise exception 'Bank reference already used' using errcode='23505',constraint='deal_payment_bank_reference';
 end if;
 -- A single root per reference and a single successor per posting also make
 -- concurrent inserts reject competing changes without modifying prior entries.
 new.correction_of:=predecessor.id;
 return new;
end $$;
revoke all on function private.attach_payment_correction() from public,anon,authenticated,service_role;
create trigger deal_payment_attach_correction before insert on private.deal_payment_entries
for each row execute function private.attach_payment_correction();

commit;
