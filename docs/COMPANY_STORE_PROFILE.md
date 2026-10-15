# Företags- och butiksprofil

## Leveransgräns

Etappen utgår från publicerad main `5e694c581e70e1dfb452665a0c85d1f8b8c37312`/PR #26. Profil, API och privata kanalunderlag är implementerade. Efter sammanfogning med ekonomietappen passerar 880/880 appfall utan fel eller överhoppade fall samt slutligt produktionsbygge med TypeScript och färska hostedtyper. Detta är en testad kodcheckpoint före publicering; PR-/main- och deploymentbevis återläses separat. Exakta resultat och täckningsgränser finns i [IMPLEMENTATION_STATUS](IMPLEMENTATION_STATUS.md).

Handlaren kan registrera ett företag med en komplett butiksprofil och komplettera ett befintligt företags profil under Företag & inställningar. Ett företag har en butiksprofil; filialer och flera butiker per företag är separata senare flöden. Profilen publiceras inte automatiskt. Samma organisationsnummer hos olika befintliga företag medför ingen automatisk sammanslagning eller överföring av åtkomst.

Kontoregistrering, verifierad Auth-adress och Trafexas kontogodkännande behåller sina befintliga gränser. En butiksprofil ger inte systemgodkännande, superadminroll eller åtkomst till ett externt annonskonto. Endast aktuell godkänd ägare eller administratör får läsa och ändra den privata profilen och dess kanalunderlag, även vid direkta API-/RPC-anrop. Finans-, sälj- och läsroller får inte denna nya privata API-åtkomst.

## Företagets identitet och profilversioner

För ett nytt företag granskas juridiskt namn, svenskt organisationsnummer och hela profilen före bekräftelse. Företag, aktivt ägarmedlemskap och första profilversion sparas i samma transaktion. Den aktiva företagskakan sätts först efter verifierat kvitto; ett misslyckat eller okänt svar får inte välja ett obekräftat företag.

Organisationsnumrets format och Luhn-kontroll är lokal validering, inte verifiering mot Bolagsverket eller bevis på firmateckningsrätt. Äldre företag med ogiltigt organisationsnummer kan läsa och spara sina kontakt-/butiksuppgifter, men granskade kanalexportunderlag blockeras. Befintlig juridisk identitet korrigeras inte genom profilformuläret.

Juridiskt namn och organisationsnummer hämtas från den låsta företagsraden vid sparande och export. Klientskickade kopior är aldrig identitetskälla. Butiksfältet `displayName` är skilt från företagets juridiska namn. Profilen innehåller adress, postnummer, ort, landet `SE`, offentlig mejladress och telefon samt valfria fält för extra adressrad, webbplats, logotyplänk, presentation och öppettider. URL-fält är uppgifter i profilen; sparande innebär ingen hämtning, bildöverföring eller publicering av deras innehåll.

Webbplats och logotyplänk är frivilliga. Version 1 accepterar endast HTTPS med vanliga ASCII-DNS-värdnamn; internationaliserade domännamn och punycodeetiketter (`xn--`) avvisas i både TypeScript och SQL. Begränsningen håller direkta RPC-skrivningar förenliga med serverns URL-läsning: en ofullständigt validerad punycodeetikett får inte sparas och sedan göra profilen oläsbar. Full UTS #46-/IDN-validering är en separat framtida förbättring. Övriga profilfält stöder Unicode, inom sina validerade längd- och teckengränser.

Varje sparande skapar en oföränderlig `CompanyStoreProfile` med `id`, `companyId`, `version`, `fields`, `createdAt` och minimerad aktörsetikett. Ändringar jämför `expectedVersion`; identiska aktörsbundna `requestId` kan återförsökas utan en ny profilversion. Aktuell behörighet krävs också för att återläsa ett historiskt kvitto.

Den frysta källan `CompanyStoreSourceSnapshot` har `schemaVersion: 1`, företagets ID, profilens ID/version, `legalName`, `organisationNumber` och `shop`. Kanonisk källtext och SHA-256 binder det granskade underlaget till exakt företagsidentitet och profilversion.

## Förberett kanalunderlag

Ägare/admin kan granska ett underlag för `blocket` eller `wayke` med ändamålet `new_store` respektive `existing_store`. Granskningen binder kanal, ändamål, profilversion, `expectedSourceSha256`, uttrycklig bekräftelse, attestationsversion `2026-10-15` och en aktörsbunden begäransreferens. En ändrad källa kräver ny granskning; den får inte tyst ersätta det bekräftade innehållet.

Resultatet är ett privat Trafexa-JSON-underlag med status **`prepared`**. Det sparar den oföränderliga källkopian och kontrollerbara kanoniska bytes med `sourceSha256` och `exportSha256`. Nedladdningen återger den sparade versionen, inte en ombyggd kopia från aktuell profil. Det är ett Trafexa-format för förberedelse, inte ett påstått Blocket-/Wayke-schema, en överföring, ett leverantörskvitto eller en skapad butik.

JSON-dokumentets yttre fält är `schemaVersion: 1`, `kind: "trafexa_store_profile"`, `channel`, `purpose` och `profile`, där `profile` är den frysta `CompanyStoreSourceSnapshot`. Kanonisk text skapas av databasen med `jsonb::text`; en klients `JSON.stringify` av samma objekt är inte samma byteföljd och ska inte användas för att återskapa kontrollsumman. Exportöversikten visar högst de 20 senaste underlagen; ett exakt export-ID kan hämtas separat med aktuell behörighet.

Ny extern butiksprovisionering är uttryckligen blockerad eftersom dokumenterat skapandekontrakt och beviljad åtkomst saknas. Ingen profil skickas till partner, inga credentials efterfrågas och ingen worker eller provider aktiveras. Granskningsbekräftelsen registrerar vilket underlag som har förberetts; den bevisar inte att uppgifterna har lämnats ut.

## Privat HTTP-API

API:t använder handlarens vanliga autentiserade Supabase-/appsession och samma aktuella konto-, företags- och rollkontroller som serveråtgärderna. Det är inte ett partner-API och ger ingen API-nyckel till en annonsör.

| Metod och sökväg | Funktion |
|---|---|
| `POST /api/dealer-companies` | Skapa nytt företag, ägarmedlemskap och komplett första profil atomiskt. |
| `GET /api/company-store-profile?companyId=uuid` | Läs företagets profil, källidentitet och förberedda underlag. |
| `PUT /api/company-store-profile` | Spara en granskad ny profilversion för företaget. |
| `POST /api/company-store-profile/exports` | Förbered och spara exakt granskat kanalunderlag. |
| `GET /api/company-store-profile/exports/[exportId]?companyId=uuid` | Hämta den sparade privata JSON-versionen med hashkontroll. |

Mutationer kräver session, verifierad tillåten origin och strikt JSON-validering. Begäransgränsen är 65 536 byte (64 KiB), även för strömmad body utan `Content-Length`; felaktig UTF-8 eller JSON avvisas. Företags-/export-ID och aktuella behörigheter kontrolleras på servern. Privata svar och nedladdningar använder `Cache-Control: private, no-store, max-age=0` och `Referrer-Policy: no-referrer` och får inte läggas i en publik cache. Prefixspecifika Next-konfigurationsregler ska bevara referrerpolicyn för `/api/dealer-companies` och `/api/company-store-profile` inklusive exportvägar; en global sidregel får inte skriva över den. Exporten har MIME `application/json; charset=utf-8`, privat bilagefilnamn och `X-Trafexa-Content-SHA256` för exakt sparade UTF-8-bytes; ETag återger samma hash utan att aktivera cache. Fel ska inte röja andra företags innehåll, råa databasfel eller hemligheter.

## Databas och verifieringsgräns

Migration `20261015113334_company_store_profile` är applicerad och återläst. Den granskade SQL-filens SHA-256 är `ff70c512deb51f09d7cafdeab4720bf733eed3614d2c3fff4225e7bef6900d4f`. Privata `company_store_profile_versions`, `company_store_exports` och `company_store_requests` är oföränderliga; `company_store_profile_heads` pekar på aktuell version. Offentliga RPC-wrapper är `create_company_with_profile`, `get_company_store_profile`, `save_company_store_profile`, `prepare_company_store_export` och `get_company_store_export`.

Verifierad Auth, kontogodkännande, aktivt företag och aktuellt ägare-/administratörsmedlemskap kontrolleras före historiskt återförsök och före CAS-/identitetskontroller. Ett historiskt kvitto bevarar det gamla resultatet och kräver aktuell behörighet; det ersätter inte en färsk profilläsning. Profilsparande jämför head-version och exportförberedelse jämför den granskade källhashen under lås.

Slutlig native PostgreSQL 17.6 mot den sammanfogade migrationskedjan passerar 15/15 fall, inklusive fem verkliga tvåsessionsrace. De 92 lokala migrationsfilerna omfattar 90 hosted-applicerade samt två äldre pending prototypfiler i den lokala testkedjan; de två har inte applicerats hosted av denna etapp. Testcontainern är städad och inga testsessioner återstår. Separat faktiskt route → action/context → SQL-korslager efter sammanfogningen passerar 5/5; SDK-gränsen är adapterad och provet ersätter inte hosted Auth/PostgREST eller browsercookies. Server-/domänfall och Chromiumfall ingår i den samlade appsviten och ska inte adderas till totalsumman 880. Hosted rollback avslutades utan assertionsexception; kontrollerade användare, företag inklusive skapare, profilversioner, exporter och begäransrader var noll efteråt.

Elva faktiska Next-produktions-HTTP-kontroller efter sammanfogningen passerar lokalt med syntetisk publik konfiguration och utan Auth-session: de fem API-operationernas 401-JSON, felaktiga query-/origin-/MIME-/metod-/storleksanrop samt privata headers och `no-referrer`. Detta är en lokal HTTP-gränskontroll och verifierar inte inloggad produktions-CRUD, SMTP eller butiksskapande hos en partner.

## Officiella kanalgränser, kontrollerade 15 oktober 2026

Blocket anger att handlaruppgifter, inklusive adress, presentation och logotyper, hanteras i Blocket Admin; Import API gäller annonser. Inget offentligt kontrakt för att skapa butik eller handlarkonto har verifierats. [Blockets instruktion för butiksuppgifter](https://blocket.zendesk.com/hc/sv/articles/30657906956946-G%C3%B6r-er-digitala-butik-redo-f%C3%B6r-nya-Blocket).

[Blockets Pro Import API](https://api.blocket.se/pro-import-api/docs/client-documentation) använder en supporttilldelad JWT i `X-Auth-Token` och befintlig `dealer_code`/handlargrupp. Dokumentationen rekommenderar nu V5 för nya bilintegrationer. Trafexas befintliga V4-annonsprototyp är fortsatt inaktiv och saknar den beständiga CREATE/UPDATE-/leveranskorrelation som krävs före aktivering. Profilunderlaget ändrar inte detta.

[Waykes officiella API](https://api.wayke.se/) kräver av Wayke aktiverad systemklient/OAuth2 för skrivning. Organisationsavsnittet visar läsande sökning; [DMS-guiden](https://github.com/wayke-se/Documentation/blob/master/DMS/DMS%20Integrations.md) beskriver fordonsimport och uppdatering till befintliga filialer. Inget offentligt verifierat kontrakt för att skapa handlarorganisation, butik eller filial ingår i dessa underlag.

Detta utesluter inte ett separat privat partnerkontrakt. Extern anslutning kräver dokumenterad endpoint, payloadschema, företags-/filialscope, serverkonfiguration, idempotens, statusmodell och verifierbar läsback. Dessa delar får inte gissas från annons- eller sök-API:er. Se [ADVERTISING_INTEGRATIONS](ADVERTISING_INTEGRATIONS.md).
