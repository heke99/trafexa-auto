# Trafexa Dealer

Trafexa är ett arbetsverktyg för bilhandlare med fordonslager, kunder, affärer och dokument. Den publika webbplatsen finns på `www.trafexa.com`, med omdirigering från `trafexa.com`; handlarappen finns på `app.trafexa.com`. Projektet använder Next.js App Router, React, TypeScript och Supabase för autentisering, Postgres och privata dokument.

## Personal och plattformsadministration

Företagets ägare och administratörer hanterar personal, adressbundna inbjudningar och granskade roll-/statusändringar i Inställningar. Mottagare granskar och accepterar sina inbjudningar på `/invitations`, även utan ett befintligt företagsmedlemskap. Delningslänken är generisk och inga inbjudningsmejl skickas automatiskt. [Personalflödet](docs/COMPANY_TEAM.md) beskriver rollgränser, sju dagars giltighet och återförsök.

Trafexas separata plattformsadministration finns på `/admin`. Kontaktadressen är `info@trafexa.com`; den användargodkända superadminadressen är `hekmat.h@trafexa.com`. Företagsroller ger ingen plattformsåtkomst. [Adminflödet](docs/PLATFORM_ADMIN.md) beskriver verifierad aktivering och privat UUID-lista.

PR #6 är verifierad på main `4711726afe1591e50a1e0b9551be0c55eb25db5c` och produktion `dpl_8dZBvac1KYRqhpZGAadyr2cnfNzG` (`READY`, `arn1`, rätt app/www/apex-alias). Den aktuella personalleveransens lokala 210 apptester, 13 databastestgrupper och produktionsbygge passerar. Hosted Supabase har tio migrationer inklusive `20261013184149_platform_admin` och `20261013192237_company_team`; live rollbacktest för teamets behörigheter och återförsök passerar utan kvarvarande testdata. De äldre signerings-/arkivmigrationerna är fortsatt pending. Ny publicering får ett separat verifierat PR-/deploymentbevis.

## Återhämtning och uppdrag

Denna bygggrund har återhämtats från det tidigare arbetet och integrerats i `main` genom [PR #4](https://github.com/heke99/trafexa-auto/pull/4), från `codex/trafexa-dealer-continuation-20261013`. Fortsättningen har lagt till finansåtkomst, företagskontext, reservationsutgång, CSV-import, fordonskostnader, CRM-intag, offertversion/PDF och ett avstängt signeringsbibliotek. PR #4:s 107 beteenden, elva filsviter, sju live-SQL-regressioner och PDF-fonttrace är historiska resultat. Därefter mergades PR #5 med privat offertarkiv och beständig signeringsgrund; den historiska main-checkpointen `7fc833f` har färsk rootverifiering 137/137 och produktionsbygge PASS. Tidigare lokal produktionsbrowser passerade 31 kontroller och samlad utvecklings-/mock-/produktions-QA 182/182; dessa är historiska resultat och har inte räknats om efter slutfixarna. UI-harness använder mockade serveråtgärder; autentiserad CRUD genom produktionsgränssnittet är ännu inte verifierad. [PR #4](https://github.com/heke99/trafexa-auto/pull/4) är faktiskt mergad till `main`; historisk produktionscheckpoint `db7143` är verifierad `READY` och har följts av PR #5/main `7fc833f` enligt nedan. Exakta kommandon, resultat och begränsningar finns i [IMPLEMENTATION_STATUS](docs/IMPLEMENTATION_STATUS.md).

Historiskt verifierad PR #4/main-checkpoint är `db7143cd633a2cee07457295fac8a75132e7352d`, tree `c12c75a8ce303aa7c26428334ad40dc7f00fe3b1`, identisk med den testade implementationen `403776131d3680e6f42aee566627fc2f9ab7f976`. Mergen följer användarens instruktion ”fortsätt då och lägg in det på main”. Produktionsdeployment `dpl_8Z69TvzBVQVeVeKDwrUfAYjJUzWY` är verifierad `READY`, target `production`, i rätt projekt och `arn1`: [deployment](https://trafexa-auto-6uva9o390-div3rsa.vercel.app). [www.trafexa.com](https://www.trafexa.com/) och [app.trafexa.com/login](https://app.trafexa.com/login) gav 200 med rätt deployment-ID; `trafexa.com` gav 308 till `https://www.trafexa.com/`. Full auth/remote CRUD är ännu inte verifierad och inga verkliga authmejl skickades. Nedanstående previews bevaras som historiska bevis för sina respektive commits.

Historisk main-checkpoint efter [PR #5](https://github.com/heke99/trafexa-auto/pull/5) är `7fc833f643a488b8af34bb950df22769e99be32b`, tree `89d9774a25c13f3197c5b9d09668baa05dbbe50f`. Produktion `dpl_6vcexX8f1Jw5mWPyYLzpFSd6g1sS` är `READY`, target `production`, rätt projekt/`arn1` och alias app/www/apex: [deployment](https://trafexa-auto-h8cvlrqe0-div3rsa.vercel.app). Native lagerdemo gav 200, ”Fordonslager” och exakt detta deployment-ID. Extern browseranslutning blockerades med CONNECT 403 före appkontroller: noll genomförda checks. Färsk rootkörning av denna main passerar 137/137 beteenden och produktionsbygge inklusive TypeScript, 14 sidor och ny dokument-PDF-route. Fonttrace PASS omfattar offert-PDF, demo- och dealer-page samt nya archive-actionens användning. Sex lokala Chromium-harnessfall ingår i totalsviten och är inte extern produktionsbrowser.

Vid PR #5 bekräftade livekontrollen åtta applicerade migrationer. PR #5:s två nya lokala migrationer är inte hosted-applicerade och servicekey för ny arkivregistrering saknas. Signeringsprovider och workerdispatch förblir tvingat `enabled:false`; hosted arkivering/signering är inte aktiverad. PR #5:s egna integrationsunderlag och verifieringar bevaras separat och testsummorna adderas inte som unika fall.

Första historiska checkpointen är commit `cf953d4078c047efefe3da1674a989ad571eea52`, deployment `dpl_GveGscnZV3szkXC3xwgYKJNbtkst`, [preview](https://trafexa-auto-304mxzp8h-div3rsa.vercel.app), `READY`. Byggloggen bekräftar `npm ci`, 73 paket på sex sekunder och därefter `npm run build`. Skyddad fetch gav 200 för lagerdemo, kunddemo/CRM och login. PDF-svaret klassades av åtkomstverktyget som deploymentautentisering, så autentiserad remote PDF-CRUD är inte verifierad.

Node.js `24.x`-låsningen är publicerad i den senare verifierade checkpointen `69ed849af1afe19c1c637f71940ec70384f1ce46`: deployment `dpl_EgM71HipZpPg2XVMzxefqFzt6vTx`, [preview](https://trafexa-auto-qv9b55c4h-div3rsa.vercel.app), `READY` i rätt projekt/team och `arn1`. Lager- och kunddemo gav 200 med förväntat gränssnitt. Efterföljande kodpushar följs via PR #4 och Vercels deploymentstatus; checkpointresultat gäller den angivna commiten.

Tredje historiskt verifierade checkpointen är `aed26dff099fc552687c29182d9a895da28ddd28`, deployment `dpl_62td1ULZfX4FVG8WxrepwNvUrerC`, [preview](https://trafexa-auto-cvhiuxi96-div3rsa.vercel.app), `READY`. Projekt, commit och `arn1` är avstämda; lager- och kunddemo gav 200 med deployment-ID. Den nya authfixen tillkom efter denna checkpoint och ingår inte i dess verifierade resultat.

De sista lokalt verifierade korrigeringarna visar exakta ören i lager/affärer och tillåter pilot-API:t från den specifika `VERCEL_BRANCH_URL`-originen. Andra Vercelhosts nekas fortfarande med 403. Två SSR-regressioner för belopp och en produktionsregression för ursprung ingår i de 107 beteendetesterna, tillsammans med fem mockade återställningsregressioner.

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

Lösenordsåterställning visar det villkorliga framgångsmeddelandet först efter ett SDK-svar utan fel. SDK-fel, klientinitialiseringsfel och nätverksfel ger samma generiska fel utan konto- eller providerdiagnostik. Fem isolerade regressioner använder mockad autentisering och skickar inga verkliga authmejl.

Företagskontexten hämtar verifierad användare och aktuella aktiva medlemskap i aktiva företag. Ett gammalt eller ogiltigt företagsval väljer inte tyst ett annat företag; användaren får välja bland sina tillgängliga företag. Samma kontext används av arbetsytans data och serveråtgärder.

Kundsektionens förfrågningar laddas först när panelen öppnas, med 50 poster per sida och företagskontrollerad sidmarkör. Kontakt och lead skapas tillsammans; e-post eller telefon krävs. Ägare, administratör och säljare kan skapa och ändra status; finans- och läsroller har läsåtkomst inom företaget. Status sparas endast om tidigare status fortfarande matchar. Oförändrat underlag och samma UUID kan återförsökas inom sju dagar, med högst 1000 intagskvitton per företag. Fält och begäransreferens behålls vid fel; inga externa meddelanden skickas av CRM-intaget.

CSV-import har kolumnmappning, radfel, serverkontrollerade dubbletter och transaktionell import med stabil begäransreferens. Gränserna är 1 MiB och 500 fordon per fil. Fordonskostnader kan registreras och visas tillsammans med lagerposten. Momsmodell och kostnadssammanställning utgör inte fullständig bokföring eller VMB-beräkning.

Offertflödet sparar oföränderliga versioner av företag, kund, bil, pris, villkor och giltighet. Säljaren måste uttryckligen bekräfta prisgrund som totalpris inklusive eventuell moms. Samma begäransreferens och underlag kan återförsökas utan ny version. Historiken hämtas vid behov med sidindelning; en autentiserad användare i rätt företag kan hämta en PDF från det sparade underlaget. Offertversionen skickas inte automatiskt till kund eller partner och är inget signerat köpeavtal. Mallbyggare, kundaccept, signering och bevisarkiv återstår. Handlarnätverket är ännu inte öppet för publicering. Bokföring, leverans, kreditlimit och lagerlösen är kommande faser.

Signeringsmodulerna från PR #3, commit `86bbce9`, har integrerats under `src/lib/signing/`: beständig ledger, användargräns, worker/inbox och privata filer. Applikationswrappern tvingar fortfarande providerklient och workerdispatch till `enabled:false`; inga providercredentials, signeringsroutes, verkliga utskick eller kreditavtal är aktiverade. [DOCUSEAL_INTEGRATION](docs/DOCUSEAL_INTEGRATION.md) beskriver kvarstående avtalsrendering, mallbindning och aktivering.

Offertpanelen har privat arkivering för ägare, administratör och ekonomi. Servern renderar den sparade offertversionen, verifierar uppladdade bytes och registrerar arkivet genom en service-only RPC. Autentiserad nedladdning kontrollerar företag, dokumentbindning, faktisk filhash och privat lagring. Offerten behåller dokumenttypen `other` och blir inget signerat köpeavtal. Två nya additiva migrationer och serverns `SUPABASE_SECRET_KEY` krävs innan ny arkivering fungerar i hosted drift; dessa har inte applicerats eller konfigurerats genom denna leverans. Se [OFFER_DOCUMENT_ARCHIVE](docs/OFFER_DOCUMENT_ARCHIVE.md). Sourcingmodellen från PR #2 är fortsatt separat.

Reservationsutgång hanteras atomiskt när ny affär skapas eller en bil reserveras; det gamla affärsutkastet och lagerposten frigörs med bevarad historik. Ingen schemalagd bakgrundskörning är aktiv. Förslaget [reservation_expiry_schedule.sql](docs/proposals/reservation_expiry_schedule.sql) ligger utanför migrationskatalogen: automatisk godkännandegranskning avvisade permanent `pg_cron` och minutvisa produktionsmutationer, och avvisade ett andra försök eftersom main-instruktionen inte tydligt godkände det separata minutjobbet. En ny explicit godkännandefråga är obesvarad och förslaget är inte applicerat; livekontroll efter avslag bekräftar `pg_cron_exists = false`; utgången reservation kan därför ligga kvar i liststatus fram till nästa relevant lageroperation.

`vercel.json` använder Next.js och region `arn1`. Domänrouting skiljer publik webb från handlarapp; appdomänens rot leder mot `/dashboard`, och skyddade sidor kräver session och företagskontext. Appen ersätter den tidigare statiska webbplatsen som ett sammanhängande Next.js-projekt. Publicering måste verifiera både den publika sidan och handlarappen.

Fortsatt byggordning, beroenden och leveranskrav finns i [MASTERPLAN](docs/MASTERPLAN.md). Där anges vilka delar som återhämtats från originalplanen och vilka som rekonstruerats från fragment och kod.
