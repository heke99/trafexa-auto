begin;
create function private.sale_contract_body_valid(b text) returns boolean language plpgsql immutable set search_path='' as $$declare m text[];remaining text;begin
 if b is null or length(b) not between 2 and 12000 or translate(b,E'\n\r\t','') ~ '[[:cntrl:]]' then return false;end if;
 for m in select regexp_matches(b,'\{\{([^{}]+)\}\}','g') loop
 if not m[1]=any(array['company.name','company.organisation_number','customer.name','customer.email','vehicle.registration','vehicle.make','vehicle.model','vehicle.model_year','offer.version','offer.price_ore','trade_in.value_ore','trade_in.amount_to_pay_ore']) then return false;end if;
 end loop;
 remaining:=regexp_replace(b,'\{\{([^{}]+)\}\}','','g');return remaining !~ '[{}]';
end$$;
create function private.sale_contract_replay(a uuid,n uuid,p jsonb) returns jsonb language plpgsql set search_path='' as $$declare old private.sale_contract_audit;begin if n is null then raise exception 'Request required' using errcode='22023';end if;perform pg_advisory_xact_lock(hashtextextended(a::text||n::text,0));select * into old from private.sale_contract_audit where actor_user_id=a and request_id=n;if found then if old.payload is distinct from p then raise exception 'Request conflict' using errcode='40001';end if;return old.receipt;end if;return null;end$$;
revoke all on function private.sale_contract_body_valid(text),private.sale_contract_replay(uuid,uuid,jsonb) from public,anon,authenticated,service_role;
commit;
