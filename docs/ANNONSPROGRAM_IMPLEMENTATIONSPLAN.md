# Trafexas annonsprogram för Blocket och Bytbil

Implementationsplan · 8 november 2026

## 1. Butik, fakturering och API

| Del | Ägare och uppgift |
| --- | --- |
| Handlarföretag i DMS | Handlarens org.nr, användare, lager och köpeavtal |
| Butik hos Blocket | Befintlig butik med eget namn, adress och telefon. Publicering styrs med butikens `dealer_code`. |
| Blockets fakturering | Trafexa Nordic AB, org.nr 556855-4884, under den period Blocket bekräftar. Upplägget följer Blockets besked till Trafexa. |
| Trafexas kundfaktura | Trafexa fakturerar handlarens företag för verifierade publiceringar enligt butikens avtal samt avtalad butiksavgift. |
| Publik Trafexa-butik | Eget publiceringsval och egen status, oberoende av Pro Import API. |

Pro Import V5 återanvänds. En handlare kan ha flera butiker. Spara stabilt internt butiks-ID, ägande företag och verifierad Blocketkod. Säkerställ att en aktiv kod bara är kopplad till sin rätta butik. Vid offert, köning och dispatch härleds företaget och tillåten butik från lagerposten och den verifierade kopplingen. En företagsanslutning i nuvarande kod behöver utökas för att stödja flera butiker på samma org.nr. Behåll tidigare annons- och kontoidentiteter genom migreringen. Företag utan verifierad butiksmappning får granskas manuellt.

## 2. Anslutning och utträde

Superadmin går till **Företag → Butik → Annonsprogram**. Samma flöde gäller vid onboarding och för en befintlig kund.

- **Anslut butik.** Spara tilläggsavtal, önskat startdatum och Blockets referens. Visa väntande fram till bekräftelse och aktiv från bekräftad start enligt avtalet. Trafexa kan förbereda butikens priser under tiden.
- **Schemalägg utträde.** Registrera uppsägningen och beräkna föreslaget avtalsdatum från butikens villkor, exempelvis två månader. Spara separat det datum Blocket bekräftar för fakturabytet. Visa skillnader för manuell avstämning före periodlåsning.
- Bevara tidigare perioder och förhindra överlapp. Spärra nya offerter under Trafexas villkor när rätten upphör. Jobb som redan accepterats men ännu inte skickats vid brytdatum ska avstämmas före extern skrivning. Fortsätt läsa status för redan skickade jobb.
- Samordna eventuellt byte av API-behörighet med Blocket. Utträdet i sig påverkar faktureringen. Befintliga annonser och butikskopplingar hanteras i sina egna flöden.

## 3. Superadminpriser och åtkomst

| Fält per butik | Användning | Synlighet |
| --- | --- | --- |
| Kundpris Blocket per annons | Exempel 620 kr exkl. moms | Superadmin och behörig handlare |
| Kundpris Bytbil per annons | Sätts separat | Superadmin och behörig handlare |
| Kundens Blocketbutiksavgift per månad | Exempel 2 900 kr exkl. moms. Belopp och delmånadsregel bekräftas innan aktivering. | Superadmin och behörig handlare |
| Trafexas leverantörskostnad | Inköpspris per kanal och Trafexas egen kostnad för butiken, för intern avstämning och marginal | Endast superadmin |

Separera inköpskostnad från kundpriser i databasen och håll superadminläsningen skild från handlarens API. Kontrollera roller i både databas och serveråtgärder. Handlarens offerter, fakturor, exporter, felmeddelanden och kvitton innehåller enbart handlarens egna belopp. Uppdatering av inköpskostnad påverkar intern uppföljning. Kundpriser ändras uttryckligen.

Återanvänd befintliga versionshanterade kanalpriser, offertkontroll och fakturakedja. Utöka prisnyckeln till butik och marknadsplats där butiksprogrammet används. Visa giltighetsdatum och spara vem som ändrade vilket pris. Hantera befintliga företagspriser som historik och bekräfta butikens startpris uttryckligen. Använd heltalsöre och redovisa priser exkl. moms. Saknat pris spärrar det valet, medan beslutat noll är ett giltigt pris.

## 4. Handlarens publicering

På en bil visas valbara marknadsplatser och handlarens pris direkt, exempelvis **Blocket · 620 kr exkl. moms**. Visa en summa före bekräftelse. Om priset, butiken eller kanalens tillgänglighet ändras före bekräftelse hämtas en ny offert. När handlaren accepterar sparas priset per annons och marknadsplats tillsammans med butiken och leveransjobbet.

Pro Import kan ge både `blocket_ad_id` och `offer_id`. Använd samma stabila `source_id` för den externa annonsen. För befintlig annons verifieras den externa ägaren före ändring. Spara valda marknadsplatser i leveransjournalen och ha separat status och bevis per marknadsplats. Välj bara de kombinationer som Blocket bekräftat för V5 och pilotbutiken. Dokumentation om att exkludera en marknadsplats vid förnyelse räcker inte som kontrakt för att styra destination vid skapande eller uppdatering. Om endast paketpublicering stöds ska handlaren få ett uttryckligt paketval med tydligt pris, eller så hålls valet spärrat.

Gruppnyckeln lagras servernära. Spara bara referens och verifierad omfattning i provisioneringen. Bind journalen före POST eller PUT till företag, butik, konto, annonsversion och försök. Vid timeout går jobbet till avstämning med GET. Matcha rätt butik, annons och aktuell begäran innan publicering bokförs. Blocketbevis räcker för Blocket. Bytbil kräver verifierad Bytbil-status utöver ID enligt pilotens bevisregel. Dubbla kvittenser och uppdateringar får inte ge fler debiteringar. Verifiera även avpublicering vid såld bil per marknadsplats.

Källa för API-kontraktet: [Pro Import API Client Documentation](https://api.blocket.se/pro-import-api/docs/client-documentation).

## 5. Månadsöversikt och faktura

Superadmin väljer månad, handlare och butik. Visa **bilar i lager nu**, **unika bilar som annonserats under månaden**, **nya verifierade annonser per marknadsplats** samt ett separat antal väntande och felaktiga jobb. En bil på två marknadsplatser räknas som en bil och högst en ny debiterbar publicering per vald och verifierad marknadsplats. Visa kundintäkt och intern kostnad för superadmin med tydlig markering om leverantörens faktura ännu inte är avstämd.

Skapa fakturarader från låst månadsunderlag i Europe/Stockholm. En rad per butik, marknadsplats och styckpris ger korrekt underlag även om priset ändras mitt i månaden. Avgiften gäller första verifierade publiceringen och använder priset från handlarens accepterade offert. Avgiften för Blocketbutiken är en egen rad, högst en gång per butik och månad. Den kan tas ut även under en månad med noll annonser när butikens avtal ger stöd för det. Registrera avtalad hel eller proportionerad delmånad före aktivering och stoppa låsning för oklara avgifter eller periodavvikelser. Använd befintligt moms-, rättelse- och fakturaflöde. Låsta månader påverkas av senare ändringar bara genom spårbar rättelse eller kredit.

Exempel för en aktiv butik med bekräftad hel månadsavgift och tio verifierade Blocketannonser till samma pris.

| Fakturarad | Belopp exkl. moms |
| --- | ---: |
| Blocketannonser, 10 × 620 kr | 6 200 kr |
| Blocketbutik, månadsavgift | 2 900 kr |
| Totalt exkl. moms | 9 100 kr |

## 6. Bygg- och verifieringsordning

1. **Butik och avtalsperiod.** Bygg butiksbunden provisionering och anslutning för ny och befintlig handlare. Testa flera butiker under samma org.nr, återanslutning och brytdatum.
2. **Pris och offert.** Lägg till butikspris, månadsavgift och separat skyddad inköpskostnad. Testa annan butik, rollgränser, prisändring mellan visning och accept samt frånvaro av inköpspris i svar och exporter.
3. **API och statistik.** Verifiera grupp-JWT, rätt kod per butik och tillåtna V5-val för Blocket och Bytbil. Testa endast Blocket, endast Bytbil och båda där stödet finns, fel butik, delvis publicering, timeout, dubbelkvittens och såld bil. Börja med läskontroll och validering. Kör synlighetspilot först när testbutik och kanalval är bekräftade.
4. **Månadsunderlag och faktura.** Stäm av en komplett pilotmånad. Testa prisbyte mitt i månaden, noll annonser med butiksavgift, delmånad, avvikande fakturadatum, dubbla körningar och att en låst faktura kan återskapas med samma belopp.

Befintligt stöd omfattar företagsbaserade kanalpriser, fryst offert, månadsunderlag och ett V5-flöde för Blocket. De tidigare testresultaten i [Blocket gruppanslutning V5](BLOCKET_GROUP_SETUP.md) gäller dåvarande kod och testmiljöer. Butiksbaserade prisavtal, butiksavgift i fakturakedjan och separat Bytbil-verifiering är delar av den här implementationsplanen. Verklig partnerleverans och kanalval behöver verifieras i pilot.

## 7. Granskning mot koden

Granskad arbetskopia baserad på `0e27ca5`, 8 november 2026. Superadmintexten och planen finns lokalt. Följande krav behöver fortfarande byggas och verifieras.

| Prioritet | Fynd | Krav inför pilot eller fakturering |
| --- | --- | --- |
| P1 | Blocket V5 skickar `visible: true` och sparar bara `blocket_ad_id`. Befintlig kanalmodell har Blocket och Wayke. | Verifiera att varje erbjudet kanalval styr faktisk destination. Hantera delutfall och oväntad publicering som avvikelse. En kanal som handlaren inte accepterat får ingen fakturarad. |
| P1 | API-bindning och kanalpris är företagsbundna. Giltighetstiden för Blocketbindningen avser API-behörighet. | Inför separat butiksidentitet och avtalsperiod. Bind offert, jobb, publiceringsbevis och fakturarad till samma butik. Kontrollera behörighet både vid köning och precis före skrivning. |
| P1 | Månadsunderlaget summerar verifierade publiceringar. En butik utan annonsrader får ingen fast avgift från den modellen. | Skapa en separat radtyp för fast avgift med egen källa, prisversion och period. Uppdatera granskning, låsning, export, fakturautkast, PDF och kreditering. Prova en hel månad med noll annonser. |
| P1 | V5 har skapande, uppdatering och läsning. Avpublicering vid såld bil är inte implementerad i adaptern. | Lägg till avpublicering med bekräftelse per marknadsplats, även när handlarens rätt att skapa nya annonser har upphört. Hantera API-åtkomst vid utträde så att en tidigare skickad annons går att följa upp. |
| P1 | Om skapandet lyckas hos leverantören men svaret försvinner saknas request-ID. Nuvarande avstämning ger då `blocket_request_correlation_missing` även efter en lyckad GET. | Inför en granskad avstämningsväg med säkra bevis eller manuell eskalering. Testa borttappat svar på en faktiskt mottagen POST. Skriv aldrig om annonsen blint. |
| P2 | Befintliga pris- och statistikflöden känner inte till butikens privata inköpskostnad eller butiksfördelat lager. | Inför separata superadminläsningar för inköpskostnad, lager per butik och månadsräknare. Kör negativa åtkomstprov som handlaradmin och säljare mot API, PDF och CSV. |

### Affärsregler som behöver vara tydliga före aktivering

- **Befintliga annonser.** Ta en baslinje i pilotbutiken för annonser som redan skapats manuellt. Följ Blockets migrationsflöde och verifiera att befintlig annons matchas mot rätt `source_id` utan dubbel publicering eller ny kundavgift. Pro Import visar bara data som hanterats via API:t och kan därför inte ensamt användas som komplett räkning för tidigare manuella annonser.
- **Sen publiceringsbekräftelse.** Bestäm hur en annons som bekräftas efter månadsskiftet eller efter utträdet ska synas på fakturan. Nuvarande underlag använder första verifierade registrering. Hantera sena besked genom nästa öppna period eller granskad rättelse enligt beslutad regel. Blockets leverantörsfaktura kan ligga i en annan period.
- **Prisändringar och ny beställning.** Behåll accepterat pris vid tekniskt återförsök. Bestäm när handlaren får göra en ny beställning efter ett definitivt misslyckande eller efter återanslutning. Befintlig prisbindning kan behålla det gamla priset även efter ett avvisat jobb och en ny annonsversion.
- **Avgift i delmånad.** Bekräfta avtalad avgift, giltighetsdatum och om delmånaden ska räknas som hel eller proportioneras. Bestäm hur ett prisbyte mitt i samma månad påverkar den enda butiksavgiften och hur en differens mot Blockets faktura hanteras.

## 8. Första byggsteget

Superadmin → Företag → Blocketkoppling → Hantera butikernas annonsprogram. Migrationen skapar ett separat butiksregister med unika återförsäljarkoder och revisionshistorik per avtalsperiod. Vyn registrerar önskad start, bekräftad fakturastart, uppsägning, avtalsslut och Blockets fakturabyte. Den sparar separata kundpriser för Blocket och Bytbil, kundens månadsavgift med delmånadsregel och Trafexas interna kostnader. Beloppen registreras manuellt. Databasen kräver aktuell superadmin, bevarar gamla revisioner och förhindrar överlapp och överskrivning från inaktuella formulär.

Registreringen förbereder senare offert- och fakturakoppling. Den befintliga integrationen använder fortfarande sin företagsbundna API-konfiguration. En registrerad kod eller period verifierar därför varken kontobehörighet eller en ändring hos Blocket. Leverans, handlaroffert, månadsstatistik och fakturarader per butik återstår. Vyn registrerar avtalat slutdatum manuellt. Superadmin kan avbryta en väntande period före bekräftad fakturastart. Den avbrutna perioden bevaras i historiken och blockerar inte en ny ansökan. Automatisk uppsägningsberäkning återstår.
