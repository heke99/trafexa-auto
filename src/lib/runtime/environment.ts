/** Refuse an implicit connection from a development copy to Trafexa's production data. */
export function assertSupabaseEnvironment(value: string | undefined, browserOrigin?: string): asserts value is string {
  if (!value) throw new Error('Supabase URL is not configured');
  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('Invalid Supabase project URL');
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) throw new Error('Invalid Supabase project protocol');
  if (url.hostname === 'buqdtssxrotkzndublrt.supabase.co'
    && process.env.VERCEL_ENV !== 'production'
    && process.env.NEXT_PUBLIC_TRAFEXA_DEPLOYMENT_TARGET !== 'production'
    && browserOrigin !== 'https://app.trafexa.com') {
    throw new Error('Production Supabase requires an explicit production deployment target');
  }
}

export function configuredSupabaseProjectUrl(): string {
  const value = process.env.NEXT_PUBLIC_SUPABASE_URL;
  assertSupabaseEnvironment(value);
  return value;
}
export function isSupabaseProjectConfigured(): boolean {
  try { configuredSupabaseProjectUrl(); return true; } catch { return false; }
}
