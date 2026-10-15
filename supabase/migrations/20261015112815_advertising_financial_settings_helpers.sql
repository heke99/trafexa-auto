begin;
create function private.advertising_financial_account(p_method text,p_account text) returns boolean language plpgsql immutable set search_path='' as $$
declare n integer;i integer;d integer;s integer:=0;
begin
 if p_account is null then return false;end if;
 if p_method='iban' then
  if p_account !~ '^SE[0-9]{22}$' then return false;end if;
  return mod((substring(p_account from 5)||'2814'||substring(p_account from 3 for 2))::numeric,97)=1;
 end if;
 if p_method='bankgiro' then if p_account !~ '^[0-9]{7,8}$' then return false;end if;
 elsif p_method='plusgiro' then if p_account !~ '^[0-9]{2,8}$' then return false;end if;
 else return false;end if;
 if p_account ~ '^0+$' then return false;end if;
 n:=length(p_account);
 for i in 1..n loop d:=substring(p_account from i for 1)::integer;if mod(n-i,2)=1 then d:=d*2;if d>9 then d:=d-9;end if;end if;s:=s+d;end loop;
 return mod(s,10)=0;
end $$;
create function private.advertising_financial_fields(p_fields jsonb,p_saved boolean) returns jsonb language plpgsql immutable set search_path='' as $$
declare k text;v text;keys text[]:=array['vatTreatment','sellerVatRegistered','sellerVatNumber','paymentDays','paymentMethod','paymentAccount','reason'];
begin
 if p_fields is null or jsonb_typeof(p_fields)<>'object' or (select count(*) from jsonb_object_keys(p_fields))<>7 or not(p_fields?&keys) then raise exception 'Invalid financial settings' using errcode='22023';end if;
 if p_fields->>'vatTreatment' is null or p_fields->>'vatTreatment' not in ('unresolved','se_standard_25') or p_fields->>'paymentMethod' is null or p_fields->>'paymentMethod' not in ('unresolved','bankgiro','plusgiro','iban') or jsonb_typeof(p_fields->'sellerVatRegistered') not in ('boolean','null') or jsonb_typeof(p_fields->'paymentDays') not in ('number','null') then raise exception 'Invalid financial selection' using errcode='22023';end if;
 if p_fields->>'paymentDays' is not null and (p_fields->>'paymentDays' !~ '^[0-9]{1,2}$' or (p_fields->>'paymentDays')::integer not between 1 and 90) then raise exception 'Invalid payment days' using errcode='22023';end if;
 foreach k in array array['sellerVatNumber','paymentAccount','reason'] loop
  if jsonb_typeof(p_fields->k) not in ('string','null') then raise exception 'Invalid financial text type' using errcode='22023';end if;
  v:=p_fields->>k;
  if v is not null and (length(v) not between 1 and case k when 'reason' then 500 when 'sellerVatNumber' then 14 else 34 end or v<>btrim(v) or v ~ '[[:cntrl:]]' or v ~ ('['||chr(128)||'-'||chr(159)||']')) then raise exception 'Invalid financial text' using errcode='22023';end if;
 end loop;
 v:=p_fields->>'sellerVatNumber';if v is not null and v !~ '^SE[0-9]{10}01$' then raise exception 'Invalid seller VAT number' using errcode='22023';end if;
 v:=p_fields->>'paymentAccount';if v is not null and ((p_fields->>'paymentMethod'='unresolved' and v !~ '^[A-Z0-9]{2,34}$') or (p_fields->>'paymentMethod'<>'unresolved' and not private.advertising_financial_account(p_fields->>'paymentMethod',v))) then raise exception 'Invalid payment account' using errcode='22023';end if;
 if p_saved and p_fields->>'reason' is null then raise exception 'Review reason required' using errcode='22023';end if;
 return p_fields;
end $$;
alter table private.advertising_financial_settings add constraint advertising_financial_fields_valid check(private.advertising_financial_fields(fields,true)=fields);
revoke all on function private.advertising_financial_account(text,text),private.advertising_financial_fields(jsonb,boolean) from public,anon,authenticated,service_role;
commit;
