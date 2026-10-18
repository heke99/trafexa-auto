begin;
alter table private.transactional_email_outbox add column delivery_generation integer not null default 0 check(delivery_generation>=0);
alter table private.transactional_email_outbox drop constraint transactional_email_outbox_kind_reference_id_recipient_key;
alter table private.transactional_email_outbox add unique(kind,reference_id,recipient,delivery_generation);
create or replace function private.enqueue_transactional_email(p_kind text,p_reference uuid,p_recipient text,p_user_id uuid default null) returns void
 language plpgsql security definer set search_path='' as $$begin
 insert into private.transactional_email_outbox(kind,reference_id,recipient,recipient_user_id,delivery_generation)
 values(p_kind,p_reference,lower(btrim(p_recipient)),p_user_id,0) on conflict(kind,reference_id,recipient,delivery_generation) do nothing;
end$$;
create table private.customer_document_renewals(
 actor_user_id uuid not null references auth.users(id),request_id uuid not null,
 company_id uuid not null references public.companies(id),deal_id uuid not null references public.deals(id),
 previous_email_id uuid not null unique references private.transactional_email_outbox(id),
 previous_invitation_id uuid not null unique references private.guest_document_invitations(id),
 email_id uuid not null unique references private.transactional_email_outbox(id),
 invitation_id uuid not null unique references private.guest_document_invitations(id),
 request_payload jsonb not null,receipt jsonb not null,created_at timestamptz not null default clock_timestamp(),
 primary key(actor_user_id,request_id)
);
alter table private.customer_document_renewals enable row level security;
revoke all on private.customer_document_renewals from public,anon,authenticated,service_role;
create trigger customer_document_renewal_immutable before update or delete on private.customer_document_renewals
 for each row execute function private.sale_contract_immutable();
create function private.customer_document_email_latest(e private.transactional_email_outbox) returns boolean
 language sql stable security invoker set search_path='' as $$
 select not exists(select 1 from private.transactional_email_outbox x where x.kind=e.kind and x.reference_id=e.reference_id and x.recipient=e.recipient and x.delivery_generation>e.delivery_generation);
$$;
revoke all on function private.customer_document_email_latest(private.transactional_email_outbox) from public,anon,authenticated,service_role;
create function private.customer_document_saved_review(e private.transactional_email_outbox)returns jsonb
 language plpgsql security invoker set search_path=''as $$
declare saved private.customer_document_renewals;i private.guest_document_invitations;
begin
 select *into saved from private.customer_document_renewals where email_id=e.id;
 select *into i from private.guest_document_invitations where id=saved.invitation_id and email_id=e.id;
 if saved.email_id is null or i.id is null or i.dealer_actor_user_id<>saved.actor_user_id or i.company_id<>saved.company_id
 or i.recipient_email<>e.recipient or i.kind<>e.kind or i.reference_id<>e.reference_id
 or e.kind is distinct from saved.receipt->>'kind' or e.reference_id is distinct from(saved.receipt->>'referenceId')::uuid
 or i.document_hash is distinct from saved.receipt->>'documentHash' or i.document_version is distinct from(saved.receipt->>'documentVersion')::integer
 or e.delivery_generation is distinct from(saved.receipt->>'generation')::integer then raise exception 'Saved document review unavailable'using errcode='40001';end if;
 return jsonb_build_object('companyId',i.company_id,'actorUserId',saved.actor_user_id,'invitationId',i.id,
 'recipientEmail',e.recipient,'documentHash',i.document_hash,'documentVersion',i.document_version,'generation',e.delivery_generation);
end$$;
revoke all on function private.customer_document_saved_review(private.transactional_email_outbox)from public,anon,authenticated,service_role;
commit;
