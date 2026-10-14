import type { Metadata } from 'next';
import './globals.css';
import { CookieConsent } from '@/components/cookie-consent';
export const metadata: Metadata = { metadataBase: new URL('https://trafexa.com'), title: { default: 'Trafexa — bilaffären samlad', template: '%s | Trafexa' }, description: 'Fordonslager med CSV-import, fordonskostnader, CRM, offerter, reservationer och privat PDF-arkiv för svenska bilhandlare. Samla bilaffären i Trafexa.' };
export default function RootLayout({ children }: {children: React.ReactNode}) { return <html lang="sv"><body>{children}<CookieConsent/></body></html>; }
