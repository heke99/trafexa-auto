# Granskning av affärs- och avtalsstatus 14 november 2026

## Fel och förväntat beteende

Produktionskontrollen visade fyra affärer med grundstatus `draft`; en hade redan företagets och kundens verkliga underskrift. Kortet använde grundstatusen Utkast utan att läsa avtalsstatusen. Ingen affär, bil eller signatur ska skrivas om för att rätta visningen.

Den separata, serverberäknade `contractProgress`-projektionen används för både registret och översikten. Två hashmatchande underskrifter ger Signerat avtal även när ett senare osignerat dokument finns. Väntande signering och en utgången/återkallad länk hålls åtskilda från genomförd försäljning, betalning och leverans. Arkiverad, avbruten och avslutad affär behåller sin livscykelstatus. Reservationsstatus kan visas tillsammans med avtalsstatus. Okänd status visas som overifierad.

Stängda kort med väntande avtal läses om på synlig sida, vid fokus och med ett 15-sekundersintervall. Öppnade signeringsvyer rapporterar endast verifierade statusförändringar; listan hämtar därefter aktuell serverstatus. Samma företags- och sidomfattning behålls, och pågående formulär och osäkra skrivresultat ska inte försvinna. Översikten hämtar en begränsad företags-/aktörs-/rollbunden projektion och döljer arkiverade affärer.

Filtren beskriver den faktiska affärslivscykeln: en avslutad pappersaffär kallas inte levererad. Historiken visar Avtalsunderlag i stället för att kalla hela avtalet osignerat efter en underskrift. Ett uttryckligt osignerat käll-PDF kan fortfarande hämtas separat från det signerade dokumentet.

## Relaterad PDF-kontroll

Befintlig nedladdningsrutt försökte redan färdigställa saknade signerade PDF-/evidensfiler. Den möjligheten bevaras. I det sällsynta fallet med sparade underskrifter men saknad dokumentartefakt kan handlaren nu förbereda nedladdningen uttryckligen. Aktuell behörighet kontrolleras efter rendering och före varje oföränderlig lagringsskrivning. Saknat eller skadat original, skadat befintligt arkiv och återkallad åtkomst ger inga påhittade eller ersatta filer. Återhämtningen skickar inget mejl och skapar inga nya underskrifter.

## Verifiering och utrullning

Riktad regression omfattar 26 berörda kanoniska testfiler och 306 godkända unika fall, utan överhoppade fall. Efter härdningen ersätter sista per-filomkörningen det tidigare resultatet utan dubbelräkning. Bland annat ingår 30 kompletta föräldraflöden, 26 direktavtalsprov, 16 PDF-browserprov och 8 verkliga SQL-/lagringsprov för dokumentåterhämtning. Normalt produktionsbygge och typkontroll passerar. Sena lässvar och två efterföljande skyddade operationer provas uttryckligen. Resultaten från tidigare breda regressionen om 2 209 fall redovisas separat i föregående etapprapport och räknas inte som en ny helkörning här. Båda databasändringarna granskades mot den tidigare appen 0bfe243: äldre registerparser ignorerar det extra statusfältet, status-/filter-/cursor-/räknarformaten är oförändrade, det nya batch-RPC:t används inte av den äldre appen och PDF-JSON behåller samma nycklar och tillåtna statusvärden. Därför kunde den bakåtkompatibla DDL:n tillämpas före apppubliceringen, med faktiska hosted-versionsnummer direkt i denna PR. Ingen övergångsperiod med saknat RPC krävs.


## Tillämpad databas och verklig affär

- `20261114104009_deal_contract_register_progress.sql`
- `20261114104027_uploaded_pdf_historical_completion.sql`

Efterkontrollen visar fyra oförändrade affärer. Den verkligt signerade affären får nu `contractProgress.status=completed`, `companySigned=true` och `customerSigned=true`, med den ursprungliga signeringstiden. Tre övriga affärer saknar avtal och får `none`. Grundstatus, bilstatus, underskrifter och deras kontrollvärden är oförändrade; ingen produktionsdata skrevs om för visningsrättningen. Det nya publika läs-RPC:t saknar anonym exekveringsrätt. Ingen ny verklig affär, underskrift eller mejlleverans skapades som test.

Avbruten PDF-affär utan tidigare genererat arkiv kan fortfarande inte färdigställa ett nytt arkiv under befintlig annulleringspolicy. Sparade underskrifter visas historiskt korrekt och befintliga original kan hämtas av behörig handlare; gästspärrar kvarstår. Denna rättning kringgår inte annullering för att skapa nya dokument.
