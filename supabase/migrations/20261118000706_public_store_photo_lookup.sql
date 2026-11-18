begin;

create or replace function private.get_public_store_photo(p_slug text, p_photo_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  company_id uuid;
  listing_id uuid;
  listing_version integer;
  object_path text;
  content_type text;
  size_bytes integer;
begin
  select p.object_path, p.content_type, p.size_bytes, s.company_id, l.id, (selected.value->>'version')::integer
  into object_path, content_type, size_bytes, company_id, listing_id, listing_version
  from private.public_dealer_stores s
  join public.companies c on c.id = s.company_id and c.status = 'active'
  join private.vehicle_photos p on p.company_id = s.company_id and p.id = p_photo_id and p.status = 'active'
  join private.advertising_listings l on l.company_id = p.company_id and l.stock_id = p.stock_id
  cross join lateral jsonb_array_elements(s.snapshot->'listings') selected(value)
  where s.slug = p_slug and s.status = 'published'
    and c.name = s.snapshot->'shop'->>'legalName'
    and c.organisation_number = s.snapshot->'shop'->>'organisationNumber'
    and selected.value->>'id' = l.id::text
    and selected.value->'photos' @> jsonb_build_array(jsonb_build_object('id', p_photo_id::text));

  if not found or not private.public_store_listing_live(company_id, listing_id, listing_version) then
    return null;
  end if;
  return jsonb_build_object('objectPath', object_path, 'contentType', content_type, 'sizeBytes', size_bytes);
end;
$$;

commit;
