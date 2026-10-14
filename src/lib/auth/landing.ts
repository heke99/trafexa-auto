import 'server-only';
import { safeNextPath } from '@/lib/routing.mjs';
import { getPlatformAdminContext } from '@/lib/platform-admin/context';
import { getAccountAccessContext } from '@/lib/account-access/context';

/** Keep an explicit destination through manual approval without recursive waiting links. */
export function getAccountPendingPath(next: unknown): string {
  const path = safeNextPath(next);
  const pathname = path.split(/[?#]/, 1)[0];
  return ['/dashboard', '/onboarding', '/account-pending'].includes(pathname) ? '/account-pending' : `/account-pending?${new URLSearchParams({ next: path })}`;
}

/** Recovery is always reachable. Business access requires the private approval registry. */
export async function getAuthenticatedLandingPath(next: unknown): Promise<string> {
  const path = safeNextPath(next);
  if (path === '/reset-password' || path.startsWith('/reset-password?') || path === '/forgot-password' || path.startsWith('/forgot-password?')) return path;
  const admin = await getPlatformAdminContext();
  if (admin) return path === '/dashboard' || path === '/onboarding' || path === '/account-pending' ? '/admin' : path;
  try {
    const account = await getAccountAccessContext();
    if (!account || !account.emailVerified || account.status !== 'approved') return getAccountPendingPath(path);
    return path === '/account-pending' ? '/dashboard' : path;
  } catch { return getAccountPendingPath(path); }
}
