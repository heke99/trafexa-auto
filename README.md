# Trafexa Dealer

Trafexa är ett arbetsverktyg för bilhandlare med fordonslager, kunder, affärer och dokument. Den publika webbplatsen hör hemma på `trafexa.com`; handlarappen på `app.trafexa.com`. Projektet använder Next.js App Router, React, TypeScript och Supabase för autentisering, Postgres och privata dokument.

## Återhämtning och uppdrag

Denna bygggrund har återhämtats från det tidigare arbetet och fortsätter på `codex/trafexa-dealer-continuation-20261013`. Fortsättningen har lagt till finansåtkomst, företagskontext, reservationsutgång, CSV-import, fordonskostnader, CRM-intag, offertversion/PDF och ett avstängt signeringsbibliotek. Typkontroll, 99 Node-beteendetester, nio filsviter via `npm test`, sju SQL-regressioner och produktionsbygge har passerat. Lokal produktion passerar 31 browserkontroller; samlad utvecklings-/mock-/produktions-QA är 182/182. UI-harness använder mockade serveråtgärder, och autentiserad CRUD genom produktionsgränssnittet är ännu inte verifierad. [Draft-PR #4](https://github.com/heke99/trafexa-auto/pull/4) har en verifierad [Vercelpreview](https://trafexa-auto-304mxzp8h-div3rsa.vercel.app) med status `READY`; `main` och produktion är ännu inte ersatta av denna preview. Exakta kommandon, resultat och begränsningar finns i [IMPLEMENTATION_STATUS](docs/IMPLEMENTATION_STATUS.md).

Previewn gäller commit `cf953d4078c047efefe3da1674a989ad571eea52`, tree `a204d647a4d81fa5d6f26f67c57165afa3ac1d0c` och deployment `dpl_GveGscnZV3szkXC3xwgYKJNbtkst` i rätt projekt/team, region `arn1`. Byggloggar bekräftar `npm ci` med 73 installerade paket på sex sekunder, följt av `npm run build` och `READY`. Skyddad fetch bekräftar HTTP 200 för lagerdemo, kunddemo/CRM och inloggning. Den verifierar inte autentiserad remote-CRUD eller PDF-hämtning: PDF-anropet rapporterade 401 men åtkomstverktyget klassade svaret som deploymentautentisering och lämnade inte ut body.

Denna dokumentuppdatering och låsningen till Node.js `24.x` i `package.json`/lockfilen ska ingå i nästa commit/preview. De ingår inte i ovanstående verifierade deployment; nästa deployment är ännu inte bekräftad `READY`.

Användaren godkände att den gamla webbplatsen skulle ersättas och att handlarappen skulle byggas i befintliga Trafexa Auto-resurser. Originalkällan är chatten `01a13504-1d80-7611-92e8-9076ccf7605d`, användarturn `01a13554-497f-7729-abd7-e91341e8105c`: ”du kan även radera hela hemsidan vi har idag på trafexa och börja om på nytt” och ”ta bort all kod i trafexa auto och börja bygg där”. Samma uppdrag angav Supabase-projektet Trafexa Dealer och önskade ett genomarbetat gränssnitt. Användaren angav senare att `app.trafexa.com` finns hos Strato och bad om parallellt agentarbete. Fortsättningen omfattar repository och publicering i det befintliga projektet; externa finans- och signeringstjänster behöver fortfarande sina faktiska integrationsunderlag.

| Resurs | Referens |
|---|---|
| GitHub | [heke99/trafexa-auto](https://github.com/heke99/trafexa-auto) |
| Vercel-projekt | `prj_zWks8Qd6m9ijWdu3tzid9RJlGgGE` |
| Vercel-team | `team_e3htkJPyBNSw3Ix1KQLlf180` |
| Supabase | Trafexa Dealer, `buqdtssxrotkzndublrt`, Stockholm / `eu-north-1` |
| Publik domän | `trafexa.com` och `www.trafexa.com`; verifierade i Vercel |
| Handlardomän | `app.trafexa.com`; verifierad i Vercel, faktiskt appflöde kontrolleras vid publicering |

## Köra lokalt

Använd Node.js `24.x` och projektets låsta beroenden. Den lokala verifieringsmaskinen kör `24.19.0`. Majorversionen är låst i `package.json` och lockfilen för att undvika en framtida automatisk majoruppgradering på Vercel:

```bash
npm ci
cp .env.example .env.local
npm run dev
```

Konfigurera de publika miljövariablerna för avsedd utvecklingsmiljö. Värden dokumenteras inte här.

| Variabel | Användning |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase-projektets publika URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Publik klientnyckel; åtkomsten styrs även av databasbehörigheter och RLS |
| `NEXT_PUBLIC_SITE_URL` | Ursprung för den publika webbplatsen och demoformulärets tillåtna ursprung |
| `NEXT_PUBLIC_APP_URL` | Ursprung för handlarappens inloggningsbekräftelse och lösenordsåterställning |

`/demo` använder tydligt fiktiva exempel och tillåter inte produktionsåtgärder. Ett riktigt företagsflöde kräver Supabase-konfiguration, verifierad autentisering och ett aktivt företagsmedlemskap.

## Kontroller

```bash
npm run typecheck
npm test
npm run build
```

`npm test` kör återställda och utökade Node-tester från `tests/*.test.mjs`, för routing, validering, demo-API, lagerimport, offert-PDF, företagskontext, CRM-åtgärder och DocuSeals transport-/domänbibliotek. Signeringsleverantören mockas. Se statusdokumentet för faktiska resultat för den aktuella kodversionen. En lyckad byggning bevisar inte att registrering, företagsisolering, reservationer eller domänflöden fungerar i den avsedda driftsmiljön.

SQL-regressionerna i `supabase/tests/` täcker företagsisolering, privat lagring/intag, finansåtkomst, reservationsutgång, lagerimport, offertversioner och CRM-intag/status. De använder syntetiska fixtures inom transaktioner med rollback och ska köras mot en avsedd testdatabas med rätt migrationsadministration. Lokala migrationsnamn stäms av mot faktiskt applicerade liveversioner; kontrollera historiken innan någon ny migration appliceras. Ett utkast eller återhämtat kommando är inte bevis på en applicerad migration.

## Kod och produktgränser

| Del | Plats |
|---|---|
| Publik webbplats och demo | `src/components/public-site.tsx`, `src/app/demo/page.tsx` |
| Handlargränssnitt | `src/components/dealer-workspace.tsx`, `src/app/(dealer)/[section]/page.tsx` |
| Företagskontext, data och serveråtgärder | `src/lib/data/` |
| CSV-import och förhandsgranskning | `src/components/stock-import.tsx`, `src/lib/data/import-actions.ts`, `src/lib/data/stock-import.mjs` |
| Kundförfrågningar/CRM | `src/components/customer-leads.tsx`, `src/lib/data/lead-actions.ts` |
| Offertversioner och PDF | `src/components/deal-offers.tsx`, `src/lib/data/offer-actions.ts`, `src/lib/documents/offer-pdf.ts`, `src/app/api/offers/[offerId]/pdf/route.ts` |
| Avstängt signeringsbibliotek | `src/lib/signing/`; appimport via `src/lib/signing/server.ts` |
| Supabase-klienter och databastyper | `src/lib/supabase/` |
| Domänrouting, sessionsförnyelse och åtkomst | `src/lib/routing.mjs`, `src/proxy.ts` |
| Demo-/pilotförfrågningar | `src/app/api/demo-requests/route.ts` |
| Databasschema, RLS, RPC och lagring | `supabase/migrations/` |

Återhämtad kod innehåller registrering, inloggning, återställning av lösenord, skapande och växling av företag, manuellt lager, kundkort, affärsutkast, 48-timmars reservation och intern finansintresseanmälan. Finansintresseanmälan sparas i Trafexa och skickas inte till en bank. Den nya åtkomstmodellen ger ägare, administratör och finansansvarig företagets finansintag; en säljare ser sitt eget intag. Dokumentmetadata och den privata dokumentbucketen begränsas till ägare, administratör och finansansvarig.

Företagskontexten hämtar verifierad användare och aktuella aktiva medlemskap i aktiva företag. Ett gammalt eller ogiltigt företagsval väljer inte tyst ett annat företag; användaren får välja bland sina tillgängliga företag. Samma kontext används av arbetsytans data och serveråtgärder.

Kundsektionens förfrågningar laddas först när panelen öppnas, med 50 poster per sida och företagskontrollerad sidmarkör. Kontakt och lead skapas tillsammans; e-post eller telefon krävs. Ägare, administratör och säljare kan skapa och ändra status; finans- och läsroller har läsåtkomst inom företaget. Status sparas endast om tidigare status fortfarande matchar. Oförändrat underlag och samma UUID kan återförsökas inom sju dagar, med högst 1000 intagskvitton per företag. Fält och begäransreferens behålls vid fel; inga externa meddelanden skickas av CRM-intaget.

CSV-import har kolumnmappning, radfel, serverkontrollerade dubbletter och transaktionell import med stabil begäransreferens. Gränserna är 1 MiB och 500 fordon per fil. Fordonskostnader kan registreras och visas tillsammans med lagerposten. Momsmodell och kostnadssammanställning utgör inte fullständig bokföring eller VMB-beräkning.

Offertflödet sparar oföränderliga versioner av företag, kund, bil, pris, villkor och giltighet. Säljaren måste uttryckligen bekräfta prisgrund som totalpris inklusive eventuell moms. Samma begäransreferens och underlag kan återförsökas utan ny version. Historiken hämtas vid behov med sidindelning; en autentiserad användare i rätt företag kan hämta en PDF från det sparade underlaget. Offertversionen skickas inte automatiskt till kund eller partner och är inget signerat köpeavtal. Mallbyggare, kundaccept, signering och bevisarkiv återstår. Handlarnätverket är ännu inte öppet för publicering. Bokföring, leverans, kreditlimit och lagerlösen är kommande faser.

DocuSeal-transport och signeringsmodell har integrerats som avstängda serverbyggdelar från PR #3, med mockade tester. Applikationswrappern tvingar skapande till `enabled: false`; inga providercredentials, routes, webhookmottagare, utskick eller beständigt signeringsflöde är kopplade. [DOCUSEAL_INTEGRATION](docs/DOCUSEAL_INTEGRATION.md) beskriver ursprung och de återstående stegen. Sourcingmodellen från PR #2 har inte kopierats: appens befintliga `companies` och `memberships` är fortsatt organisationsmodell.

Reservationsutgång hanteras atomiskt när ny affär skapas eller en bil reserveras; det gamla affärsutkastet och lagerposten frigörs med bevarad historik. Ingen schemalagd bakgrundskörning är aktiv. Förslaget [reservation_expiry_schedule.sql](docs/proposals/reservation_expiry_schedule.sql) ligger utanför migrationskatalogen: automatisk godkännandegranskning avvisade installation av permanent `pg_cron` och minutvisa produktionsmutationer. Separat godkännandefråga är fortfarande obesvarad och förslaget är inte applicerat; utgången reservation kan därför ligga kvar i liststatus fram till nästa relevant lageroperation.

`vercel.json` använder Next.js och region `arn1`. Domänrouting skiljer publik webb från handlarapp; appdomänens rot leder mot `/dashboard`, och skyddade sidor kräver session och företagskontext. Appen ersätter den tidigare statiska webbplatsen som ett sammanhängande Next.js-projekt. Publicering måste verifiera både den publika sidan och handlarappen.

Fortsatt byggordning, beroenden och leveranskrav finns i [MASTERPLAN](docs/MASTERPLAN.md). Där anges vilka delar som återhämtats från originalplanen och vilka som rekonstruerats från fragment och kod.
