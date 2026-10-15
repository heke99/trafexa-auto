import { redirect } from 'next/navigation';

export const metadata = { title: 'Ansök om Trafexa', robots: { index: false, follow: false } };

export default function RegisterPage() {
 redirect('https://trafexa.com/#kontakt');
}
