import Link from 'next/link';
import { ArrowUpRight, ArrowRight, Check, CarFront, Calculator, Users } from 'lucide-react';
import { Brand } from './brand';
import { PilotForm } from './pilot-form';
import { CookieSettingsButton } from './cookie-consent';
import { PublicMobileMenu } from './public-mobile-menu';

export function PublicSite() {
  return <div className="public-site"><a className="skip-link" href="#main">Till innehållet</a>
    <header className="public-header wrap"><Brand/><nav className="public-nav" aria-label="Huvudmeny"><a href="#systemet">Systemet</a><a href="#finansiering">Finansiering</a><a href="#natverket">Nätverket</a></nav><Link href={`${process.env.NEXT_PUBLIC_APP_URL??''}/login`} className="nav-login">Logga in <ArrowUpRight size={16}/></Link><PublicMobileMenu/></header>
    <main id="main">
      <section className="hero wrap" aria-labelledby="hero-heading">
        <div className="hero-copy">
          <p className="eyebrow"><span className="little-line"/> För den oberoende bilhandlaren</p>
          <h1 id="hero-heading">Ditt lager. Dina kunder.<br/><span>Din nästa bilaffär.</span></h1>
          <p className="hero-description">Bilhandlarens system för lager, kalkyl och CRM. Samla bilar, bilder och kostnader – och gå från kundkontakt till offert och reservation i samma arbetsyta.</p>
          <div className="hero-actions">
            <a className="button button-green" href="#kontakt">Ansök om Trafexa <ArrowUpRight size={18}/></a>
            <Link className="button button-outline" href="/demo">Utforska systemet <ArrowRight size={18}/></Link>
          </div>
          <p className="hero-note">För ditt företag och ditt team. Se arbetsytan med exempeldata i demon.</p>
          <ul className="hero-benefits" aria-label="Det här får du i arbetsytan">
            <li><CarFront size={20} aria-hidden="true"/><div><strong>Lager & bilder</strong><span>Fordonskort, CSV-import och privata bilder.</span></div></li>
            <li><Calculator size={20} aria-hidden="true"/><div><strong>Kalkyl & moms</strong><span>Inköp, kostnader och resultat per bil.</span></div></li>
            <li><Users size={20} aria-hidden="true"/><div><strong>Kunder & affärer</strong><span>Kontaktlogg, uppföljning, offert och reservation.</span></div></li>
          </ul>
        </div>
        <div className="hero-product"><ProductPreview/><div className="product-caption"><span>Från lagerbil till kundaffär.</span><span>Illustration med exempeldata</span></div></div>
      </section>
      <section className="principles wrap" aria-label="Trafexas tre delar"><div><span className="number">01</span><h2>Bilaffären</h2><p>Lager, kalkyler, kunder och offerter.<br/>Bilens underlag samlat.</p></div><div><span className="number">02</span><h2>Finansieringen</h2><p>Köp- och lagerfinansiering<br/>med anslutning per partnerprodukt.</p></div><div><span className="number">03</span><h2>Handlarnätverket</h2><p>Utvalda bilar och inköpsönskemål.<br/>Åtkomst enligt anslutningsavtal.</p></div></section>
      <section id="systemet" className="product-section wrap"><div className="section-intro"><p className="eyebrow">Verktygen för din bilaffär</p><h2>Slipp börja om<br/>i varje system.</h2><p>Från fordonskort och kundkontakt till offert och reservation. Arbeta med samma uppgifter och ta fram offertens PDF-underlag när du behöver det.</p></div><div className="feature-rows">{[
        ['01', 'Fordonslager och CSV-import', 'Lägg in bilar på fordonskort eller importera lagret från CSV. Granska raderna före import och samla biluppgifter, inköpspris, försäljningspris och momsmodell.'],
        ['02', 'Fordonskalkyl och momsunderlag', 'Samla inköp, försäljningspris och direkta kostnader i bilens kalkyl. Resultat efter moms visas när momsmodell och avdragsunderlag har bekräftats.'],
        ['03', 'Kundregister, kontaktlogg och uppföljningar', 'Samla kunduppgifter, samtal, möten och anteckningar. Följ upp kundkontakten inför affären och samla bil, offert och reservation i samma arbetsyta.'],
        ['04', 'Offerter, kundsvar och reservationer', 'Skapa versionsbundna offerter med pris, giltighet och villkor. Tillgängliggör en sparad version för kundens verifierade konto och följ svaret. Reservera bilen och frigör reservationen när förutsättningarna ändras.'],
        ['05', 'Offertens PDF-underlag', 'Ta fram en PDF från offertens uppgifter med pris, giltighet och villkor. Underlaget hör till den aktuella offertversionen så att bil och affär stämmer överens.'],
        ['06', 'Personal, inbjudningar och behörigheter', 'Bjud in kollegor till företaget och ge rätt roll. Hantera personalens åtkomst med granskade ändringar, samtidigt som varje företags uppgifter hålls separata.'],
        ['07', 'Annonskonto och privata fordonsbilder', 'Skapa annonsutkast från lagerbilens uppgifter, pris och valda bilder. Granska varje version före kanalutskick. Extern publicering kräver kanalavtal och verifierad teknisk anslutning.'],
      ].map(([n,title,description]) => <div className="feature-row" key={n}><span>{n}</span><div><h3>{title}</h3><p>{description}</p></div><ArrowUpRight size={21}/></div>)}</div></section>
      <section id="finansiering" className="finance-section"><div className="wrap finance-layout"><div><p className="eyebrow">Finansiering genom partnernätverket</p><h2>Rätt förutsättningar<br/>för nästa affär.</h2><p className="finance-lead">Samla företagets finansbehov och håll köpfinansiering och lagerfinansiering åtskilda. Tillgång till en partnerprodukt kräver avtal och relevant handlargodkännande.</p><a href="#kontakt" className="text-link">Prata med oss om ditt behov <ArrowUpRight size={18}/></a></div><div className="finance-products"><div><span className="number">01 / För kunden</span><h3>Köpfinansiering</h3><p>Registrera behovet för en kundaffär. Ansökan, kreditbeslut, kreditavtal och utbetalning hanteras genom finanspartnerns avtalade process efter anslutning.</p></div><div><span className="number">02 / För handlaren</span><h3>Lagerfinansiering</h3><p>Beskriv finansbehovet för företagets lager. Kreditutrymme, finansierade bilar och lösen följer partnerns villkor och produktgodkännande.</p></div><p className="finance-disclosure"><span className="status-dot"/>Anslutning och godkännande gäller per handlare, partner och produkt. Finanspartnern beslutar om kredit; en registrerad förfrågan är inget kreditbeslut.</p></div></div></section>
      <section id="natverket" className="network-section wrap"><div className="network-paper"><div className="paper-top"><span>INKÖPSÖNSKEMÅL</span><span className="badge">Exempel</span></div><h3>Vi söker nästa<br/>bil till vårt lager.</h3><dl><div><dt>Modell</dt><dd>Volvo V60</dd></div><div><dt>Årsmodell</dt><dd>2021 eller senare</dd></div><div><dt>Miltal</dt><dd>Upp till 8 000 mil</dd></div><div><dt>Område</dt><dd>Södra Sverige</dd></div></dl><div className="paper-bottom"><span>Dela med handlarnätverket</span><ArrowUpRight size={20}/></div></div><div className="network-copy"><p className="eyebrow">Affärer mellan handlare</p><h2>Hitta nästa bil.<br/>Hitta nästa köpare.</h2><p>Handlarnätverket är till för utvalda lagerbilar och inköpsönskemål mellan anslutna handlare. Publicering och åtkomst följer företagets anslutningsavtal.</p><ul className="check-list"><li><Check size={17}/>Du bestämmer vilka biluppgifter som får delas.</li><li><Check size={17}/>Interna priser och kunduppgifter hålls privata.</li><li><Check size={17}/>Bil och inköpsbehov är grunden för kontakten.</li></ul><p className="muted small">Kontakta oss om nätverksanslutning och publicering.</p></div></section>
      <section id="kontakt" className="contact-section wrap"><div className="contact-copy"><p className="eyebrow">Trafexa för din verksamhet</p><h2>Samla din<br/>bilaffär.</h2><p>Boka en genomgång av lager, kunder, offerter och företagets arbetsyta. Berätta om din verksamhet så går vi igenom rätt upplägg för ditt team.</p><a className="contact-email" href="mailto:info@trafexa.com">info@trafexa.com <ArrowUpRight size={17}/></a><span className="contact-footer">För små och medelstora bilhandlare i Sverige.</span></div><PilotForm/></section>
    </main><PublicFooter/>
  </div>;
}

function ProductPreview() {
  const cars = [
    ['Volvo V60', 'B4 · 2022 · 4 820 mil', '289 000', 'Tillgänglig'],
    ['BMW 320d', 'Touring · 2021 · 6 140 mil', '269 000', 'Reserverad'],
  ];
  return <div className="product-preview" role="img" aria-label="Illustration av Trafexas arbetsyta med två exempelbilar, fordonskalkyl och kunduppföljning. Utforska den interaktiva demon via knappen Utforska systemet.">
    <div className="preview-header"><span className="preview-wordmark">trafexa<span>.</span></span><span className="preview-example">Exempelvy</span></div>
    <div className="preview-body">
      <div className="preview-title"><div><span className="eyebrow">Överblick över din verksamhet</span><h2>Din arbetsyta</h2></div><span className="preview-workspace-label">Lager · CRM · Affärer</span></div>
      <div className="preview-section-title"><CarFront size={16} aria-hidden="true"/><strong>Fordonslager</strong><span>2 exempelbilar</span></div>
      <div className="preview-table"><div className="preview-table-head"><span>FORDON</span><span>PRIS, KR</span><span>STATUS</span></div>{cars.map(([name,detail,price,status],index) => <div className="preview-car" key={name}><div><span className={`car-token car-token-${index}`}><CarSilhouette/></span><div><strong>{name}</strong><small>{detail}</small></div></div><span>{price}</span><span className={`badge ${status === 'Tillgänglig' ? 'badge-green' : 'badge-amber'}`}>{status}</span></div>)}</div>
      <div className="preview-workflow">
        <div className="preview-insight"><div><Calculator size={16} aria-hidden="true"/><strong>Fordonskalkyl</strong></div><p>Volvo V60 · VMB</p><dl><div><dt>Försäljningspris</dt><dd>289 000 kr</dd></div><div><dt>Inköpspris</dt><dd>250 000 kr</dd></div><div><dt>Direkta kostnader</dt><dd>5 000 kr</dd></div><div className="preview-result"><dt>Resultat efter moms</dt><dd>26 200 kr</dd></div></dl><span className="preview-insight-note">Exempel med bekräftad momsmodell och kostnadsunderlag.</span></div>
        <div className="preview-insight preview-followup"><div><Users size={16} aria-hidden="true"/><strong>Kunduppföljning</strong></div><p>Håll nästa steg samlat.</p><div className="preview-task"><span className="preview-task-dot"/><div><strong>Följ upp provkörningen</strong><span>Exempelkund · Volvo V60</span></div></div><div className="preview-task"><span className="preview-task-dot"/><div><strong>Ta fram offert</strong><span>Pris, giltighet och villkor</span></div></div></div>
      </div>
      <div className="preview-bottom"><Check size={15} aria-hidden="true"/><span>Företagets uppgifter samlade. Åtkomst efter roll.</span></div>
    </div>
  </div>;
}

function CarSilhouette() { return <svg viewBox="0 0 100 45" width="60" height="30" aria-hidden="true"><path d="M12 29 15 21 33 17 43 8h25l15 13 8 3v10H8v-5h4Z" fill="currentColor" opacity=".25"/><path d="m37 18 9-7h18l9 9-36-2Z" fill="currentColor" opacity=".35"/><circle cx="26" cy="33" r="7" fill="currentColor"/><circle cx="77" cy="33" r="7" fill="currentColor"/><circle cx="26" cy="33" r="3" fill="#e8e9e4"/><circle cx="77" cy="33" r="3" fill="#e8e9e4"/></svg>; }

export function PublicFooter() { return <footer className="public-footer wrap"><div><Brand/><p>Trafexa Nordic AB · 556855-4884</p></div><div className="footer-links"><Link href="/privacy">Integritet</Link><Link href="/cookies">Cookies</Link><CookieSettingsButton/><Link href="/terms">Om tjänsten</Link><a href="mailto:info@trafexa.com">Kontakt <ArrowUpRight size={14}/></a></div><p className="footer-year">© {new Date().getFullYear()} Trafexa</p></footer>; }
