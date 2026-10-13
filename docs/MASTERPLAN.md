# Trafexa Dealer – fortsättningsplan

Återhämtad och rekonstruerad arbetsplan • 13 oktober 2026

## Underlag och läsning

Detta dokument fortsätter originaluppdraget. Det är ett kodnära arbetsunderlag sammanställt från återhämtade planfragment, återhämtad Next.js-/Supabase-kod och bekräftade projektreferenser. Originalplanens 22 avsnitt är identifierade, men hela originaltexten har inte återhämtats. Fragmenten innehåller både version 1 och utdrag från version 2. Särskilt avsnitt 10–12, 16–17 och delar av version 2 har textluckor. Nedanstående sammanfattningar bevarar riktningen och markerar aktuella leveransgränser; de utger sig inte för att vara en fullständig kopia.

Återhämtad implementation kompletteras nu med finansåtkomst, reservationsutgång, CSV-import, kostnader och offertversion/PDF. Helheten är ännu under omverifiering i denna fortsättning. [IMPLEMENTATION_STATUS](IMPLEMENTATION_STATUS.md) skiljer källkod, historiska kontrollresultat, aktuell driftkontroll och nya verifieringsresultat; det dokumentet är källa för aktuella migrations- och releaseresultat.

## 1. Erbjudande och mål

Bygg ett sammanhängande arbetsflöde för bilhandlarens lager, kunder, affärer, dokument och leverans. Uppgifter om kund och bil ska kunna återanvändas i offert, avtal och ekonomiskt underlag. Finansiering och handel mellan handlare tillkommer med kontrollerade åtkomster och verifierade partners. Mät dubbelregistrering, tidsåtgång och genomförda affärer i pilot; priser, kreditutfall och provisionsintäkter är inte fastställda produktlöften.

## 2. Omfattning och första version

Första versionen är en responsiv webbtjänst med företagsisolerade data. Publik hemsida och handlarapp delar kodbas men har olika domänflöden. De återhämtade arbetsytorna är Översikt, Lager, Kunder, Affärer, Finansiering, Handlarnätverk, Dokument och Inställningar. Ekonomi tillkommer i sin fas. Ett synligt menyval räknas inte som en färdig modul.

## 3. Finansieringsmodell och ansvar

Systemkonto, deltagande i handlarnätverk och finanspartnerns produktgodkännande är separata tillstånd. Nuvarande kod registrerar endast finansintresse i Trafexa. Partnern ska äga kreditbeslut och bekräfta sina erbjudanden och utbetalningar. Partneravtal, verklig dokumentation, teståtkomst och ansvar för aktuell produkt behövs före aktivering. Ingen egen utlåning eller automatisk kreditbedömning ingår i återhämtad implementation.

## 4. Organisation och behörigheter

Den återhämtade databasen har företag, medlemskap och rollerna `owner`, `admin`, `sales`, `finance`, `viewer`. Aktuellt medlemskap kontrolleras i företagskontext och databasfunktioner. Gemensam verifierad företagskontext stoppar gamla/ogiltiga cookieval utan att tyst välja ett annat företag. Finans- och dokumentåtkomst har separata, skärpta rollregler. UI-behörigheter måste motsvaras av server- och databasregler. Filialer, personalinbjudningar, rolladministration och begränsad supportåtkomst är fortsatt arbete. Kontrollera åtkomst också vid avstängning under en befintlig session.

## 5. Anslutning av en handlare

Omverifiera registrering, bekräftelse, inloggning, återställning av lösenord, företagsregistrering och företagsväxling först. Därefter byggs personalinbjudan, organisationens granskningsstatus och dokumenterad partneranslutning. En aktiv användare får endast välja företag där ett aktivt medlemskap finns. Import av befintligt lager ska ha förhandsgranskning och tydliga radfel.

## 6. Fordonslager och inköp

Kodgrund: `vehicles`, `stock_items`, `vehicle_costs`, manuell registrering, sökning, statusfilter, prissortering och prisändring. Fortsättningen innehåller nu kostnadsregistrering och CSV-import med mappning, radfel, dubblettkontroll i hela företagets lager samt transaktionell och idempotent skrivning. Importen begränsas till 1 MiB och 500 fordon. Pengar lagras i ören och lagerpost skiljs från bilidentitet. Inköpsunderlag, bilder/skick, full kostnadsspårning och beräkning för VMB återstår; nuvarande kostnadsvy är inte fullständig bokföring.

## 7. Kundhantering och försäljningsaffär

Kodgrund: privata företagskundkort, affärsutkast, serverstyrd reservation och frigivning. CRM-intaget skapar kontakt och lead atomiskt, kräver e-post eller telefon och bevarar oförändrade återförsök med samma UUID i sju dagar. Kundförfrågningar laddas vid behov med 50 poster per sida; statusbyte kräver att tidigare status fortfarande matchar och endast statuskolumnen får ändras. Ägare/admin/säljare skriver, finans-/läsroller läser enligt företagsgränsen. Inga externa utskick sker.

Reservationens utgång frigör gammal affär och lagerpost vid nästa skapande/reservering; ingen scheduler är aktiv. Nya offertversioner lagrar serverhämtade företag-/kund-/biluppgifter, bekräftat bruttopris, villkor och giltighet med skydd mot dubbla återförsök. Historiken hämtas vid behov med sidindelning. Full kontaktlogg, kundaccept, inbyte och kontrollerad avbrytning återstår. Kundsynligt innehåll hålls isär från interna anteckningar och inköpskostnader.

## 8. Avtal och dokument

Kodgrund: dokumentmetadata, företagsanknutna objektvägar och privat dokumentbucket med skärpt rollgräns. Offert-PDF genereras nu separat från en oföränderlig serverlagrad offertversion och hämtas genom företags- och sessionskontrollerad route. Standardmoms visas utifrån uttryckligt bekräftat totalpris; VMB får inte presenteras som avdragsgill moms. Detta är en offert, inte ett signerat köpeavtal eller färdigt dokumentarkiv. Versionshanterad mallbyggare, kundaccept, signering, evidens och hämtning av arkiverade original återstår. DocuSeal och pdfme är kandidater från originalplanen; licensomfattning och vald integration behöver verifieras för användningen. BankID-identifikation är inte automatiskt dokumentunderskrift.

DocuSeals transport och signeringsdomänmodell från PR #3 finns nu i `src/lib/signing`, med en server-only-wrapper som alltid håller skapande avstängt. 32 beteendetester använder mockad providertransport. Ingen route, credentialinläsning, webhook-inbox, persistent ledger eller koppling till offert-PDF är aktiverad. [DOCUSEAL_INTEGRATION](DOCUSEAL_INTEGRATION.md) beskriver återstående fas 4-arbete. Sourcingtabellerna från PR #2 kopieras inte eftersom de överlappar befintlig företags-/medlemsmodell.

## 9. Köpfinansiering till slutkund

Nuvarande finansformulär sparar ett internt `intake`-ärende och utför ingen bankansökan. En framtida partneradapter behöver behörighet per företag, partner och produkt; idempotent ansökan; kompletteringar; erbjudande; giltighet; samt separat utbetalningsbesked. Ett godkänt kreditbeslut ska inte räknas som utbetalning. Manuell partnerprocess kan införas när kanalen och ansvarsfördelningen är bekräftade.

## 10. Lagerfinansiering

Rekonstruerat från återhämtade utdrag och fas 7: kreditfacilitet, partnerbekräftad limit, finansierad lagerpost, kostnadsprognos, lösen och frigivning får egna modeller. Interna prognoser ska särskiljas från partnerbekräftade belopp och tidpunkter. Nuvarande val `stock` i intresseformuläret utgör inte lagerfinansiering. Denna fas kan flyttas tidigare om första avtalade produkt är lagerfinansiering, med samma beroenden för betalning och leveransspärr.

## 11. Handel och matchning mellan handlare

Rekonstruerat från originalets innehållsförteckning, utdrag och fas 8. Handlaren publicerar uttryckligt utvalda fordonsuppgifter. Inköpsönskemål, matchning, förfrågningar, bud och B2B-reservation byggs med egen åtkomstmodell. Kunddata, interna anteckningar och inköpskostnader förblir privata. Nuvarande nätverksvy är information inför pilot, utan aktiv publicering eller matchning.

## 12. Ekonomi, betalning och leverans

Rekonstruerat från originalets utdrag och fas 6. Fakturaunderlag, betalning, avstämning, ekonomi-export och leveransprotokoll ska länkas till rätt affärsversion. Leverans villkoras av relevanta avtal, bekräftad betalning och eventuell lagerfrigivning. Moms-/VMB-referensfall och ägarbytesprocess behöver verksamhetsunderlag. Signering, fysisk leverans och ekonomisk avstämning har separata tillstånd.

## 13. Teknisk arkitektur

Fortsätt den återhämtade modulära Next.js-applikationen; undvik en strukturmigration innan grundflödet verifierats. `src/lib/data` innehåller serveråtgärder, företagskontext och validering; `src/lib/supabase` innehåller SSR-klienter och databastyper. Affärsregler körs på servern och i transaktionella RPC-funktioner.

Originalets föreslagna worker, domänpaket, integrationspaket och dokumentpaket är en framtida ansvarsfördelning. BullMQ/köbackend, DocuSeal-tjänst och Docling/OCR finns inte som driftade komponenter i den återhämtade kodbasen. Inför separat jobbdrift när faktisk import, dokumenthämtning eller synk kräver den.

Verifierade målresurser är `heke99/trafexa-auto`, Vercel-projekt `prj_zWks8Qd6m9ijWdu3tzid9RJlGgGE` i team `team_e3htkJPyBNSw3Ix1KQLlf180` samt Supabase `buqdtssxrotkzndublrt` i `eu-north-1`. Vercel-källkonfigurationen använder Next.js och `arn1`. Domänerna `trafexa.com`, `www.trafexa.com` och `app.trafexa.com` har verifierats i Vercel genom readback utan DNSändring. `trafexa.com` är publik och `app.trafexa.com` är handlarapp; faktiskt HTTP-flöde och auth-redirects kontrolleras vid lansering.

## 14. Datamodell och integritet

Återhämtat schema har UUID, `company_id`, sammansatta företagsreferenser, belopp som `bigint` i ören, reservationens unika aktiva lagerpost och auditlogg. Lagerstatus, affärsstatus och finansstatus är separata. Fortsatt modellarbete krävs för filialer, inköp/inbyte, dokumentversioner och evidens, utbetalning, kreditlimit, B2B-handel, fakturor och integrationens händelser. Planens föreslagna tabellnamn ska inte redovisas som redan skapade tabeller.

Utöver de tre återhämtade grundmigrationerna har fortsättningen applicerat finansåtkomst (`20261013151347`), reservationsutgång utan schemaläggning (`20261013151355`), lagerimport (`20261013152832`), offertversioner (`20261013154317`) och kundförfrågningar (`20261013160452`). Alla åtta migrationer har verifierats genom live-readback. Databastyper har fullständigt regenererats efter CRM-tillägget; typkontroll, 99 Node-beteenden, nio filsviter via `npm test`, sju SQL-rollbacksviter och produktionsbygge passerar. Lokal produktionsbrowser passerar 31 kontroller; samlad QA är 182/182 över utveckling, mockad UI-harness och lokal produktion. Autentiserad produktions-CRUD och remote release återstår. Exakta kommandon och täckningsgränser finns i statusprotokollet. Jämför alltid livehistorik med filinnehåll före fortsatt schemaarbete.

Schemaläggning är ett separat förslag i [proposals/reservation_expiry_schedule.sql](proposals/reservation_expiry_schedule.sql), utanför migrationskatalogen. Automatisk godkännandegranskning avvisade permanent `pg_cron` och minutvisa produktionsmutationer. Ingen scheduler är aktiv; befintlig utgång vid nästa relevant lageroperation fungerar utan detta förslag. Bakgrundsrensning behöver separat godkännande och verifiering före aktivering.

## 15. API och partnerintegrationer

Nuvarande publika route är `POST /api/demo-requests`; företagsmutationer använder Next-serveråtgärder och Supabase RPC. Ett framtida versionerat integrations-API är planerat, inte implementerat. Definiera validerade kontrakt, idempotens, sidindelning och konflikthantering när konsumenterna finns. Partneradapters byggs endast från verkliga kontrakt. Webhookmottagning måste kontrollera källa, konto och miljö samt tåla dubbletter och händelser i fel ordning. Utskick och bakgrundsarbete ska kunna återupptas utan dubbla affärshändelser.

## 16. Återanvändning av projekt och verktyg

Behåll låsta Next.js-/React-/Supabase-beroenden och befintlig lockfil. Originalplanen nämner kandidater för mallbyggare, signering, CSV, jobbkö och OCR; valet är inte en aktiv integration eller ett färdigt licensbeslut. Gör en avgränsad teknisk och licensmässig kontroll när respektive fas börjar. Agentarbete delas efter filer och ansvar; gemensam integration verifieras före färdigmarkering.

## 17. Säkerhet, dataskydd och driftkontroll

Kod och migrationer använder RLS, databaskontrollerat medlemskap, privata filer, auditlogg och begränsade skrivoperationer. Omverifiera två helt separata företag, främmande kund-/bil-/dokument-ID, läsroller, finansroller och avstängda medlemskap. Bevis för säkerhet kräver faktiska försök att läsa och mutera fel företags data. Auth- och appsvar ska förbli privata vid sessionsförnyelse. Demo-/pilotförfrågningar har separat privat lagring och begränsad skrivfunktion. Testmiljö och produktionsmiljö ska särskiljas när integrationer aktiveras.

## 18. Byggfaser och leveranskrav

Fasordningen nedan kommer från återhämtad originaltext. Varje fas avslutas med ett verifierat användarflöde och dess viktigaste fel- och avbrottsfall. Återhämtade tabeller eller skärmar innebär inte att fasen är klar.

| Fas | Konkret fortsättning | Leveranskrav |
|---|---|---|
| 0 – Produkt och partnerbeslut | Bekräfta pilotens arbetsflöden, MVP, första dokumentupplägg, ekonomi-export och faktiskt partnerunderlag. Bevara beslutet att ersätta gamla sajten i befintliga resurser. | Kända integrationsberoenden och ansvar; systemkonto, nätverk och finansgodkännande åtskilda. |
| 1 – Konton, grund och företagsisolering | Omverifiera återhämtad auth, företagskontext, RLS, lagring och audit. Komplettera inbjudningar, filialer och medlemsadministration. Återställ regressionstester och byggkontroller. | Två handlare kan arbeta isolerat; främmande ID och avstängd personal nekas; korrekta domän- och sessionsflöden. |
| 2 – Lager och import | Lagerkort, kostnader, bilder/skick, importmappning, förhandsgranskning och radresultat. | Pilotlager importeras och rättas utan dubbletter vid omkörning; belopp och underlag kan följas. |
| 3 – CRM, affär och reservation | Kontaktlogg, leads, offertversion/accept, inbyte, kontrollerad avbrytning och reservationsutgång. | Två samtidiga säljare får högst en giltig reservation; utgång och frigivning bevarar korrekt affärshistorik. |
| 4 – Avtal och signering | Mallversion, fältkoppling, PDF, privat filhämtning, vald signeringsadapter och återhämtning efter avbrott. | Exakt kund/bil/pris i rätt version; signerad fil och evidens bevaras; dubbla events ger inget dubbelt dokument. |
| 5 – Första köpfinanspartnern | Produktgodkännande, partneradapter, ansökan, komplettering, erbjudande och utbetalningsstatus. | Komplett partner-testärende samt avslag, timeout och utgånget erbjudande; kreditbeslut räknas inte som utbetalning. |
| 6 – Ekonomi och leverans | Fakturaunderlag, betalningsregistrering, avstämning, vald export, leveransprotokoll och ägarbytesuppgift. | Affär kan avslutas med spårbara dokument/belopp och uppfyllda leveransvillkor; omkörning skapar ingen oavsiktlig dubbelexport. |
| 7 – Lagerfinansiering | Kreditlimit, finansierat innehav, kostnadsprognos, avstämning, lösen och frigivning. | Finansierad bil kan följas från inköp till partnerbekräftad frigivning; B2B-affär behåller lösenkrav. |
| 8 – Handlarnätverk | Publicerade fordonsdata, inköpsönskemål, matchning, förfrågningar/bud och B2B-reservation. | Två handlare genomför ett kontrollerat flöde utan privat datadelning; inaktuellt lager tas ur aktiv matchning. |
| 9 – Pilot och kontrollerad lansering | Stegvis pilot med originalets mål 3–5 handlare, utbildning, incidentansvar, återställning och verifierad domänpublicering. | Kritiska flöden och driftsåterställning verifierade; varje handlare ser begränsningar och endast egna aktiverade funktioner. |
| 10 – Integrationer efter pilot | Prioritera fler partner-, annons-, fordonsdata- och ekonomi-adapters samt OCR/AI utifrån uppmätt behov. | Ny integration har underlag, ansvar, testflöde och återhämtningsprocess innan aktivering. |

Fas 7 kan tidigareläggas när den första avtalade produkten är lagerfinansiering. Konto-, betalnings- och leveransberoenden kvarstår. Lager och CRM kan byggas medan partnerunderlag saknas; kredit- och signeringsflöden aktiveras först när respektive underlag och verifiering finns.

### Nästa sammanhängande leverans

1. Frys den lokalt verifierade kodversionen för GitHubcommit och PR. Koppla Vercelpreview till den faktiska commiten i befintligt projekt; dokumentera först bekräftade releaseartefakter.
2. Verifiera previewns installation, byggning, fontpaketering, båda domänflöden och auth-callback. Behåll de åtta applicerade migrationsversionerna synkroniserade och cronförslaget utanför release-migrationerna tills separat godkännande finns.
3. Omverifiera ännu ej bevisat autentiserat browserflöde med två syntetiska företag: konto → företag → lagerimport/kostnad → kund/CRM → affär → reservation/utgång/frigivning → offertversion → PDF. UI-mockarna ersätter inte denna kontroll eller två samtidiga databasanslutningar.
4. Följ upp security-advisory om avstängt skydd mot läckta lösenord samt kvarstående finans-/dokument-/sessionsgränser i den avsedda driftsmiljön.
5. Publicera den granskade Next.js-grunden i det avsedda befintliga projektet när releasekontrollerna är genomförda och återkontrollera den publika sidan och appen. Dokumentera faktisk deployment, commit och kvarstående begränsningar i statusdokumentet.
6. Fortsätt nästa ofärdiga beroende i fas 1–3: personal/filialer, inköps- och bildunderlag, kontaktlogg, kundaccept och inbyte. Därefter dokumentfasens mallar/signering. Externa partnerbeslut får inte ersättas med simulerade aktiva integrationer.

## 19. Verifiering och kvalitet

Kör `npm run typecheck`, `npm test` och `npm run build` från en installation med `npm ci`. Kontrollera SQL-regressionerna för företagsisolering och privat lagring i avsedd testmiljö. Browserverifiering ska täcka lyckat flöde, fel, återförsök, formulärbevarande, mobilvy och tangentbordsåtkomst. Separata anslutningar behövs för att bevisa reservationskonkurrens. Tester för dokument, partnerhändelser, import, ekonomi och återställning tillkommer med respektive fas. Originalets historiska PASS ska inte återanvändas som bevis för den återhämtade branchen.

## 20. Pilot, drift och uppföljning

Starta med ett begränsat lager och syntetiska verifieringsfall före riktiga pilotaffärer. Följ tid att registrera bil och skapa affär, dubbla registreringar, fel, supporttid och avbrott. Mät verkliga partnerkostnader och integrationsnytta när tjänster ansluts. Ursprungliga prestandamål är verifieringsmål, inte utfästelser. Återställning ska bevara dokumentreferenser och affärshistorik; kodrollback återställer inte automatiskt databasen.

## 21. Beslut och utvecklingsärenden

Produktinriktning, repository och målresurser är identifierade. Kvarstående verksamhetsunderlag gäller pilotföretag, personalsätt, lagerimport, avtalsmallar, momsreferensfall, signeringsupplägg, första finansprodukt/partner och första ekonomi-export. Gör ärenden med avgränsad fil-/domänägare, beroenden, kontroll och status. Använd följande statusar: återhämtad, under verifiering, verifierad i angiven miljö, återstår, eller externt beroende. Ett repo med fungerande bygge är fortfarande en bygggrund när kompletta affärsflöden saknas.

## 22. Källor och återhämtningsspår

| Källa | Vad den stödjer |
|---|---|
| Originalchatt `01a13504-1d80-7611-92e8-9076ccf7605d`, användarturn `01a13554-497f-7729-abd7-e91341e8105c` | Användarens uttryckliga godkännande att ersätta gamla sajten och bygga i Trafexa Auto på GitHub/Vercel, med Supabase Trafexa Dealer. |
| Senare användarmeddelanden i samma chatt | Fyra parallella agenter och `app.trafexa.com` hos Strato. Denna fortsättning har återigen fått instruktion att fortsätta planen. |
| `trafexa-recovery.json`, `planFragments`, återhämtningsunderlag i sessionen | Fragment `exec-a4a6944c-0544-4cd3-99d8-ec2a0505b187` och `exec-a0772d20-f74f-416e-903c-a549ea0ffc92`: produkt och avsnitt 1–9, delvis avklippta. |
| Samma underlag | `exec-2ca51a78-eaef-459b-b968-a66630ca9fb2`: innehållsförteckning 1–22. `exec-bc6bb4b4-6e72-4427-b46f-6804e96ecf53`: fulla fas 0–10, verifierings- och pilotkrav. |
| Samma underlag | `exec-0d82a298-64d9-487e-a550-2ead4e6ea3c1`: arkitektur, dataintegritet och API. `exec-0e0c7285-45ce-4091-ad43-e2815c149be5`: version 2-utdrag, resurser och historisk status. |
| Återhämtat `src/`, `supabase/migrations/`, `supabase/tests/` | Den implementation och de databasregler som finns att omverifiera nu. |
| Livekontroll i fortsättningen, 13 oktober 2026 | Supabase-projekt `buqdtssxrotkzndublrt` är `ACTIVE_HEALTHY` i Stockholm; grundmigrationer samt finansåtkomst, reservationsutgång och lagerimport är bekräftat applicerade. Se status för aktuell lista. |

Originalets externa källista innehöll bland annat Supabase, Next/Vercel, DocuSeal, pdfme, BullMQ och myndighetsunderlag. Dessa är hänvisningar för kommande kontroll, inte bevis på aktuell aktivering, licensomfattning eller verksamhetsgodkännande. Den rekonstruerade planen tillför inga beslutade bank- eller signeringsavtal.
