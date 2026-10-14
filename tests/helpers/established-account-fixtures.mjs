/** Local regression-fixture setup only; never install this in the hosted database.
 * Existing feature suites model accounts already approved by the platform.
 * Dedicated account-approval suites must leave this disabled and test real absence.
 */
export async function installEstablishedAccountFixtures(db) {
 await db.exec(`do $$begin
 if to_regclass('private.account_approvals') is not null then
  execute 'create function private.test_established_account_approval() returns trigger language plpgsql set search_path='''' as $body$begin insert into private.account_approvals(user_id,status,updated_by) values(new.id,''approved'',new.id) on conflict do nothing; return new; end$body$';
  execute 'create trigger test_established_account_approval after insert on auth.users for each row execute function private.test_established_account_approval()';
 end if;
 end$$;`);
}
