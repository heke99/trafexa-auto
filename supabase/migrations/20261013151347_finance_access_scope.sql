-- Finance intake is visible to its salesperson and the company's finance administrators.
drop policy tenant_read on public.finance_applications;
create policy finance_read on public.finance_applications
for select to authenticated using (
 private.has_company_role(company_id,array['owner','admin','finance'])
 or (private.has_company_role(company_id,array['sales']) and created_by=(select auth.uid()))
);

-- Every document kind may contain confidential personal or financial information.
drop policy tenant_read on public.documents;
create policy documents_read on public.documents
for select to authenticated using (
 private.has_company_role(company_id,array['owner','admin','finance'])
);
drop policy tenant_insert on public.documents;
create policy documents_insert on public.documents
for insert to authenticated with check (
 private.has_company_role(company_id,array['owner','admin','finance'])
);

-- The private bucket has the same role boundary as its document metadata.
-- Compare path segments as text so malformed user paths cannot cause UUID-cast errors.
drop policy dealer_documents_read on storage.objects;
create policy dealer_documents_read on storage.objects
for select to authenticated using (
 bucket_id='dealer-documents' and exists (
  select 1 from public.memberships m
  where m.user_id=(select auth.uid())
  and m.company_id::text=(storage.foldername(name))[1]
  and private.has_company_role(m.company_id,array['owner','admin','finance'])
 )
);
drop policy dealer_documents_insert on storage.objects;
create policy dealer_documents_insert on storage.objects
for insert to authenticated with check (
 bucket_id='dealer-documents' and exists (
  select 1 from public.memberships m
  where m.user_id=(select auth.uid())
  and m.company_id::text=(storage.foldername(name))[1]
  and private.has_company_role(m.company_id,array['owner','admin','finance'])
 )
);
