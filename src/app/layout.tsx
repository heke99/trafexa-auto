import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = { metadataBase: new URL('https://trafexa.com'), title: { default: 'Trafexa — bilaffären samlad', template: '%s | Trafexa' }, description: 'Lager, kunder, affärer och finansieringsförfrågningar för svenska bilhandlare. Ett sammanhängande arbetsflöde från inköp till försäljning.' };
export default function RootLayout({ children }: {children: React.ReactNode}) { return <html lang="sv"><body>{children}</body></html>; }
