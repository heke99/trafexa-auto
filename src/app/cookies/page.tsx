import type { Metadata } from 'next';
import { Brand } from '@/components/brand';
import { PublicFooter } from '@/components/public-site';
import { CookieSettingsButton } from '@/components/cookie-consent';
export const metadata: Metadata = { title: 'Cookiepolicy' };
export default function CookiesPage() {
  return <><header className="public-header wrap"><Brand/></header><main className="legal-content wrap"><a className="text-link" href="/">← Till startsidan</a><p className="eyebrow">Uppdaterad 14 oktober 2026</p><h1>Cookiepolicy.</h1>
    <p>Cookies är små uppgifter som sparas i din webbläsare. Trafexa använder endast nödvändiga cookies. Vi använder inga analysverktyg, annonspixlar eller cookies för marknadsföring på webbplatsen.</p>
    <h2>Cookies som används</h2><div className="cookie-table-scroll"><table className="cookie-table"><thead><tr><th scope="col">Namn</th><th scope="col">Ändamål</th><th scope="col">Lagring</th></tr></thead><tbody>
      <tr><td>sb-…-auth-token (kan delas i flera delar)</td><td>Supabase-inloggning: håller din session aktiv och förnyar den. Används när du loggar in eller använder kontofunktioner.</td><td>Förnyas under aktiv session. Upp till 400 dagar enligt autentiseringsbibliotekets cookieinställning; avslutas eller uppdateras när du loggar ut.</td></tr>
      <tr><td>sb-…-auth-token-code-verifier</td><td>Säker verifiering av inloggningsflöden, till exempel länken för nytt lösenord.</td><td>Tillfälligt under autentiseringsflödet; tas bort när flödet slutförs. Kan som längst följa autentiseringsbibliotekets 400-dagarsinställning.</td></tr>
      <tr><td>trafexa-company</td><td>Väljer arbetsyta bland de företag du redan har behörighet till. Cookien ger ingen behörighet.</td><td>Sessionscookie utan fast utgångstid; tas bort vid utloggning. Webbläsarens sessionsåterställning kan bevara den.</td></tr>
      <tr><td>trafexa-cookie-notice</td><td>Kommer ihåg att du har läst cookieinformationen och vilken version du såg. Innehåller inga kontaktuppgifter.</td><td>180 dagar från din bekräftelse.</td></tr>
    </tbody></table></div>
    <p>Cookies sätts för den webbplats där du använder funktionen. Inloggningscookies hanteras av Trafexa med autentisering från Supabase. Cookien för cookieinformationen skickas inte till en analystjänst.</p>
    <h2>Dina val</h2><p>Nödvändiga cookies behöver inget samtycke enligt reglerna om elektronisk kommunikation. Knappen ”Jag förstår” bekräftar att du har läst informationen; den ger inget samtycke till statistik, reklam eller annan personuppgiftsbehandling. Du kan använda ansökningsformuläret utan att trycka på knappen.</p>
    <p><CookieSettingsButton/> låter dig öppna informationen igen och glömma bekräftelsen. Du kan även radera eller blockera cookies i webbläsarens inställningar. Om inloggningscookies blockeras kan du inte använda den inloggade tjänsten som vanligt.</p>
    <h2>Mer information och kontakt</h2><p>Läs <a href="/privacy">integritetspolicyn</a> om behandling av personuppgifter. Frågor: <a href="mailto:info@trafexa.com">info@trafexa.com</a>.</p><p>Se även <a href="https://www.pts.se/internet-och-telefoni/kakor-cookies/">Post- och telestyrelsens information om cookies</a>.</p>
  </main><PublicFooter/></>;
}
