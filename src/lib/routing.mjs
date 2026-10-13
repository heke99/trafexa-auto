export const WORKSPACE_SECTIONS = ['dashboard', 'inventory', 'customers', 'deals', 'finance', 'network', 'documents', 'settings'];
export function isWorkspacePath(path) {
  return WORKSPACE_SECTIONS.some(section => path === `/${section}` || path.startsWith(`/${section}/`));
}
export function isAuthPath(path) {
  return ['/login', '/register', '/onboarding', '/forgot-password', '/reset-password', '/auth/callback'].includes(path);
}
export function domainRedirect(host, path, search = '') {
  if (host === 'app.trafexa.com' && path === '/') return `https://app.trafexa.com/dashboard${search}`;
  if (['trafexa.com', 'www.trafexa.com'].includes(host) && (isWorkspacePath(path) || isAuthPath(path))) return `https://app.trafexa.com${path}${search}`;
  return null;
}
export function safeNextPath(path) {
  return typeof path === 'string' && path.startsWith('/') && !path.startsWith('//') && !path.includes('\\') && !/[\u0000-\u001f]/.test(path) ? path : '/dashboard';
}
