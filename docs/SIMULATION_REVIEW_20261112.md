# Sammanhängande simulering och UI-granskning – 12 november 2026

## Bedömning

De simulerade resorna fungerar inom nedan angivna gränser. Fyra konkreta fel har rättats: kalkylens åtkomstförlust, navigation under en Blocketändring, fontberoende mobilbredd och osynlig återkoppling vid nekad signering. Detta är inte ett godkännande av samtliga produktionsintegrationer.

Bas: publicerad main `32add2dfe75ab1e11c1c7ebfb64665f7e2bfb950`. Isolerad kandidat i `/workspace/trafexa-simulation`, Node 24, Chromium 153. Ingen riktig kunddata, produktionstransaktion, e-post, bank- eller partnerpublicering användes i denna simulering. Tidigare mottagna diagnostikmejl ersätter inte en mottagen produktionsinbjudan i detta prov.

## Utförda resor

| Område | Utfall och verklig gräns |
| --- | --- |
| Ansökan → superadmin → inbjudan → aktivering → företag/butik → kund/team | Sju integrerade kontrollpunkter PASS; faktisk API, actions och migrerad SQL. Auth, mailtransport och företagsval anpassade. 83 komponentbrowserfall och tio extra viewportfall PASS. [Detaljer](SIMULATION_ACCOUNTS_20261112.md). |
| Offert → kund- och handlarunderskrift → PDF/bevis → arkiv → utgången länk | 4/4 resor PASS: båda signeringsordningarna vid 320/1440 px. Browser, lokal HTTP, faktiska actions, SQL, PDF-renderare och bytekontroll; RSC/extern Auth/Storage/SMTP ersatta. [Detaljer](CONTRACT_CUSTOMER_SIMULATION_20261112.md). |
| Lager → kostnad → moms → accepterat annonspris → unik publicering → faktura → betalning → kredit | Åtta kontrollpunkter PASS. Faktiska actions/SQL/renderare. Partnercallback och bankreferenser syntetiska; ingen banköverföring, återbetalning eller extern annons. |
| Publika sidor och demo | 48 sid-/viewportkombinationer vid 320/390/1440 px: 45 dokument-GET med HTTP 200 och tre ankarnavigationer. Inga pageerrors, HTTP 5xx eller dokumentbredder över viewport. Faktisk lokal produktionsbyggd Next; externa anrop och mutationer blockerade. Demo bevisar inte en inloggad produktionsresa. |
| Alternativa systemtypsnitt | Sex kontroller: startsida/integritet × DejaVu Serif/DejaVu Sans/Times New Roman vid 320 px. Efter rättning samtliga dokumentbredder 320 px. |

## Rättade fel

- **F04:** sparande/läsning med återkallad eller oförenlig behörighet får en uttrycklig felkod. Kalkylen rensar belopp/momsfält vid ett obekräftat underlag och blockerar synkrona dubbla sparningar. Felaktiga inmatningar kan fortfarande rättas utan förlorat formulär. Förälderns kostnadsrensning används också vid uttryckligt nekad kalkylåtkomst.
- **F05:** adminytan behåller aktuell vy under Blocketskrivning **och efterläsning av kvittot**. Adminytans egna navigeringsknappar och annonsprogramslänk blockeras tills resultatet verifierats. Två nya parent/child-regressioner vid 320/1440 px; admin-UI 57/57 och Blocket-UI 8/8 PASS före samlad slutregression.
- **F09:** DejaVu Serif gav tidigare startsida 327 px och integritet 364 px på en 320 px skärm. Finansgridens kolumner/barn får krympa och långa rubriker bryts. Inget innehåll döljs med overflow-hidden.
- **F13:** ett serveravvisat signeringsnamn visade felet ovanför synlig skärm. Felrutan får nu fokus; regressionen kräver både tangentbordsfokus och faktisk synlighet efter eventuell mjuk scroll. Namnet bevaras för korrigering.

## Visuell granskning

Öppnade skärmbilder omfattar startsida, integritet, lager, inställningar, annonseringsdemo, företagsgranskning, färdigsignerat kundavtal och affärsvyn. Mobilens innehåll och huvudknappar är läsbara. Affärsvyn på dator är fortfarande tät med många parallella paneler; samla steg och låt användaren öppna detaljer efter behov i en separat UI-förbättring. Företagsgranskningens förklaringar kan också kortas.

Annonsdemon är en avsiktlig informationsvy och användes inte för att bedöma riktig annonsredigering. Layout-/DOM-prov av övriga sidor är inte samma sak som att varje skärmbild har bedömts visuellt.

## Återstående gränser och tidigare öppna fynd

Ingen riktig autentiserad Next-produktionsresa, native PostgreSQL-samtidighet, kundens mottagna avtalsmejl, partnerbekräftad Blocket/Wayke-publicering, bankkoppling eller separat backupdestination verifierades här. Ingen juridisk efterlevnadscertifiering görs.

Äldre rapporters F01–F03 (annonsprogrammets formulär-/transport-/kvittoåterhämtning), F06 (butiksspecifika programpriser genom fakturering), F07 (flera externa butiker/avpublicering), F08 (driftskö/flaggor) och explicit spärrad inbytesleverans är inte avslutade av dessa rättningar. F08:s nuvarande driftstatus har inte kontrollerats om här. Företagstaxeringens godkända prov innebär inte att F06 är löst. F10–F12 är redan rättade i basversionen; deras gränser återprovas där aktuellt.

## Slutkontroller

**1 999/1 999 fall PASS**, 218 befintliga testfiler, 0 fail/skip och inga saknade fallantal. Varje flat testfil kördes direkt i en egen Node-process, tre filer parallellt; 425,01 sekunder. Resultatet inkluderar de uppdaterade kalkyl-/parent-/signeringsregressionerna. `npm run typecheck`, `npm run build` och `git diff --check` PASS. Slutbygget krypkördes på nytt: 48 sid-/viewportprov och sex typsnittsprov PASS. [Maskinläsbart testutfall och källhashar](verification/20261112-simulation/full-regression.json). Källändringarna publiceras som en separat granskningsbar PR; denna simulering ändrar inte produktion eller databas.
