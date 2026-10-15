select jsonb_build_object(
 'users',(select count(*)from auth.users where id::text like 'fd230000-0000-4000-8000-%'),
 'companies',(select count(*)from public.companies where id::text like 'fd230000-0000-4000-8000-%'),
 'receipts',(select count(*)from private.dealer_create_receipts where company_id::text like 'fd230000-0000-4000-8000-%'),
 'customers',(select count(*)from public.customers where company_id::text like 'fd230000-0000-4000-8000-%'),
 'financeApplications',(select count(*)from public.finance_applications where company_id::text like 'fd230000-0000-4000-8000-%'),
 'auditEvents',(select count(*)from public.audit_events where company_id::text like 'fd230000-0000-4000-8000-%')
);
