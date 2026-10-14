begin;
create function private.contract_signature_valid(s jsonb) returns boolean language plpgsql immutable set search_path='' as $$
declare stroke jsonb;points jsonb;p jsonb;firstp jsonb;lastp jsonb;x numeric;y numeric;dx numeric;dy numeric;distance numeric;spread numeric;total integer:=0;skipped integer:=0;meaningful boolean:=false;
begin
 if s is null or jsonb_typeof(s)<>'array' or jsonb_array_length(s) not between 1 and 256 or octet_length(s::text)>500000 then return false;end if;
 for stroke in select value from jsonb_array_elements(s) loop
  if jsonb_typeof(stroke)<>'object' or not stroke ? 'points' or (stroke-'points')<>'{}'::jsonb then return false;end if;
  points:=stroke->'points';if jsonb_typeof(points)<>'array' or jsonb_array_length(points) not between 0 and 4096 then return false;end if;
  total:=total+jsonb_array_length(points);if total>16384 then return false;end if;
  spread:=0;distance:=0;
  for p in select value from jsonb_array_elements(points) loop
   if jsonb_typeof(p)<>'object' or (p-array['x','y'])<>'{}'::jsonb or jsonb_typeof(p->'x')<>'number' or jsonb_typeof(p->'y')<>'number' then return false;end if;
   x:=(p->>'x')::numeric;y:=(p->>'y')::numeric;if abs(x)>1000000 or abs(y)>1000000 then return false;end if;
  end loop;
  if jsonb_array_length(points)<=2 then continue;end if;
  firstp:=points->0;lastp:=points->(jsonb_array_length(points)-1);
  dx:=(lastp->>'x')::numeric-(firstp->>'x')::numeric;dy:=(lastp->>'y')::numeric-(firstp->>'y')::numeric;
  for p in select value from jsonb_array_elements(points) loop
   x:=(p->>'x')::numeric-(firstp->>'x')::numeric;y:=(p->>'y')::numeric-(firstp->>'y')::numeric;
   spread:=spread+sqrt(x*x+y*y);
   if dx<>0 or dy<>0 then distance:=distance+abs(dy*x-dx*y)/sqrt(dx*dx+dy*dy);end if;
  end loop;
  if dx=0 and dy=0 then if spread/jsonb_array_length(points)>=3 then meaningful:=true;end if;continue;end if;
  if distance/jsonb_array_length(points)<3 and skipped<2 then skipped:=skipped+1;continue;end if;meaningful:=true;
 end loop;return meaningful;
exception when others then return false;
end$$;
create function private.contract_signing_replay(a uuid,n uuid,p jsonb) returns jsonb language plpgsql set search_path='' as $$declare old private.contract_signing_audit;begin
 if n is null then raise exception 'Request required' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended(a::text||n::text,4));select * into old from private.contract_signing_audit where actor_user_id=a and request_id=n;
 if found then if old.payload is distinct from p then raise exception 'Request conflict' using errcode='40001';end if;return old.receipt;end if;return null;end$$;
create function private.contract_signing_json(s private.contract_signings,a uuid,r text) returns jsonb language sql set search_path='' as $$
 select jsonb_build_object('id',s.id,'companyId',s.company_id,'dealId',s.deal_id,'draftId',s.draft_id,'draftVersion',d.version,'documentHash',s.document_hash,'canonicalContent',s.canonical_content,'draft',private.sale_contract_draft_json(d),'customerEmail',s.customer_email,'createdAt',s.created_at,
 'revision',1+q.n,'status',case when q.n=2 then 'completed' when c.status<>'active' or b.status not in('draft','reserved') then 'unavailable' else 'pending' end,
 'completedAt',case when q.n=2 then q.completed end,'customerSignature',q.customer,'companySignature',q.company,
 'party',case when r='customer' then 'customer' when r in('owner','admin') then 'company' end,
 'canSign',q.n<2 and c.status='active' and b.status in('draft','reserved') and not exists(select 1 from private.contract_signatures z where z.signing_id=s.id and(z.actor_user_id=a or z.party=case when r='customer' then 'customer' else 'company' end)) and r in('customer','owner','admin'))
 from private.sale_contract_drafts d join public.companies c on c.id=s.company_id join public.deals b on b.company_id=s.company_id and b.id=s.deal_id,
 lateral(select count(*)::integer n,max(x.signed_at) completed,
 max(case when x.party='customer' then jsonb_build_object('party',x.party,'fullName',x.full_name,'signedAt',x.signed_at,'documentHash',x.document_hash,'consentVersion',x.consent_version,'strokes',x.strokes)::text end)::jsonb customer,
 max(case when x.party='company' then jsonb_build_object('party',x.party,'fullName',x.full_name,'signedAt',x.signed_at,'documentHash',x.document_hash,'consentVersion',x.consent_version,'strokes',x.strokes)::text end)::jsonb company
 from private.contract_signatures x where x.signing_id=s.id)q where d.id=s.draft_id;
$$;
revoke all on function private.contract_signature_valid(jsonb),private.contract_signing_replay(uuid,uuid,jsonb),private.contract_signing_json(private.contract_signings,uuid,text) from public,anon,authenticated,service_role;
commit;
