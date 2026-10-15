/** UI hints and server checks share these narrow capabilities; SQL remains the
 * authority for each actual company, account and resource. Unknown roles deny. */
export function canReadInternalFinance(role: unknown): boolean {
  return role === 'owner' || role === 'admin' || role === 'finance';
}
export function canManageStockIntake(role: unknown): boolean {
  return role === 'owner' || role === 'admin';
}
export function canWriteInternalFinance(role: unknown): boolean {
  return role === 'owner' || role === 'admin';
}
