# Projektgenomgång 18 oktober 2026

Utgångspunkt: main `aaadbcf4c79ce4b9ff3f4aaa6deaf2a820789a50` efter PR #55. Genomgången omfattar publika sidor, ansökan/konto, superadmin, handlarens kund- och teamvyer, kalkyler/annonsering och dokumentkedjan. Slutlig releaseidentitet och verifiering redovisas i PR:n.

## Publicering och driftbevis

PR #56 är mergad till main `de0475660f56905208e30fb0061260b9e6820344`. Exakt produktion `dpl_CDvnqYaVMt8y3QA6JzLRp15PZaSN` är READY och har alias för app, www och apex. `/privacy` och `/cookies` svarar 200 och visar version 18; inloggningen svarar 200 med lösenordsfält och återställning, utan öppen registrering eller localhost-länk. `app.trafexa.com/` leder till inloggningen enligt avsedd domänrouting. Apex ger 308 till den kanoniska webbplatsen `www.trafexa.com`, vars faktiska ansökningsformulär svarar 200 och visar version 18. Inga riktiga formulär skickades.

Databasens kompatibla fas A applicerades som `20261018184303` före releasen. Strikt fas B applicerades som `20261018185525` först efter verifierad produktionsversion. SQL-bytes och SHA-256 är oförändrade efter filnamnsavstämningen. Hosted rollback-only integritetsprov gav `privacy_revision_proof_pass=true` och separat efterkontroll `privacy_revision_cleanup_pass=true`; inga ansökningar, Auth-konton eller mejl skapades beständigt. Databasen har nu 182 applicerade migrationer; de två äldre, opublicerade prototyperna har fortfarande inte körts.

Den kontrollerade produktionens runtime-loggar gav inga error/fatal-poster i det avgränsade releasefönstret. Säkerhetsadvisorns kategorier är oförändrade: avsiktligt stängda privata RLS-tabeller samt de två redan kända varningarna nedan. Detta ersätter ingen autentiserad produktionsresa eller garanti om alla framtida arbetsflöden. En separat uppföljande PR bevarar endast denna slutrapport och det faktiskt tilldelade migrationstidsnumret; applikationskod och SQL-innehåll ändras inte.

## Rättade produktfel

- Konto- och medlemsändringar hos superadmin spärrar nu även överordnad navigering medan skrivning och kvittots återläsning pågår. Vyn kan inte försvinna mitt under en ändring; okänt utfall behåller ursprungligt begärande-ID för uttryckligt återförsök.
- Kundförfrågningar rensar tidigare personuppgifter och sidmarkör om en ny läsning misslyckas. Skrivning kräver en ny verifierad företagsläsning. Försenade svar från en stängd/ersatt vy ignoreras. Osäkert skapande behåller sitt nonce tills identisk återläsning/återförsök kan göras.
- Teamvyn verifierar företag, aktör och aktuell roll innan privata rader och åtgärder visas. Ändrad identitet/roll rensar granskning och formulär. Ägarbyte hämtar nya serveregenskaper.
- Kundförfrågningarnas knappar och filialrubriken fungerar på 320 px. Den skärmläsaretikett som kunde vidga hela sidan är begränsad till sitt formulär.
- Vanlig utloggning kontrollerar resultatet av global sessionsåterkallelse. Providerfel ger befintlig varning/återförsök i inloggningen, i stället för ett obekräftat lyckat besked.
- Integritets-, cookie- och villkorstexter beskriver det aktuella kontofria dokumentflödet, godkännande med inskrivet namn, faktiska cookie-sökvägar och livslängder. Gemensam informationsversion är `2026-10-18`. Endast nödvändiga cookies används; informationskvittot är inget marknadsföringssamtycke. Se [driftinstruktionen](WEB_PRIVACY_OPERATIONS.md) för tvåfasuppgradering och kvarvarande verksamhetsansvar.

## Verifiering

Produktionsbygge inklusive TypeScript passerar på granskningskopian. Riktade faktiska browserprov: admin 70/70; kundförfrågningar/filialer/team och verkligt lazy-laddat ägarbyte 38/38. Utloggning 14/14. Policy/API/formulär, gammalt kvittoreplay och båda migrationsfaser har separata godkända prov. Delkörningar överlappar helkörningen och adderas inte.

Den första oförändrade flat-körningen gav 1891/1892 godkända fall. Det enda felet orsakades av två separata wall-clock-anrop i samma sjudagarsfixture; båda använder nu samma materialiserade tidsankare. Offertarkivets gamla isolerade bootstrap saknade cron-ersättning och återanvänder nu etablerad testbootstrap. Korrigerade arkiv/dispatcherprov passerar 5/5. Slutkörningen på granskningskopian gav 1916 faktiska godkända fall och ett testfilsladdningsfel: den kopierade arbetskatalogen saknade det dokumenterade lokala PGlite-beroendet i `tests/crm-db/node_modules`. Efter återställning av samma installerade beroende passerade de två oförändrade dokumentnavsfallen separat, 2/2. Samtliga 1918 faktiska appfall är därmed verifierade över helkörningen och kompletteringen; själva första slutkörningen avslutades med felstatus och beskrivs inte som en helt grön invocation. Inga fall var överhoppade eller avbrutna. Helkörningens tid var 695741,607043 ms och kompletteringens 10294,332183 ms.

Den separata första körningen av 57 nästlade testfiler gav 420/467 godkända. Felen har spårats till miljöförutsättningar, historiska schemapåståenden och äldre behörighets-/leaseförväntningar; de redovisas inte som bekräftade produktfel. Riktad omkörning: native originalarkiv 11/11, reservationsexpiry 10/10, inbytesanskaffning med riktiga låsväntningar 16/16, admin-DDL 4/4, fordonskalkyl/finansbehörighet 7/7 och kontraktsinbjudans lease 9/9. Offertarkiv ingår i de fem rättade arkiv/dispatcherfallen ovan. Dessa riktade körningar överlappar den ursprungliga körningen. Tillfälliga testcontainrar tas bort efter provet.

Publik frontend granskas i riktig Chromium på 320 och 1440 px: startsida, informationssidor och nio demosektioner, totalt 28 sidkontroller. Ingen horisontell sidöverströmning, oetiketterad synlig kontroll eller pageerror hittades i grundkontrollen. Lokal `/login` kräver projektets Supabase-miljö och ger därför 500 utan den; de fyra produktionssidor som återlästes, inklusive inloggningen, gav 200. Dessutom svarade den nya exakta förhandsversionens `/login`, `/privacy` och `/cookies` med 200; inloggningsformulär och glömt lösenord visas, ingen öppen registrering eller localhost-länk hittades, och informationssidorna visar version 18 med båda personliga cookie-sökvägarna. Förhandsversionen var READY vid `a22d1bd3aff2edea956d5022016146d3966833fc`. Detta är ingen autentiserad produktionsinloggningskontroll. Hero och arbetsyta samt rättade kund- och filialvyer har även granskats visuellt.

## Dokument och verklig mejltransport

Det isolerade integrationsflödet använder verkliga åtgärder, SQL och renderare för offert, båda signeringsordningarna, PDF/evidens/originalarkiv, utskickskö och personlig läslänk. Auth, Storage och providertransport är kontrollerade provgränser. Ingen riktig kundaffär eller faktura har skapats för kontrollen.

Två tydligt märkta testmejl skickades efter uttryckligt godkännande via Resend-anslutningen. Första mottagaren på Trafexa-domänen avvisades permanent med `550 Mailbox does not exist`; Resend spärrade mottagaren efter studsen. Användaren valde därefter en alternativ adress på div3rsa.com. Det andra mejlet har status `delivered`, vilket betyder mottaget av mottagarens mejlserver, inte bevis på placering i inkorgen eller läsning. Spärren har inte hävts och superadminkontot har inte ändrats.

Det verkliga testmejlet verifierar Resend-transporten, inte en autentiserad produktionsaffär genom hela avtalsdispatchern. Produktionsmetadata visar konfigurerad avtalsutsändning och nödvändiga nycklar; hemliga värden hämtades inte. Generiska ansöknings-/adminnotiser styrs av en separat flagga och ska inte beskrivas som verifierade liveutskick.

## Kvarvarande externa förutsättningar

- Mottagarkonfiguration/spärr för superadminens Trafexa-adress behöver utredas hos mejlleverantören. Inga fler försök gjordes efter studsen.
- Riktig autentiserad produktionsresa med ett uttryckligt valt provavtal återstår; de isolerade resorna är verifierade.
- Separat backuplagring är ännu inte vald. Export och återställningsprov från PR #55 är förberedda.
- Partneravtal/credentials krävs för verklig annonsering och bankkoppling; ingen simulerad publicering har presenterats som verklig.
- Hosted säkerhetsadvisor har sedan tidigare två varningskategorier: [authenticated security-definer execute](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable) och [läckta lösenord](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection). Ingen obestyrkt behörighetsändring eller betalinställning aktiverades i genomgången.
