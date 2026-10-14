import 'server-only';

const productionOrigin = 'https://app.trafexa.com';

function origin(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if ((url.protocol !== 'https:' && !(local && url.protocol === 'http:')) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) return null;
    return url.origin;
  } catch { return null; }
}

/** Production emails and callbacks must never inherit a development/Host URL. */
export function getAuthAppOrigin(requestOrigin?: string): string {
  if (process.env.VERCEL_ENV === 'production' || (!process.env.VERCEL_ENV && process.env.NODE_ENV === 'production')) return productionOrigin;
  if (process.env.NEXT_PUBLIC_APP_URL) return origin(process.env.NEXT_PUBLIC_APP_URL) ?? productionOrigin;
  return origin(requestOrigin) ?? productionOrigin;
}
