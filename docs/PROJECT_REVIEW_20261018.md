# Projektgenomgång 18 oktober 2026

Utgångspunkt: main `aaadbcf4c79ce4b9ff3f4aaa6deaf2a820789a50` efter PR #55. Genomgången omfattar publika sidor, ansökan/konto, superadmin, handlarens kund- och teamvyer, kalkyler/annonsering och dokumentkedjan. Slutlig releaseidentitet och verifiering redovisas i PR:n.

## Rättade produktfel

- Konto- och medlemsändringar hos superadmin spärrar nu även överordnad navigering medan skrivning och kvittots återläsning pågår. Vyn kan inte försvinna mitt under en ändring; okänt utfall behåller ursprungligt begärande-ID för uttryckligt återförsök.
- Kundförfrågningar rensar tidigare personuppgifter och sidmarkör om en ny läsning misslyckas. Skrivning kräver en ny verifierad företagsläsning. Försenade svar från en stängd/ersatt vy ignoreras. Osäkert skapande behåller sitt nonce tills identisk återläsning/återförsök kan göras.
- Teamvyn verifierar företag, aktör och aktuell roll innan privata rader och åtgärder visas. Ändrad identitet/roll rensar granskning och formulär. Ägarbyte hämtar nya serveregenskaper.
- Kundförfrågningarnas knappar och filialrubriken fungerar på 320 px. Den skärmläsaretikett som kunde vidga hela sidan är begränsad till sitt formulär.
- Vanlig utloggning kontrollerar resultatet av global sessionsåterkallelse. Providerfel ger befintlig varning/återförsök i inloggningen, i stället för ett obekräftat lyckat besked.
- Integritets-, cookie- och villkorstexter beskriver det aktuella kontofria dokumentflödet, godkännande med inskrivet namn, faktiska cookie-sökvägar och livslängder. Gemensam informationsversion är `2026-10-18`. Endast nödvändiga cookies används; informationskvittot är inget marknadsföringssamtycke. Se [driftinstruktionen](WEB_PRIVACY_OPERATIONS.md) för tvåfasuppgradering och kvarvarande verksamhetsansvar.

## Verifiering

Produktionsbygge inklusive TypeScript passerar på granskningskopian. Riktade faktiska browserprov: admin 70/70; kundförfrågningar/filialer/team och verkligt lazy-laddat ägarbyte 38/38. Utloggning 14/14. Policy/API/formulär, gammalt kvittoreplay och båda migrationsfaser har separata godkända prov. Delkörningar överlappar helkörningen och adderas inte.

Den första oförändrade flat-körningen gav 1891/1892 godkända fall. Det enda felet orsakades av två separata wall-clock-anrop i samma sjudagarsfixture; båda använder nu samma materialiserade tidsankare. Offertarkivets gamla isolerade bootstrap saknade cron-ersättning och återanvänder nu etablerad testbootstrap. Korrigerade arkiv/dispatcherprov passerar 5/5. Slutlig samlad körning på granskningskopian redovisas i releasens PR.

Den separata första körningen av 57 nästlade testfiler gav 420/467 godkända. Felen har spårats till miljöförutsättningar, historiska schemapåståenden och äldre behörighets-/leaseförväntningar; de redovisas inte som bekräftade produktfel. Riktad omkörning: native originalarkiv 11/11, reservationsexpiry 10/10, inbytesanskaffning med riktiga låsväntningar 16/16, admin-DDL 4/4, fordonskalkyl/finansbehörighet 7/7 och kontraktsinbjudans lease 9/9. Offertarkiv ingår i de fem rättade arkiv/dispatcherfallen ovan. Dessa riktade körningar överlappar den ursprungliga körningen. Tillfälliga testcontainrar tas bort efter provet.

Publik frontend granskas i riktig Chromium på 320 och 1440 px: startsida, informationssidor och nio demosektioner, totalt 28 sidkontroller. Ingen horisontell sidöverströmning, oetiketterad synlig kontroll eller pageerror hittades i grundkontrollen. Lokal `/login` kräver projektets Supabase-miljö och ger därför 500 utan den; de fyra produktionssidor som återlästes, inklusive inloggningen, gav 200. Detta är ingen autentiserad produktionsinloggningskontroll. Hero och arbetsyta samt rättade kund- och filialvyer har även granskats visuellt.

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
