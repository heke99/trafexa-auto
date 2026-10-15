begin;
create function private.advertising_invoice_context(p_company uuid,p_platform boolean) returns text language plpgsql security definer set search_path='' as $$
begin
 perform private.company_team_account(auth.uid(),true);
 -- Every invoice operation takes the global seller lock BEFORE the company billing lock.
 perform pg_advisory_xact_lock(hashtextextended('advertising-invoice-seller',0));
 if p_company is not null then return private.advertising_billing_context(p_company,p_platform);end if;
 if not p_platform or not private.has_platform_admin() then raise exception 'Platform administrator required' using errcode='42501';end if;
 perform 1 from private.platform_admins where user_id=auth.uid() and status='active' for share;
 if not found then raise exception 'Platform administrator required' using errcode='42501';end if;
 return 'platform_admin';
end $$;
create function private.advertising_invoice_fields(p_fields jsonb,p_buyer boolean) returns jsonb language plpgsql immutable set search_path='' as $$
declare k text;v text;keys text[]:=array['legalName','organisationNumber','invoiceEmail','addressLine1','addressLine2','postalCode','city','countryCode','reference'];limit_len integer;
begin
 if p_buyer then keys:=array['invoiceEmail','addressLine1','addressLine2','postalCode','city','countryCode','reference'];end if;
 if p_fields is null or jsonb_typeof(p_fields)<>'object' or (select count(*) from jsonb_object_keys(p_fields))<>cardinality(keys) then raise exception 'Invalid profile fields' using errcode='22023';end if;
 foreach k in array keys loop
  if not(p_fields?k) or jsonb_typeof(p_fields->k) not in ('null','string') then raise exception 'Invalid profile value' using errcode='22023';end if;
  v:=p_fields->>k;if v is null then continue;end if;
  limit_len:=case k when 'organisationNumber' then 10 when 'invoiceEmail' then 254 when 'postalCode' then 32 when 'city' then 80 when 'countryCode' then 2 else 160 end;
  if length(v) not between 1 and limit_len or v<>btrim(v) or v ~ '[[:cntrl:]]' or v ~ ('['||chr(128)||'-'||chr(159)||']') then raise exception 'Invalid profile text' using errcode='22023';end if;
  if k='organisationNumber' and v !~ '^[0-9]{10}$' then raise exception 'Invalid organisation number' using errcode='22023';end if;
  if k='invoiceEmail' and (v<>lower(v) or v !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') then raise exception 'Invalid invoice email' using errcode='22023';end if;
  if k='countryCode' and not(v=any(string_to_array('AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW',' '))) then raise exception 'Invalid ISO country' using errcode='22023';end if;
 end loop;
 return p_fields;
end $$;
create function private.advertising_invoice_missing(p_fields jsonb) returns jsonb language sql immutable set search_path='' as $$
 select coalesce(jsonb_agg(k order by n),'[]') from unnest(array['legalName','organisationNumber','invoiceEmail','addressLine1','postalCode','city','countryCode']) with ordinality x(k,n) where p_fields->>k is null;
$$;
revoke all on function private.advertising_invoice_context(uuid,boolean),private.advertising_invoice_fields(jsonb,boolean),private.advertising_invoice_missing(jsonb) from public,anon,authenticated,service_role;
alter table private.advertising_invoice_profiles add constraint advertising_invoice_profile_fields_valid check(private.advertising_invoice_fields(fields,false)=fields);
commit;
