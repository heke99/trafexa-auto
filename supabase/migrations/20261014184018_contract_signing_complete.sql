begin;
create function private.sign_contract(p_signing_id uuid,p_company_id uuid,p_expected_revision integer,p_document_hash text,p_full_name text,p_strokes jsonb,p_acknowledged boolean,p_consent_version text,p_request_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$declare a uuid;r text;e text;s private.contract_signings;v_party text;p jsonb;receipt jsonb;n integer;ds text;customer_actor uuid;company_actor uuid;company_email text;begin
 if p_company_id is null then select user_id,email into a,e from private.company_team_identity(true);r:='customer';v_party:='customer';select * into s from private.contract_signings where id=p_signing_id and customer_email=e;
 else select actor,actor_role into a,r from private.sale_contract_access(p_company_id,true);v_party:='company';select * into s from private.contract_signings where id=p_signing_id and company_id=p_company_id;end if;
 if s.id is null then raise exception 'Signing denied' using errcode='42501';end if;
 perform 1 from public.companies where id=s.company_id and status='active' for share;if not found then raise exception 'Company denied' using errcode='42501';end if;
 select status into ds from public.deals where company_id=s.company_id and id=s.deal_id for update;
 select * into s from private.contract_signings where id=s.id for update;
 if p_expected_revision is null or p_expected_revision not between 1 and 2 or p_document_hash is distinct from s.document_hash or p_full_name is null or p_full_name<>btrim(p_full_name) or length(p_full_name) not between 2 and 160 or p_full_name ~ '[[:cntrl:]]' or p_acknowledged is distinct from true or p_consent_version is distinct from '2026-10-14' or not private.contract_signature_valid(p_strokes) then raise exception 'Invalid signature acknowledgement' using errcode='22023';end if;
 p:=jsonb_build_object('operation','signContract','signingId',s.id,'companyId',p_company_id,'party',v_party,'expectedRevision',p_expected_revision,'documentHash',p_document_hash,'fullName',p_full_name,'strokes',p_strokes,'acknowledged',true,'consentVersion',p_consent_version);
 receipt:=private.contract_signing_replay(a,p_request_id,p);if receipt is not null then return receipt;end if;
 select count(*) into n from private.contract_signatures where signing_id=s.id;
 if ds not in('draft','reserved') or 1+n<>p_expected_revision or exists(select 1 from private.contract_signatures x where x.signing_id=s.id and(x.party=v_party or x.actor_user_id=a)) then raise exception 'Signature conflict' using errcode='40001';end if;
 insert into private.contract_signatures(signing_id,party,actor_user_id,full_name,document_hash,consent_version,strokes)values(s.id,v_party,a,p_full_name,s.document_hash,p_consent_version,p_strokes);
 if n=1 then
 select actor_user_id into customer_actor from private.contract_signatures where signing_id=s.id and contract_signatures.party='customer';
 perform private.enqueue_transactional_email('contract_completed',s.id,s.customer_email,customer_actor);
 select x.actor_user_id,u.email into company_actor,company_email from private.contract_signatures x join auth.users u on u.id=x.actor_user_id where x.signing_id=s.id and x.party='company';
 perform private.enqueue_transactional_email('contract_completed_company',s.id,company_email,company_actor);
 end if;
 receipt:=jsonb_build_object('companyId',s.company_id,'actorUserId',a,'actorRole',r,'recipientEmail',e,'requestId',p_request_id,'signing',private.contract_signing_json(s,a,r));
 insert into private.contract_signing_audit(actor_user_id,request_id,payload,receipt)values(a,p_request_id,p,receipt);return receipt;
end$$;
revoke all on function private.sign_contract(uuid,uuid,integer,text,text,jsonb,boolean,text,uuid) from public,anon,authenticated,service_role;
commit;
