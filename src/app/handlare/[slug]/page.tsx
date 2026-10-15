import Link from 'next/link';
import { notFound } from 'next/navigation';
import { loadPublicDealerStore } from '@/lib/public-dealer-store/public';
import styles from './store.module.css';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';
export const metadata = { title: 'Handlarbutik', robots: { index: false, follow: false } };
const money = (value: string) => { const amount = BigInt(value); return `${(amount / BigInt(100)).toLocaleString('sv-SE')},${(amount % BigInt(100)).toString().padStart(2, '0')} kr`; };
const fuelLabel = (value: string) => ({ petrol: 'Bensin', diesel: 'Diesel', electric: 'El', hybrid: 'Hybrid', other: 'Annat' }[value] ?? value);
const transmissionLabel = (value: string) => ({ automatic: 'Automat', manual: 'Manuell' }[value] ?? value);

export default async function PublicDealerStorePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const store = await loadPublicDealerStore(slug);
  if (!store) notFound();
  const shop = store.shop;
  return <div className={styles.site}>
    <a className="skip-link" href="#store-main">Till butiken</a>
    <header className={styles.header}><Link href="/" aria-label="Trafexa startsida" className={styles.brand}>trafexa<span>.</span></Link><span>Handlarbutik</span></header>
    <main id="store-main" className={styles.main}>
      <section className={styles.hero} aria-labelledby="store-title"><p className={styles.eyebrow}>Bilhandlare på Trafexa</p><h1 id="store-title">{shop.displayName}</h1>{shop.description && <p className={styles.description}>{shop.description}</p>}<p className={styles.legal}>{shop.legalName} · Organisationsnummer {shop.organisationNumber}</p></section>
      <section className={styles.contact} aria-label="Butikens kontaktuppgifter"><div><h2>Besök oss</h2><address>{shop.addressLine1}{shop.addressLine2 && <><br/>{shop.addressLine2}</>}<br/>{shop.postalCode} {shop.city}<br/>Sverige</address></div><div><h2>Kontakta handlaren</h2><p><a href={`mailto:${shop.publicEmail}`}>{shop.publicEmail}</a></p><p><a href={`tel:${shop.publicPhone.replace(/[^+0-9]/g, '')}`}>{shop.publicPhone}</a></p>{shop.websiteUrl && <p><a href={shop.websiteUrl} target="_blank" rel="noreferrer">Handlarens webbplats</a></p>}</div>{shop.openingHoursText && <div><h2>Öppettider</h2><p style={{ whiteSpace: 'pre-wrap' }}>{shop.openingHoursText}</p></div>}</section>
      <section className={styles.inventory} aria-labelledby="store-inventory"><div className={styles.inventoryHeading}><h2 id="store-inventory">Bilar hos {shop.displayName}</h2><span>{store.listings.length} annonser</span></div>{!store.listings.length && <p>Inga annonser visas just nu. Kontakta handlaren för information.</p>}<div className={styles.grid}>{store.listings.map(listing => <article key={listing.id} className={styles.card}>
        {listing.photos.length > 0 && <div className={styles.photos}>{listing.photos.map((photo, index) => <img key={photo.id} src={`/api/public-stores/${store.slug}/photos/${photo.id}`} alt={`${listing.make} ${listing.model} – bild ${index + 1}`} loading="lazy" decoding="async" width={640} height={420}/>)}</div>}
        <div className={styles.cardBody}><h3>{listing.title}</h3><p className={styles.price}>{money(listing.priceOre)}</p><p className={styles.specs}>{listing.make} {listing.model} · {listing.year} · {listing.mileageKm.toLocaleString('sv-SE')} km<br/>{fuelLabel(listing.fuel)} · {transmissionLabel(listing.transmission)}</p><p className={styles.listingDescription}>{listing.description}</p><a className="button button-outline" href={`mailto:${shop.publicEmail}?subject=${encodeURIComponent(`Förfrågan: ${listing.title}`)}`}>Kontakta handlaren om bilen</a></div>
      </article>)}</div></section>
    </main>
    <footer className={styles.footer}><p>Butiksinformation och annonser publiceras av {shop.legalName}.</p><Link href="/privacy">Integritet</Link><Link href="/terms">Villkor</Link><a href={`/api/public-stores/${store.slug}`}>Butikens publika JSON</a></footer>
  </div>;
}
