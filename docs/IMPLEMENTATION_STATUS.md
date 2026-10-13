# Implementationsstatus

13 oktober 2026 • fortsättning på `codex/trafexa-dealer-continuation-20261013`

## Hur status ska läsas

Bygggrunden är återhämtad från originalarbetet och fortsättningen har lagt till finansåtkomst, företagskontext, reservationsutgång, import, kostnader, CRM, offertversion/PDF och ett avstängt signeringsbibliotek. Senaste typkontroll, 107/107 Node-beteenden, 11/11 `npm test`-filsviter, 7/7 SQL-regressioner med rollback och produktionsbygge inklusive PDF-fonttrace har passerat. Alla åtta migrationer har verifierats genom live-readback och databastyper har regenererats efter CRM. Tidigare lokal produktionsbrowser passerade 31/31 och samlad utvecklings-/mock-/produktions-QA 182/182; dessa är historiska resultat och har inte räknats om efter slutfixarna. Draft-PR #4 har historiskt verifierade `READY`-checkpoints `cf953d4`, `69ed849` och `aed26df`; senare kodpushar följs genom PR/Vercelstatus. Autentiserad CRUD genom produktionsgränssnittet är ännu inte verifierad; `main` och produktion har inte ersatts.

Den tidigare statiska Trafexa-sajtens formulärkontroller hör till en annan kodbas och är inte verifiering av denna Next.js-/Supabase-app.

## Bekräftade resurser och auktorisation

| Resurs | Aktuell kunskap |
|---|---|
| Repository | `heke99/trafexa-auto`; denna branch fortsätter dealerappen som ersätter gamla sajten. |
| Vercel | Projekt `prj_zWks8Qd6m9ijWdu3tzid9RJlGgGE`, team `team_e3htkJPyBNSw3Ix1KQLlf180`; källkonfiguration Next.js och `arn1`. |
| Supabase | Trafexa Dealer, `buqdtssxrotkzndublrt`, Stockholm / `eu-north-1`; livekontroll bekräftar `ACTIVE_HEALTHY`. |
| Migrationer | Åtta applied-versioner bekräftade: tre grundmigrationer samt finansåtkomst `20261013151347`, reservationsutgång `20261013151355`, lagerimport `20261013152832`, offertversioner `20261013154317` och CRM `20261013160452`. |
| Domäner | Readback bekräftar `trafexa.com`, `www.trafexa.com` och `app.trafexa.com` som verifierade i Vercel. Ingen DNSmutation; appens faktiska HTTP-/authflöde kontrolleras vid publicering. |
| Uppdrag | Originalchatten `01a13504-1d80-7611-92e8-9076ccf7605d`, användarturn `01a13554-497f-7729-abd7-e91341e8105c`, godkänner ersättningen av gamla sajten och byggandet i befintliga Trafexa Auto-resurser. |

## Verifierade preview-checkpoints

| Artefakt | Bekräftad referens/status |
|---|---|
| Pull request | [Draft-PR #4](https://github.com/heke99/trafexa-auto/pull/4), attached till uppdraget. |
| Branch | `codex/trafexa-dealer-continuation-20261013` |
| Commit | `cf953d4078c047efefe3da1674a989ad571eea52` |
| Tree | `a204d647a4d81fa5d6f26f67c57165afa3ac1d0c`; avstämd mot den publicerade checkpointen `cf953d4`. |
| Deployment | `dpl_GveGscnZV3szkXC3xwgYKJNbtkst`, automatiskt skapad preview, `READY`. |
| URL | [trafexa-auto-304mxzp8h-div3rsa.vercel.app](https://trafexa-auto-304mxzp8h-div3rsa.vercel.app) |
| Mål | Preview i `prj_zWks8Qd6m9ijWdu3tzid9RJlGgGE`, team `team_e3htkJPyBNSw3Ix1KQLlf180`, region `arn1`. |
| Remote installation/bygge | Byggloggar för denna deployment visar `Running install command npm ci`, 73 installerade paket på sex sekunder, sedan `npm run build` och `READY`. |
| Skyddad fetch | HTTP 200 för lagerdemo, kunddemo/CRM och login via det native åtkomstverktyget. |
| Produktionspåverkan | Ingen ersättning av `main` eller produktion genom denna preview. |

Remote PDF-anrop utan appsession rapporterade HTTP 401, men åtkomstverktyget klassade det som `deploymentAuthRequired` och returnerade inte body. Det resultatet räknas därför inte som bevis för appens PDF-behörighetsgräns eller autentiserad remote PDF-CRUD. Appgränserna har passerat lokalt; faktisk remote PDF-hämtning återstår.

Den senare verifierade Node-checkpointen är:

| Artefakt | Bekräftad referens/status |
|---|---|
| Commit | `69ed849af1afe19c1c637f71940ec70384f1ce46` |
| Tree | `f9de92c9198e49135bb7fac2326dcd384f50e168` |
| Deployment | `dpl_EgM71HipZpPg2XVMzxefqFzt6vTx`, `READY`. |
| URL | [trafexa-auto-qv9b55c4h-div3rsa.vercel.app](https://trafexa-auto-qv9b55c4h-div3rsa.vercel.app) |
| Avstämning | Native readback verifierar projekt och commit; rätt projekt/team och `arn1`. Lager- och kunddemo gav 200 med förväntat gränssnitt. |
| Node.js | Manifest och lockfil låser `24.x`; lokal verifieringsmaskin kör `24.19.0`. |

Den tredje historiskt verifierade checkpointen är:

| Artefakt | Bekräftad referens/status |
|---|---|
| Commit/tree | `aed26dff099fc552687c29182d9a895da28ddd28` / `b36d0d668c9365df592001ffbd980b31ec28dd4a` |
| Deployment | `dpl_62td1ULZfX4FVG8WxrepwNvUrerC`, `READY`. |
| URL | [trafexa-auto-cvhiuxi96-div3rsa.vercel.app](https://trafexa-auto-cvhiuxi96-div3rsa.vercel.app) |
| Avstämning | Native readback matchar rätt projekt, commit och `arn1`; lager- och kunddemo gav 200 med deployment-ID. |
| Täckningsgräns | Den nya återställningsfixen tillkom senare och ingår inte i denna checkpoints verifierade resultat. |

Dessa är historiskt verifierade checkpoints. Efterföljande kodpushar följs i [PR #4](https://github.com/heke99/trafexa-auto/pull/4) och Vercels deploymentstatus med respektive commit. Checkpointresultat överförs inte till senare kodversioner.

Efter Node-checkpointen tillkom två lokalt verifierade korrigeringar: beloppsvisningen i lager/affärer bevarar ören i stället för att avrunda till hela kronor, och pilot-API:t accepterar den specifika `VERCEL_BRANCH_URL`-originen. Andra Vercelhosts nekas fortfarande med 403. Två SSR-beloppsregressioner och en produktions-originregression ingår i de senaste 107 beteendetesterna. Därefter härdades återställningsförfrågan med fem regressioner för bekräftat svar och säkra SDK-/klient-/nätverksfel, utan verkliga authmejl.

## Återhämtad och fortsatt implementation

| Område | Vad som finns i kod/schema | Kvarstående omverifiering eller funktion |
|---|---|---|
| Webbgrund | Next.js App Router, React, TypeScript, Supabase SSR, Node `24.x`, låsta beroenden och Vercelkonfiguration. Databastyper regenererade; lokala kontroller PASS. Tre verifierade preview-checkpoints `READY`. | Fortsatt PR-granskning, autentiserad remote-CRUD och produktionsrelease återstår. |
| Publik sida | Ny svensk Trafexa-hemsida, demo, integritet/villkor och mobilmeny. Lokal produktionsbrowser PASS. | Faktiskt remote domänflöde och efterkontroll vid release. |
| Konto | Registrering, bekräftelsecallback, inloggning/utloggning och återställning. Återställning visar villkorlig framgång endast efter SDK-svar utan fel; SDK-/klient-/nätverksfel ger generiskt fel. Fem authregressioner PASS isolerat och i fullsviten, utan verkliga authmejl. | Komplett authflöde/redirects/cookies i avsedd miljö återstår. |
| Företag | Företagsskapande, företagsväxling och fem roller. Gemensam kontext verifierar användare, aktuellt medlemskap och aktivt företag; stale/ogiltigt val väljer inget annat företag automatiskt. SQL-isolering och tolv permanenta kontexttester PASS. | Autentiserat browserflöde mot produktionsgränssnitt, inbjudningar och filialer återstår. |
| Lager | Manuell registrering, sök/filter/sortering, pris/kostnader och CSV-import. Beloppsvisning bevarar ören; SSR-, server-/SQL- och mockade UI-regressioner PASS. | Autentiserad produktions-CRUD och samtidighet; bilder, inköpsunderlag och full kostnadsspårning återstår. |
| Kunder/CRM | Kundkort/sök samt behovsladdad förfrågningspanel. Atomiskt kontakt-/lead-intag, sjudagars UUID-retry, sidindelning och statusbyte med kontroll av tidigare status. Action-, live-SQL- och mockade UI-kontroller PASS. | Autentiserad produktions-CRUD, full kontakt-/aktivitetshistorik och bredare kunduppdatering återstår. |
| Affärer | Affärsutkast, reservation/frigivning/utgång och offertversionering med prisbekräftelse/återförsöksskydd. SQL samt lokala/mockade kontroller passerade. | Autentiserad produktions-CRUD, två samtidiga anslutningar, kundaccept, inbyte och leverans återstår. Ingen scheduler aktiv. |
| Finansiering | Internt `intake` med skärpt RLS: ägare/admin/finans ser företagets intag; säljare ser sitt eget. SQL för läs-/skrivgräns passerade. | Ingen bankadapter, kreditbedömning, utbetalning eller lagerkredit är aktiv. |
| Dokument/offert-PDF | Företagsanknutna metadata/privat bucket, oföränderligt offertsnapshot och sessions-/företagskontrollerad PDF-route. PDF-tester, fonttrace och lokala/mockade kontroller passerade. | Autentiserad PDF-hämtning genom produktionsflödet, mallbyggare, kundaccept, signering, evidens och hämtning av arkiverade dokument återstår. |
| Signeringsbibliotek | Slutlig adapter, domänmodell, ledger/store/user/worker/inbox/storage från PR #3, commit `86bbce9`, finns nu i appen. Server-wrapper tvingar provider och dispatch till avstängt läge. 106 lokala signeringsfall passerar. | Additiv migration, verkligt godkänt avtalsrenderunderlag, providermall/credentials, signeringsroutes, webhookdrift och hosted flöde behöver fortfarande aktiveras och verifieras. Se [integrationsguiden](DOCUSEAL_INTEGRATION.md). |
| Nätverk | Informationsvy inför kontrollerad pilot. | Publicering, inköpsönskemål, matchning, bud och B2B-affär återstår. |
| Ekonomi | Inköps-/försäljningsbelopp, registrerade fordonskostnader och momsmodell. Offert för standardmoms använder bekräftat totalpris; VMB presenteras separat. | Ingen full ekonomimodul, VMB-beräkning, faktura, betalningsavstämning eller export. |
| Demo-/pilotförfrågan | `POST /api/demo-requests`, ursprungskontroll inklusive specifik `VERCEL_BRANCH_URL`, JSON/storleksgräns, honeypot och privat intag. Produktionsregression tillåter avsedd branchorigin och nekar andra Vercelhosts med 403. | Komplett browser/API/databasflöde; förfrågningar sparas, automatiska aviseringar ingår inte. |
| Audit/integritet | RLS, företagsreferenser, kontrollerade mutationer och audittriggers. Sju live-SQL-regressioner med rollback passerade, inklusive CRM:s statuskolumn/grants och audit. | Aktuellt företags-/sessionsflöde och samtidiga anslutningar behöver ytterligare browser/integrationskontroll. |

## Migrationer och återhämtningsluckor

| Fil | Bekräftad applied-version |
|---|---|
| `supabase/migrations/20261013130218_dealer_foundation.sql` | `20261013130218` |
| `supabase/migrations/20261013130603_dealer_integrity_hardening.sql` | `20261013130603` |
| `supabase/migrations/20261013130654_explicit_data_api_grants.sql` | `20261013130654` |
| `supabase/migrations/20261013151347_finance_access_scope.sql` | `20261013151347` |
| `supabase/migrations/20261013151355_reservation_expiration.sql` | `20261013151355` |
| `supabase/migrations/20261013152832_stock_import.sql` | `20261013152832` |
| `supabase/migrations/20261013154317_offer_versions.sql` | `20261013154317` |
| `supabase/migrations/20261013160452_customer_leads.sql` | `20261013160452` |

De återhämtade arbetsförsöken för finansåtkomst och reservationsutgång har granskats och fortsatts med de bekräftade liveversionerna ovan. Lokala namn har synkroniserats till dessa versioner. Offertapply och live-readback är bekräftade; fullständiga databastyper har regenererats efter schemats fortsättning.

SQL-regressioner finns nu för `tenant_isolation`, `public_and_storage`, `finance_access_scope`, `reservation_expiration`, `stock_import`, `offer_versions` och `customer_leads`. Samtliga sju har passerat mot det bekräftade projektet med syntetiska fixtures och rollback. CRM-testet täcker båda företag, alla roller, sjudagars återförsök, 1000-kvittonsgräns, audit, statuskonflikt och begränsade kolumngrants, utöver övriga sviters företags-/lagrings-/reservations-/import-/offertgränser.

Livekörningen av offerttestet utelämnade det simulerade legacyfallet med ogiltiga källdata för att undvika ändring av tabellconstraints i liveprojektet. Hela offertsviten, inklusive tolv kontroller av källdatagränser, har i stället passerat i isolerad PGlite. Sex PDF-testfall ingår i de passerade Node-testerna. Denna skillnad i miljö och täckning är avsiktligt redovisad; isolerade legacyfall är inte liveändringar.

## Schemaläggning och kvarstående advisory

Ingen scheduler är aktiv. Reservationsutgång sker i den applicerade RPC-kedjan när ny affär skapas eller bil reserveras. Det bevarar gamla reservationsposter och frigör affär/lager atomiskt. En utgången post kan ligga kvar med reserverad liststatus tills nästa sådan operation.

Automatisk godkännandegranskning avvisade `20261013153335_reservation_expiry_schedule`: åtgärden skulle installera permanent `pg_cron` och utföra minutvisa mutationer i produktionsdatabasen. Förslaget är flyttat till [proposals/reservation_expiry_schedule.sql](proposals/reservation_expiry_schedule.sql), utanför `supabase/migrations/`. Separat godkännandefråga är fortfarande obesvarad. Förslaget är inte applicerat och ingår inte som automatisk migration i release.

Koordinerande agents senaste security-advisor-kontroll rapporterar endast att skydd mot läckta lösenord är avstängt. Den inställningen är inte ändrad av dokumentationsarbetet; den kvarstår som en uttrycklig driftåtgärd. Detta advisoryresultat ersätter inte egna åtkomst- och browserregressioner.

Originalplanens innehållsförteckning 1–22 och fulla fas 0–10 återhämtades, men inte hela originaltexten eller samtliga ursprungliga tester. [MASTERPLAN](MASTERPLAN.md) redovisar den rekonstruerade fortsättningen och källfragmentens begränsningar.

## Verifieringsprotokoll i denna fortsättning

| Kontroll | Nuvarande bevis/status |
|---|---|
| Projekthälsa och migrationlista | Bekräftat live av koordinerande agent: aktivt och friskt projekt, åtta applied-versioner enligt ovan med full readback. |
| Security advisor | Endast advisory om avstängt skydd mot läckta lösenord, enligt koordinerande agents senaste kontroll. |
| Node.js | Lokal verifieringsmaskin `24.19.0`; manifest/lockfil låser `24.x` i verifierad `READY`-checkpoint `69ed849`. |
| Remote `npm ci` och bygge | PASS i första checkpointen `dpl_GveGscnZV3szkXC3xwgYKJNbtkst` / `cf953d4078c047efefe3da1674a989ad571eea52`: 73 paket på sex sekunder, följt av `npm run build` och `READY`. |
| `npm run typecheck` | PASS efter CRM-typregenerering samt belopps-/originfixar; senaste byggning inklusive TypeScript PASS efter authfix, bekräftat av koordinerande agent 13 oktober 2026. |
| `node --test --test-isolation=none tests/*.test.mjs` | Senaste PASS 107/107: 44 routing-/validerings-/demo-/import-/PDF-fall, 32 DocuSeal-fall, 12 företagskontextfall, 12 CRM-actionfall, två SSR-beloppsfall och fem authåterställningsfall. Provider-/authtransport och serverberoenden mockas där respektive svit kräver det. |
| `npm test` | Senaste PASS 11/11 filsviter efter authfix, via exakt package-script. Nodedefault rapporterar filsviter; de enskilda beteendena är 107 enligt kommandot ovan. |
| Företagskontext | Tolv permanenta regressioner i `tests/company-context.test.mjs` PASS efter gemensam verifierad session och hantering av stale cookie. |
| Lösenordsåterställning | PASS 5/5 i `tests/auth-recovery.test.mjs`, isolerat och i fullsviten: bekräftat villkorligt svar, SDK-fel, nätverksfel, klientinitialiseringsfel och ogiltig e-post. Auth-SDK är mockat; inga verkliga authmejl skickade. |
| `npm run build` | Senaste PASS efter authfix, inklusive TypeScript och 14 sidor/API/SSR/proxy med Next.js 16.4/Turbopack. Senaste `route.js.nft.json` innehåller `DejaVuSans.ttf`; fonttrace PASS. |
| SQL-regressioner | PASS 7/7 mot `buqdtssxrotkzndublrt` med rollback, inklusive CRM. Offertens simulerade legacyfall utelämnat live; hela offertsviten inklusive tolv källdatagränser PASS i isolerad PGlite. |
| Reservationskonkurrens/utgång | Lazy expiry applicerad; schema/testunderlag finns. Separata samtidiga anslutningar och bakgrundsscheduler är olika kontroller. |
| Lokal produktionsbrowser | Historiskt PASS 31/31 mot port 3010, noll POST-anrop och noll JavaScriptfel. Detta är lokal produktionskontroll, inte autentiserad produktions-CRUD. De senare belopps-/originfixarna har separata regressioner ovan. |
| Samlad browser/QA | Tidigare PASS 182/182 över utveckling, mockade UI-actions och lokal produktion. Mockad UI-harness bevisar användarbeteenden men ingen verklig produktionsmutation. |
| Riktad browserkontroll efter slutfixar | PASS 9/9 för berörda lager-/affärsvyer, kostnadsdialog och behovsladdad CRM vid 320/1280 px mot produktionsbygget på port 3011. Noll POST-anrop och JavaScriptfel. Historiska 182/182 räknas inte om som ny full körning. |
| Mobil och tillgänglighet | Lokala QA-kontroller av förbättrade mobilmenyer/åtkomst passerade; remote efterkontroll återstår. |
| Remote preview | `READY`-checkpoints `cf953d4`, `69ed849` och `aed26df`, rätt projekt/team och `arn1`. Skyddad fetch verifierar respektive demo/loginyta; ingen autentiserad remote CRUD eller PDF-CRUD verifierad. Senare pushar följs via PR/Vercelstatus. |
| Produktionsrelease/domäner | Alla tre domäner verifierade via readback. Draft-PR #4/preview innebär ingen ersättning av `main` eller produktion. |

Uppdatera detta protokoll med faktiskt kommando, miljö, resultat och begränsning. Räkna inte partnerfunktioner som verifierade genom mockade beslut eller genom att en intern intresseanmälan går att spara.

## Prioriterad fortsättning

1. Följ efterföljande kodpushar via draft-PR #4 och Vercelstatus, med de verifierade checkpoints som konkreta referenser.
2. Komplettera remote font-/domän-/auth-/PDF-kontroller; de åtta migrationerna är redan applicerade och cronförslaget förblir separat med obesvarad godkännandefråga.
3. Komplettera ännu ej verifierad autentiserad browser-CRUD för två syntetiska företag och separata samtidiga reservationsanslutningar.
4. Följ upp advisory om läckta lösenord samt faktisk driftåtkomst för publikt intag och dokument.
5. Publicera i avsett projekt efter releasekontroller och dokumentera enbart bekräftade artefakter/driftresultat.
6. Fortsätt fas 1–3:s återstående personal-/filial-, inköps-/bild-, CRM-/kundaccept- och inbytesarbete, därefter dokumentfasen och de partnerberoende faserna.

Ingen finanspartner, signeringstjänst, BankID-underskrift, bokföringsadapter eller fordonsdataadapter är aktiverad av dokumentationen eller den återhämtade bygggrunden.

Arbetsytans grundsnapshot begränsar lager, kunder och affärer till de 500 senaste posterna per företag. Importens dubblettkontroll använder hela företagets lager, men full sidindelning, sökning och dashboardtotaler för större register återstår före bredare produktionsbruk.

## Tillägg: privat offertarkiv och beständig signeringsgrund

Integrationsgrenen `feat/offer-signing-integration-20261013` utgår från PR #4, commit `4037761`. Den inför PR #3:s slutliga signeringsmoduler, commit `86bbce9`, i huvudappens `src/lib/signing/`, plus privat offertarkivering och autentiserad hämtning. Providerklient och workerdispatch förblir tvingat avstängda via applikationens server-wrapper.

Arkivering gäller befintliga oföränderliga offertversioner, `kind=other`, för owner/admin/finance. Servergenererade PDF-bytes återläses och hashkontrolleras före service-only registrering. Direkta användaranrop kan inte förfalska arkivregistreringen. En ny offert registreras högst en gång; historiska kvitton behåller första dokument, fil, aktör och begäransreferens. UI ignorerar sena svar efter företagsbyte och bevarar referensen vid retry. Downloadroute `/api/documents/[documentId]/pdf` verifierar faktisk filhash och privat bucket före och efter fil-I/O.

| Kontroll i denna integrationsgren | Resultat och gräns |
| --- | --- |
| `npm run typecheck` | PASS efter appintegrationen |
| `node --test --test-isolation=none tests/*.test.mjs` | PASS 137/137 beteenden, inklusive 15 arkiv-/server-action-/servicefall, 8 downloadfall och 6 browserfall. Provider och SDK-gränser är kontrollerade fixtures |
| `npm run test:signing` | PASS 106 fall i adapter/domän/store/worker/user/storage samt 8 flödesfall mot lokal PostgreSQL/PGlite. Delvis överlapp med huvudappens tester; summorna ska inte adderas som unika fall |
| `npm test --prefix tests/offer-archive-db` | PASS: hela huvudappens migrationsordning körs lokalt före arkivets SQL-rollbackassertioner med faktiska roller, RLS, grants, privata Storage-kataloger, oföränderlighet och service-only registrering |
| Chromium-komponentflöde | PASS 6/6 med verkliga DealOffers/DealerWorkspace, mockade serveråtgärder och blockerad HTTP. Next HTTP/RSC-transport och hosted CRUD ingår inte |
| `npm run build` | PASS för Next 16.4/Turbopack och Node 24, inklusive den nya dynamiska dokument-PDF-routen |

Nya migrationer är `20261013165650_signing_ledger.sql` och `20261013165726_offer_document_archive.sql`. De är lokala, CLI-namngivna additiva migrationer efter de åtta redan applicerade migrationerna. Hosted applicering har inte gjorts. Den äldre signing-ledgerfilen från PR #3 ska inte appliceras dessutom. Databastyperna från liveprojektet bevaras; ett lokalt RPC-overlay beskriver arkivmigrationen.

`SUPABASE_SECRET_KEY` eller äldre `SUPABASE_SERVICE_ROLE_KEY` behöver konfigureras enbart på servern för ny arkivregistrering. Saknad konfiguration stoppar före render/upload. Verklig lagrings-CRUD, godkänt köpeavtalsunderlag, faktiska providermallar, signeringsroutes/webhookdrift och användarens produktionsflöde återstår. Detta tillägg är kod och lokala verifieringar; det ersätter inte PR #4:s tidigare preview eller någon produktionsdeployment. [OFFER_DOCUMENT_ARCHIVE](OFFER_DOCUMENT_ARCHIVE.md) anger RPC- och driftkontraktet.
