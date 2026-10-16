import 'server-only';

type AuthClient = { auth: { signOut(options: { scope: 'global' }): Promise<{ error: unknown }> } };

/** Password changes remain saved even if revoking the existing sessions fails. */
export async function tryGlobalSignOut(db: AuthClient): Promise<boolean> {
  try { return (await db.auth.signOut({ scope: 'global' })).error === null; }
  catch { return false; }
}

export const savedPasswordSignOutWarning = 'Lösenordet har sparats, men utloggningen från alla sessioner kunde inte bekräftas. Logga ut och logga sedan in med ditt nya lösenord.';
export const passwordChangeUnconfirmedWarning = 'Lösenordsändringen kunde inte bekräftas. Försök logga in med ditt nya lösenord. Om det inte fungerar, begär en ny återställningslänk.';
export const sessionSignOutUnconfirmedWarning = 'Utloggningen från alla sessioner kunde inte bekräftas. Försök logga ut igen innan du loggar in med ditt lösenord.';
