# Trafexa Dealer – fortsättningsplan

Återhämtad och rekonstruerad arbetsplan • 13 oktober 2026

Kontofortsättning 14 oktober: aktiv privat UUID-superadmin landar direkt i administrationen. Alla övriga nya/befintliga konton utan privat godkännande väntar på ett granskat superadminbeslut; spärren gäller även kundofferter, företagsinbjudningar och direkt RPC/RLS/Storage. Företagsroll och verifierad e-post ger inte i sig systemåtkomst. Se [ACCOUNT_APPROVAL_CONTRACT](ACCOUNT_APPROVAL_CONTRACT.md).

Superadminfortsättning 14 oktober: plattformsöversikt med faktiska totalsiffror och sju dagars aktivitet är implementerad. Appens kontomejlredirect är bunden till produktionsdomänen; sex svenska mejlmallar är förberedda. Hosted Auth URL-konfiguration och mallar kräver separat aktivering enligt [AUTH_EMAIL_SETUP](AUTH_EMAIL_SETUP.md).

CRM-fortsättning 14 oktober: kontaktlogg och företagsgemensamma uppföljningar är implementerade med datumordning, privata anteckningar och granskad statusändring. Kundens granskning och accept/avböjande av en uttryckligen tillgängliggjord offertversion är också implementerade. Kontrollerad avbrytning av utkast/reservationer är implementerad. Internt versionsbundet inbytesunderlag och dess granskade koppling till en ny offertversion, kundvy och PDF är implementerade; faktiskt inbytesköp/avtal är nästa affärsdel; kontaktlogg är inte ett avtal, kreditbeslut eller automatiskt meddelande. Se [aktuella verifieringsresultat](IMPLEMENTATION_STATUS.md).

Fortsättning 14 oktober: obligatorisk webbansökan, superadminens privata ärendehandläggning med status/radering samt integritets- och cookieinformation är implementerade. Ansökan är ett intag till Trafexa och medför inget automatiskt konto, kreditbeslut eller partnerutskick. Företagets dataskyddsrutiner och leverantörsavtal följs separat enligt [WEB_PRIVACY_OPERATIONS](WEB_PRIVACY_OPERATIONS.md); faktisk kod-, databas- och releaseverifiering finns i [IMPLEMENTATION_STATUS](IMPLEMENTATION_STATUS.md).

## Underlag och läsning

Detta dokument fortsätter originaluppdraget. Det är ett kodnära arbetsunderlag sammanställt från återhämtade planfragment, återhämtad Next.js-/Supabase-kod och bekräftade projektreferenser. Originalplanens 22 avsnitt är identifierade, men hela originaltexten har inte återhämtats. Fragmenten innehåller både version 1 och utdrag från version 2. Särskilt avsnitt 10–12, 16–17 och delar av version 2 har textluckor. Nedanstående sammanfattningar bevarar riktningen och markerar aktuella leveransgränser; de utger sig inte för att vara en fullständig kopia.

Återhämtad implementation har kompletterats med finansåtkomst, reservationsutgång, CSV-import, kostnader, offertversion/PDF, privat offertarkiv och personaladministration. Den aktuella fortsättningen från main `0604605` implementerar Annonskonto, privata fordonsbilder och exakt fordonskalkyl. Externa annonskanaler är förberedda och fortsatt inaktiva eftersom partneråtkomst saknas; interna funktioner och provideraktivering verifieras separat. [IMPLEMENTATION_STATUS](IMPLEMENTATION_STATUS.md) skiljer källkod, historiska kontrollresultat, aktuell driftkontroll och nya verifieringsresultat; det dokumentet är källa för aktuella migrations- och releaseresultat.

## 1. Erbjudande och mål

Bygg ett sammanhängande arbetsflöde för bilhandlarens lager, kunder, affärer, dokument och leverans. Uppgifter om kund och bil ska kunna återanvändas i offert, avtal och ekonomiskt underlag. Finansiering och handel mellan handlare tillkommer med kontrollerade åtkomster och verifierade partners. Mät dubbelregistrering, tidsåtgång och genomförda affärer i pilot; priser, kreditutfall och provisionsintäkter är inte fastställda produktlöften.

## 2. Omfattning och första version

Första versionen är en responsiv webbtjänst med företagsisolerade data. Publik hemsida och handlarapp delar kodbas men har olika domänflöden. De återhämtade arbetsytorna är Översikt, Lager, Kunder, Affärer, Finansiering, Handlarnätverk, Dokument, Annonskonto och Inställningar. Ekonomi tillkommer i sin fas. Ett synligt menyval räknas inte som en färdig modul.

## 3. Finansieringsmodell och ansvar

Systemkonto, deltagande i handlarnätverk och finanspartnerns produktgodkännande är separata tillstånd. Nuvarande kod registrerar endast finansintresse i Trafexa. Partnern ska äga kreditbeslut och bekräfta sina erbjudanden och utbetalningar. Partneravtal, verklig dokumentation, teståtkomst och ansvar för aktuell produkt behövs före aktivering. Ingen egen utlåning eller automatisk kreditbedömning ingår i återhämtad implementation.

## 4. Organisation och behörigheter

Den återhämtade databasen har företag, medlemskap och rollerna `owner`, `admin`, `sales`, `finance`, `viewer`. Aktuellt medlemskap kontrolleras i företagskontext och databasfunktioner. Gemensam verifierad företagskontext stoppar gamla/ogiltiga cookieval utan att tyst välja ett annat företag. Finans- och dokumentåtkomst har separata, skärpta rollregler. UI-behörigheter måste motsvaras av server- och databasregler. Personalinbjudningar och rolladministration finns nu med verifierad mottagaradress, versionskontroll och skyddade ägarroller; se [COMPANY_TEAM](COMPANY_TEAM.md). Plattformsadministration är separat och finns genom [PLATFORM_ADMIN](PLATFORM_ADMIN.md). Filialer, ägaröverlåtelse och begränsad supportåtkomst återstår. Kontrollera åtkomst också vid avstängning under en befintlig session.

## 5. Anslutning av en handlare

Omverifiera registrering, bekräftelse, inloggning, återställning av lösenord, företagsregistrering och företagsväxling först. Personalinbjudan använder en privat adressbunden inbjudan med sju dagars giltighet, manuellt delad generisk länk och uttrycklig accept efter verifierad autentisering. Organisationens granskningsstatus och dokumenterad partneranslutning återstår. En aktiv användare får endast välja företag där ett aktivt medlemskap finns. Import av befintligt lager ska ha förhandsgranskning och tydliga radfel.

Återställningsförfrågan visar villkorlig framgång först när `resetPasswordForEmail` returnerar utan SDK-fel. SDK-/klient-/nätverksfel får samma generiska feltext och ogiltig e-post stoppas före provideranrop. Fem isolerade regressioner har passerat med mockad autentisering; inga verkliga authmejl skickades.

## 6. Fordonslager och inköp

Kodgrund: `vehicles`, `stock_items`, `vehicle_costs`, manuell registrering, sökning, statusfilter, prissortering och prisändring. Fortsättningen innehåller nu kostnadsregistrering och CSV-import med mappning, radfel, dubblettkontroll i hela företagets lager samt transaktionell och idempotent skrivning. Importen begränsas till 1 MiB och 500 fordon. Pengar lagras i ören och lagerpost skiljs från bilidentitet. Privata fordonsbilder och fordonskalkyl är nu implementerade. Bildflödet accepterar JPEG/PNG/WebP, högst 10 MiB och 20 bilder per bil, med faktisk avkodning, orienteringsnormalisering och återkodning utan metadata. Kalkylen använder exakta heltalsören, bekräftade avdragsunderlag och individuell VMB på positiv försäljning-minus-inköp; övriga kostnader minskar inte VMB-marginalen. Resultat efter moms utelämnas om nödvändigt underlag saknas. Inköpsdokument, full skickbedömning och bokföringsavstämning återstår; fordonskalkylen är inte fullständig bokföring.

### Annonskonto och kanalleverans

Den interna modulen skapar annonsutkast från en faktisk lagerbil, serverhämtat försäljningspris och uttryckligt valda foton. Titel, beskrivning, fordonsuppgifter, registreringsnummeropt-in och bildordning sparas i en oföränderlig version. VIN, inköpspriser, kostnader och kunduppgifter ingår inte. Användaren granskar exakt version och bekräftar valda kanaler. Utkast, klar annonsversion, köat jobb, inskickat och verifierat publicerat hålls åtskilda. Okända nätverksutfall bevarar begärans-ID och kan inte starta blind omsändning.

Blocket/Wayke-anslutningar är förberedda, inte aktiverade. Ägare/admin kan ange en icke-hemlig extern kontoreferens och spara en anslutningsförfrågan; det ger inte partneråtkomst eller publicering. Färsk verifierad konto-/dispatcherbindning krävs innan jobb kan köas. Blocketprototypen har dessutom en konservativ version-1-spärr som också stoppar det verkliga första klarmarkerade utkastets version 2: separat beständig leveransrevision, CREATE/UPDATE-kontrakt och request-korrelerat publiceringsbevis måste införas före aktivering. Waykes skriv-/mediekontrakt återstår. Se [ADVERTISING_INTEGRATIONS](ADVERTISING_INTEGRATIONS.md).

Originalbilder ligger i den privata bucketen `ads-vehicle-photos`. Ett lyckat objektuppladdningsanrop följt av nekad/okänd SQL-registrering kan lämna ett privat orphan-objekt. Ingen användar-DELETE eller automatisk städning är aktiverad, för att undvika register/delete-race och bevara exakt återförsök. Fotoarkivering tar bort bilden från nya val utan att radera äldre annonsversioners underlag. Driftägaren behöver en uttrycklig retention-/avstämningsrutin före produktionsdrift i större omfattning.

Extern export har en implementerad, avstängd serverbridge i `src/lib/vehicle-photos/export-media.ts` och separat privat `ads-export-media`. Bridgen hämtar faktiska originalbytes, avkodar/normaliserar i samma format, laddar upp utan overwrite till `companyId/stockId/photoId/sha256.extension` och återläser med SHA-256-kontroll. Båda bucketarna kontrolleras som privata före lagring och länkutfärdande. Standardgiltigheten är 48 timmar (konfigurationsgräns två till sju dygn); minst 24 timmar ska återstå vid överlämning. Detta är en lokal säkerhetsnivå som behöver bekräftas med partnerns faktiska asynkrona bildhämtning. Originalobjekt signeras inte direkt för export. Normalisering behåller bildformat; WebP blir inte automatiskt JPEG och spärras därför för Blocket. Bridgen är avstängd som standard och kräver injicerad betrodd serverklient samt uttrycklig aktivering. Ingen exportpipeline, verkliga partnerlänkar eller workerdrift är aktiverad i denna leverans. Exportobjekt saknar automatisk städning; länkens utgång innebär ingen filradering.

## 7. Kundhantering och försäljningsaffär

Kodgrund: privata företagskundkort, affärsutkast, serverstyrd reservation och frigivning. CRM-intaget skapar kontakt och lead atomiskt, kräver e-post eller telefon och bevarar oförändrade återförsök med samma UUID i sju dagar. Kundförfrågningar laddas vid behov med 50 poster per sida; statusbyte kräver att tidigare status fortfarande matchar och endast statuskolumnen får ändras. Ägare/admin/säljare skriver, finans-/läsroller läser enligt företagsgränsen. Inga externa utskick sker.

Reservationens utgång frigör gammal affär och lagerpost vid nästa skapande/reservering; ingen scheduler är aktiv. Nya offertversioner lagrar serverhämtade företag-/kund-/biluppgifter, bekräftat bruttopris, villkor och giltighet med skydd mot dubbla återförsök. Historiken hämtas vid behov med sidindelning. Kontaktlogg, kunduppföljningar och kundens offertgranskning/svar är implementerade. Kontrollerad avbrytning är implementerad; internt inbytesunderlag är implementerat, faktiskt inbytesköp/avtal återstår. Kundsynligt innehåll hålls isär från interna anteckningar och inköpskostnader.

## 8. Avtal och dokument

Kodgrund: dokumentmetadata, företagsanknutna objektvägar och privat dokumentbucket med skärpt rollgräns. Offert-PDF genereras nu separat från en oföränderlig serverlagrad offertversion och hämtas genom företags- och sessionskontrollerad route. Standardmoms visas utifrån uttryckligt bekräftat totalpris; VMB får inte presenteras som avdragsgill moms. Detta är en offert, inte ett signerat köpeavtal eller färdigt dokumentarkiv. Kundens offertgranskning och svar är implementerade separat från signering. Versionshanterad mallbyggare, signering, signeringsevidens och hämtning av arkiverade original återstår. DocuSeal och pdfme är kandidater från originalplanen; licensomfattning och vald integration behöver verifieras för användningen. BankID-identifikation är inte automatiskt dokumentunderskrift.

DocuSeals transport och signeringsdomänmodell från PR #3 finns nu i `src/lib/signing`, med en server-only-wrapper som alltid håller skapande avstängt. 32 beteendetester använder mockad providertransport. Ingen route, credentialinläsning, webhook-inbox, persistent ledger eller koppling till offert-PDF är aktiverad. [DOCUSEAL_INTEGRATION](DOCUSEAL_INTEGRATION.md) beskriver återstående fas 4-arbete. Sourcingtabellerna från PR #2 kopieras inte eftersom de överlappar befintlig företags-/medlemsmodell.

## 9. Köpfinansiering till slutkund

Nuvarande finansformulär sparar ett internt `intake`-ärende och utför ingen bankansökan. En framtida partneradapter behöver behörighet per företag, partner och produkt; idempotent ansökan; kompletteringar; erbjudande; giltighet; samt separat utbetalningsbesked. Ett godkänt kreditbeslut ska inte räknas som utbetalning. Manuell partnerprocess kan införas när kanalen och ansvarsfördelningen är bekräftade.

## 10. Lagerfinansiering

Rekonstruerat från återhämtade utdrag och fas 7: kreditfacilitet, partnerbekräftad limit, finansierad lagerpost, kostnadsprognos, lösen och frigivning får egna modeller. Interna prognoser ska särskiljas från partnerbekräftade belopp och tidpunkter. Nuvarande val `stock` i intresseformuläret utgör inte lagerfinansiering. Denna fas kan flyttas tidigare om första avtalade produkt är lagerfinansiering, med samma beroenden för betalning och leveransspärr.

## 11. Handel och matchning mellan handlare

Rekonstruerat från originalets innehållsförteckning, utdrag och fas 8. Handlaren publicerar uttryckligt utvalda fordonsuppgifter. Inköpsönskemål, matchning, förfrågningar, bud och B2B-reservation byggs med egen åtkomstmodell. Kunddata, interna anteckningar och inköpskostnader förblir privata. Nuvarande nätverksvy är information inför pilot, utan aktiv publicering eller matchning.

## 12. Ekonomi, betalning och leverans

Rekonstruerat från originalets utdrag och fas 6. Fakturaunderlag, betalning, avstämning, ekonomi-export och leveransprotokoll ska länkas till rätt affärsversion. Leverans villkoras av relevanta avtal, bekräftad betalning och eventuell lagerfrigivning. Individuell fordonskalkyl för vanlig moms/VMB har införts med exakta belopp och explicit underlagskontroll. Full bokföring, momsredovisning, förenklad VMB och ägarbytesprocess behöver separata kontrakt och verksamhetsunderlag. Signering, fysisk leverans och ekonomisk avstämning har separata tillstånd.

## 13. Teknisk arkitektur

Fortsätt den återhämtade modulära Next.js-applikationen; undvik en strukturmigration innan grundflödet verifierats. `src/lib/data` innehåller serveråtgärder, företagskontext och validering; `src/lib/supabase` innehåller SSR-klienter och databastyper. Affärsregler körs på servern och i transaktionella RPC-funktioner.

Originalets föreslagna worker, domänpaket, integrationspaket och dokumentpaket är en framtida ansvarsfördelning. BullMQ/köbackend, DocuSeal-tjänst och Docling/OCR finns inte som driftade komponenter i den återhämtade kodbasen. Inför separat jobbdrift när faktisk import, dokumenthämtning eller synk kräver den.

Verifierade målresurser är `heke99/trafexa-auto`, Vercel-projekt `prj_zWks8Qd6m9ijWdu3tzid9RJlGgGE` i team `team_e3htkJPyBNSw3Ix1KQLlf180` samt Supabase `buqdtssxrotkzndublrt` i `eu-north-1`. Vercel-källkonfigurationen använder Next.js och `arn1`. Domänerna `trafexa.com`, `www.trafexa.com` och `app.trafexa.com` har verifierats i Vercel genom readback utan DNSändring. `trafexa.com` är publik och `app.trafexa.com` är handlarapp; faktiskt HTTP-flöde och auth-redirects kontrolleras vid lansering.

[Draft-PR #4](https://github.com/heke99/trafexa-auto/pull/4) på fortsättningsbranchen har en historiskt verifierad [preview](https://trafexa-auto-304mxzp8h-div3rsa.vercel.app), deployment `dpl_GveGscnZV3szkXC3xwgYKJNbtkst`, status `READY` i rätt projekt/team och region `arn1`. Den gäller commit `cf953d4078c047efefe3da1674a989ad571eea52` och tree `a204d647a4d81fa5d6f26f67c57165afa3ac1d0c`, verifierade vid publiceringen av checkpointen. Byggloggen bekräftar `npm ci`, 73 installerade paket på sex sekunder och därefter `npm run build`. Skyddad fetch gav 200 för lagerdemo, kunddemo/CRM och login. Dessa previewbevis skapades före main-mergen och gäller respektive commit.

PR #4 är därefter faktiskt mergad till `main` enligt användarens instruktion ”fortsätt då och lägg in det på main”. Verifierad main-checkpoint är `db7143cd633a2cee07457295fac8a75132e7352d`, tree `c12c75a8ce303aa7c26428334ad40dc7f00fe3b1`, identisk med den testade implementationen `403776131d3680e6f42aee566627fc2f9ab7f976`. Historisk produktionsdeployment `dpl_8Z69TvzBVQVeVeKDwrUfAYjJUzWY` är verifierad `READY`, target `production`, för denna commit/tree i rätt projekt och `arn1`: [deployment](https://trafexa-auto-6uva9o390-div3rsa.vercel.app). Native readback gav `www.trafexa.com/` 200 med ”Mer bilaffär. Mindre administration.” och `app.trafexa.com/login` 200 med ”Välkommen tillbaka.”, båda med exakt deployment-ID. `trafexa.com/` gav verifierad 308 till `https://www.trafexa.com/`. Inga verkliga authmejl skickades; full auth och remote CRUD återstår.

Historisk main-checkpoint efter [PR #5](https://github.com/heke99/trafexa-auto/pull/5) är `7fc833f643a488b8af34bb950df22769e99be32b`, tree `89d9774a25c13f3197c5b9d09668baa05dbbe50f`. Produktion `dpl_6vcexX8f1Jw5mWPyYLzpFSd6g1sS` är `READY`, target `production`, rätt projekt/`arn1` och alias app/www/apex: [deployment](https://trafexa-auto-h8cvlrqe0-div3rsa.vercel.app). Native lagerdemo gav 200, ”Fordonslager” och exakt detta deployment-ID. Extern browseranslutning blockerades med CONNECT 403 före appkontroller: noll genomförda checks. Färsk rootkörning av denna main passerar 137/137 beteenden och produktionsbygge inklusive TypeScript, 14 sidor och ny dokument-PDF-route. Fonttrace PASS omfattar offert-PDF, demo- och dealer-page samt nya archive-actionens användning. Sex lokala Chromium-harnessfall ingår i totalsviten och är inte extern produktionsbrowser.

Vid PR #5 bekräftade livekontrollen åtta applicerade migrationer. PR #5:s två nya lokala migrationer är inte hosted-applicerade och servicekey för ny arkivregistrering saknas. Signeringsprovider och workerdispatch förblir tvingat `enabled:false`; hosted arkivering/signering är inte aktiverad. PR #5:s egna integrationsunderlag och verifieringar bevaras separat och testsummorna adderas inte som unika fall.

Lokal setup och aktuell källkonfiguration använder Node.js `24.x`; verifieringsmaskinen kör `24.19.0`. Låsningen i manifest/lockfil ingår i verifierad checkpoint `69ed849af1afe19c1c637f71940ec70384f1ce46`, deployment `dpl_EgM71HipZpPg2XVMzxefqFzt6vTx`, [preview](https://trafexa-auto-qv9b55c4h-div3rsa.vercel.app), `READY` i rätt projekt/team och `arn1`. Lager- och kunddemo gav 200 med förväntat gränssnitt. Efterföljande pushar följs i PR #4 och Vercelstatus med respektive commit.

Även checkpoint `aed26dff099fc552687c29182d9a895da28ddd28`, tree `b36d0d668c9365df592001ffbd980b31ec28dd4a`, deployment `dpl_62td1ULZfX4FVG8WxrepwNvUrerC` och [preview](https://trafexa-auto-cvhiuxi96-div3rsa.vercel.app) är historiskt verifierad `READY`. Readback matchar projekt/commit/`arn1`; lager- och kunddemo gav 200 med deployment-ID. Den senare authfixen ingår inte i denna checkpoints resultat.

## 14. Datamodell och integritet

Återhämtat schema har UUID, `company_id`, sammansatta företagsreferenser, belopp som `bigint` i ören, reservationens unika aktiva lagerpost och auditlogg. Lagerstatus, affärsstatus och finansstatus är separata. Fortsatt modellarbete krävs för filialer, inköp/inbyte, dokumentversioner och evidens, utbetalning, kreditlimit, B2B-handel, fakturor och integrationens händelser. Planens föreslagna tabellnamn ska inte redovisas som redan skapade tabeller.

Utöver de tre återhämtade grundmigrationerna har fortsättningen applicerat finansåtkomst (`20261013151347`), reservationsutgång utan schemaläggning (`20261013151355`), lagerimport (`20261013152832`), offertversioner (`20261013154317`) och kundförfrågningar (`20261013160452`). Dessa åtta migrationer har verifierats genom live-readback. Därefter har plattformsadmin (`20261013184149`) och personal/inbjudningar (`20261013192237`) applicerats; tio versioner fanns i hosted historik vid personalcheckpointen. Därefter är `20261013212215_vehicle_calculations` och `20261013212229_advertising` applicerade enligt samordnarens verifierade readback. Privata bild-/exportbucketar, noll verifierade kanalanslutningar och noll dispatchers är bekräftade; aktuell appdeployment verifieras separat. Personalflödets 210 appbeteenden, 13 databastestgrupper och hosted rollbacktest passerar separat. Databastyper har fullständigt regenererats efter CRM-tillägget. PR #4:s 107 beteenden, elva `npm test`-filsviter, sju live-SQL-rollbacksviter och PDF-fonttrace är historiskt verifierade. Den historiska main-checkpointen efter PR #5 har separat färsk 137/137-/byggverifiering ovan; testsummor summeras inte som unika fall. De sista korrigeringarna bevarar ören, tillåter endast den specifika branch-preview-originen och hanterar återställningens SDK-/klient-/nätverksfel; fem mockade authregressioner skickar inga verkliga mejl. Historisk lokal produktionsbrowser passerade 31 kontroller och samlad QA 182/182; de resultaten är inte en ny omkörning efter slutfixarna. Produktion för historisk main-checkpoint `db7143` och historisk `7fc833f` är verifierad; full auth och autentiserad remote-CRUD återstår. Exakta kommandon och täckningsgränser finns i statusprotokollet.

Schemaläggning är ett separat förslag i [proposals/reservation_expiry_schedule.sql](proposals/reservation_expiry_schedule.sql), utanför migrationskatalogen. Automatisk godkännandegranskning avvisade permanent `pg_cron` och minutvisa produktionsmutationer och avvisade ett andra försök eftersom main-instruktionen inte tydligt godkände det separata minutjobbet. En ny explicit godkännandefråga är obesvarad; ingen förändring är applicerad och livekontroll efter avslag bekräftar `pg_cron_exists = false`. Ingen scheduler är aktiv och befintlig utgång vid nästa relevant lageroperation fungerar utan detta förslag.

## 15. API och partnerintegrationer

Nuvarande publika route är `POST /api/demo-requests`; ursprungskontrollen tillåter den specifika `VERCEL_BRANCH_URL`-originen och nekar andra Vercelhosts med 403. Företagsmutationer använder Next-serveråtgärder och Supabase RPC. Ett framtida versionerat integrations-API är planerat, inte implementerat. Definiera validerade kontrakt, idempotens, sidindelning och konflikthantering när konsumenterna finns. Den interna annonsmodulen har eget versions- och jobbregisterkontrakt; förberedda Blocket/Wayke-kanaler förblir inaktiva utan partneråtkomst och färdigt leveranskontrakt. Partneradapters byggs endast från verkliga kontrakt. Webhookmottagning måste kontrollera källa, konto och miljö samt tåla dubbletter och händelser i fel ordning. Utskick och bakgrundsarbete ska kunna återupptas utan dubbla affärshändelser.

## 16. Återanvändning av projekt och verktyg

Behåll låsta Next.js-/React-/Supabase-beroenden och befintlig lockfil. Originalplanen nämner kandidater för mallbyggare, signering, CSV, jobbkö och OCR; valet är inte en aktiv integration eller ett färdigt licensbeslut. Gör en avgränsad teknisk och licensmässig kontroll när respektive fas börjar. Agentarbete delas efter filer och ansvar; gemensam integration verifieras före färdigmarkering.

## 17. Säkerhet, dataskydd och driftkontroll

Kod och migrationer använder RLS, databaskontrollerat medlemskap, privata filer, auditlogg och begränsade skrivoperationer. Omverifiera två helt separata företag, främmande kund-/bil-/dokument-ID, läsroller, finansroller och avstängda medlemskap. Bevis för säkerhet kräver faktiska försök att läsa och mutera fel företags data. Auth- och appsvar ska förbli privata vid sessionsförnyelse. Demo-/pilotförfrågningar har separat privat lagring och begränsad skrivfunktion. Testmiljö och produktionsmiljö ska särskiljas när integrationer aktiveras.

## 18. Byggfaser och leveranskrav

Fasordningen nedan kommer från återhämtad originaltext. Varje fas avslutas med ett verifierat användarflöde och dess viktigaste fel- och avbrottsfall. Återhämtade tabeller eller skärmar innebär inte att fasen är klar.

| Fas | Konkret fortsättning | Leveranskrav |
|---|---|---|
| 0 – Produkt och partnerbeslut | Bekräfta pilotens arbetsflöden, MVP, första dokumentupplägg, ekonomi-export och faktiskt partnerunderlag. Bevara beslutet att ersätta gamla sajten i befintliga resurser. | Kända integrationsberoenden och ansvar; systemkonto, nätverk och finansgodkännande åtskilda. |
| 1 – Konton, grund och företagsisolering | Omverifiera återhämtad auth, företagskontext, RLS, lagring och audit. Inbjudningar och medlemsadministration är implementerade med separat verifiering; fortsätt filialer och ägaröverlåtelse. Återställ regressionstester och byggkontroller. | Två handlare kan arbeta isolerat; främmande ID och avstängd personal nekas; korrekta domän- och sessionsflöden. |
| 2 – Lager och import | Lagerkort, kostnader, privata bilder och exakt moms-/VMB-kalkyl är implementerade tillsammans med CSV-import. Fortsätt inköpsunderlag och full skickbedömning. | Pilotlager importeras och rättas utan dubbletter vid omkörning; belopp och underlag kan följas. |
| 3 – CRM, affär och reservation | Kontaktlogg, kunduppföljningar, leads, offertversion och kundgranskning/accept är implementerade. Kontrollerad avbrytning är implementerad. Fortsätt faktiskt inbytesköp/avtal och offertkoppling; reservation/utgång omverifieras tillsammans med affärsflödet. | Två samtidiga säljare får högst en giltig reservation; utgång och frigivning bevarar korrekt affärshistorik. |
| 4 – Avtal och signering | Mallversion, fältkoppling, PDF, privat filhämtning, vald signeringsadapter och återhämtning efter avbrott. | Exakt kund/bil/pris i rätt version; signerad fil och evidens bevaras; dubbla events ger inget dubbelt dokument. |
| 5 – Första köpfinanspartnern | Produktgodkännande, partneradapter, ansökan, komplettering, erbjudande och utbetalningsstatus. | Komplett partner-testärende samt avslag, timeout och utgånget erbjudande; kreditbeslut räknas inte som utbetalning. |
| 6 – Ekonomi och leverans | Fakturaunderlag, betalningsregistrering, avstämning, vald export, leveransprotokoll och ägarbytesuppgift. | Affär kan avslutas med spårbara dokument/belopp och uppfyllda leveransvillkor; omkörning skapar ingen oavsiktlig dubbelexport. |
| 7 – Lagerfinansiering | Kreditlimit, finansierat innehav, kostnadsprognos, avstämning, lösen och frigivning. | Finansierad bil kan följas från inköp till partnerbekräftad frigivning; B2B-affär behåller lösenkrav. |
| 8 – Handlarnätverk | Publicerade fordonsdata, inköpsönskemål, matchning, förfrågningar/bud och B2B-reservation. | Två handlare genomför ett kontrollerat flöde utan privat datadelning; inaktuellt lager tas ur aktiv matchning. |
| 9 – Pilot och kontrollerad lansering | Stegvis pilot med originalets mål 3–5 handlare, utbildning, incidentansvar, återställning och verifierad domänpublicering. | Kritiska flöden och driftsåterställning verifierade; varje handlare ser begränsningar och endast egna aktiverade funktioner. |
| 10 – Integrationer efter pilot | Prioritera fler partner-, annons-, fordonsdata- och ekonomi-adapters samt OCR/AI utifrån uppmätt behov. | Ny integration har underlag, ansvar, testflöde och återhämtningsprocess innan aktivering. |

Fas 7 kan tidigareläggas när den första avtalade produkten är lagerfinansiering. Konto-, betalnings- och leveransberoenden kvarstår. Lager och CRM kan byggas medan partnerunderlag saknas; kredit- och signeringsflöden aktiveras först när respektive underlag och verifiering finns.

### Nästa sammanhängande leverans

1. Bevara historiska main-/produktionscheckpoints `db7143`, `7fc833f` och PR #6 `4711726`; följ efterföljande main-pushar i Vercelstatus med deras egna commit-/deploymentreferenser. PR #4 är mergad. Bevara verifierade checkpoints `cf953d4`, `69ed849` och `aed26df` som referenspunkter för releasegranskningen.
2. Komplettera remote kontroll av fontpaketering, domänrouting, auth-callback och PDF-route; verktygets klassning av PDF-svaret som deploymentautentisering ger inget verifierat app-PDF-resultat. Behåll de tio applicerade migrationsversionerna synkroniserade och cronförslaget separat tills godkännande finns.
3. Omverifiera ännu ej bevisat autentiserat browserflöde med två syntetiska företag: konto → företag → lagerimport/kostnad → kund/CRM → affär → reservation/utgång/frigivning → offertversion → PDF. UI-mockarna ersätter inte denna kontroll eller två samtidiga databasanslutningar.
4. Följ upp security-advisory om avstängt skydd mot läckta lösenord samt kvarstående finans-/dokument-/sessionsgränser i den avsedda driftsmiljön.
5. Följ upp den verifierade produktionscheckpointen på den publika sidan och appen. Dokumentera efterföljande faktiska deploymentresultat separat; kvarstående auth-/CRUD-gränser ligger kvar i statusprotokollet.
6. Kontaktlogg och kunduppföljningar är levererade. Fortsätt nästa ofärdiga beroende i fas 1–3: filialer/ägaröverlåtelse, inköpsunderlag och inbyte. Kundens offertgranskning och svar är levererade med verifierad e-post; BankID och elektronisk underskrift ingår inte. Därefter dokumentfasens mallar/signering. Externa partnerbeslut får inte ersättas med simulerade aktiva integrationer.

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
