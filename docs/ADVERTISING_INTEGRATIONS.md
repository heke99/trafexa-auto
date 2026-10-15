# Annonsering till handlarens externa konton

Trafexa ska låta handlaren skapa en annons från sitt lager, välja egna bilder och kanaler, granska annonsen och skicka den till rätt handlarkonto. Varje annonsversion och utsändning hör till ett företag. Användaren har nu lämnat Blockets klientdokumentation för gruppanslutning och bekräftat önskemålet om en publik Trafexa-butik med valda annonser. Faktisk token, kontoomfattning och partneråtkomst är ännu inte verifierade; inga externa utsändningar eller arbetare aktiveras av dokumentationen.

## Pågående gruppanslutning och publik Trafexa-butik

[Blocket gruppanslutning V5](BLOCKET_GROUP_SETUP.md) byggs från den uppladdade klientdokumentationen. Företagsbundet `dealer_code`, en icke-hemlig credentialreferens och en beständig leveransjournal ska skydda rätt konto och återförsök. Ingen JWT sparas i databas eller UI och ingen faktisk token eller scope har ännu verifierats.

[Publika handlarbutiker](PUBLIC_DEALER_STORES.md) byggs separat i Trafexa från uttryckligen granskad profil och valda aktuella annonser. Trafexapublicering skapar inte en annons eller butik hos Blocket. Offentlig JSON-läsning ger ingen privat partnerbehörighet. Integrerad helsvit 1139/1139 och produktionsbygge inklusive TypeScript passerar; publiceringen återstår att verifiera.

## Kanalval och granskat pris, 2026-10-15

[Sändningskontraktet](ADVERTISING_REVIEWED_SEND_CONTRACT.md) binder handlarens kanalval till en serverberäknad prisoffert före köning. Pris per kanal och total visas i SEK exklusive moms. Uttryckligt nollpris skiljs från saknat pris, som blockerar sändning. Inaktuell offert ger konflikt och ny granskning; ingen tyst prisändring får ske. Första accepterade priset per företag, annons och kanal sparas oföränderligt, varje leveransjobb binds till det och första verifierade publicering använder det accepterade priset. Äldre jobb utan ny prisbindning behåller sin tidigare publiceringsregel. En prisaccept eller köning ger ingen faktureringsenhet. Migration `20261015123148_advertising_reviewed_send_price`, hosted rollback/cleanup inklusive handlarstatistik, integrerad appkörning efter moms-V2 948/948 och produktionsbygge passerar. Integrerad bas är 105 hosted migrationer och 107 lokala filer, varav två äldre pending prototyper. Detta är en testad kodcheckpoint före publicering. Kanalvalet aktiverar inte Blocket, Wayke eller en dispatcher; användaren har bekräftat att partneranslutning saknas och leveransspärrarna nedan gäller fortsatt. Separat releasebevis redovisas i [IMPLEMENTATION_STATUS](IMPLEMENTATION_STATUS.md).

## Butiksprofil och kontoskapande, omkontrollerat 2026-10-15

Den nya [företags- och butiksprofilen](COMPANY_STORE_PROFILE.md) förbereder ett privat, granskat Trafexa-JSON-underlag för ny butik eller befintligt konto. Profil, API och kanalunderlag är implementerade med verifierad hosted migration. Efter sammanfogning med ekonomietappen passerar 880/880 appfall och slutligt produktionsbygge inklusive TypeScript. Detta är en testad kodcheckpoint före publicering; PR-/main- och deploymentbevis återläses separat. Status `prepared` betyder sparat i Trafexa. Ingen extern sändning, skapad butik eller verifierad kanalanslutning följer av ett sådant underlag.

[Blockets officiella instruktion](https://blocket.zendesk.com/hc/sv/articles/30657906956946-G%C3%B6r-er-digitala-butik-redo-f%C3%B6r-nya-Blocket) skiljer annonsimport från handlaruppgifter: adress, presentation, logotyp och öppettider hanteras i Blocket Admin. Inget offentligt kontrakt för att skapa butik/handlarkonto eller skriva dessa profiluppgifter via Import API har verifierats. Pro Import API arbetar mot befintlig `dealer_code` med supporttilldelad JWT. Ett Trafexakonto eller en nedladdad profil ger ingen sådan behörighet.

[Waykes API](https://api.wayke.se/) kräver deras aktivering av en System Client för OAuth2-skrivåtkomst. Organisationsavsnittet dokumenterar läsande sökning. [Den officiella DMS-guiden](https://github.com/wayke-se/Documentation/blob/master/DMS/DMS%20Integrations.md) beskriver skapande och uppdatering av fordonsannonser, inte handlarorganisationer. Endpoint, schema, idempotens, status och läsback för ny butik/organisation är därför overifierade. Ett separat privat partnerkontrakt kan finnas, men får inte ersättas med påhittade anrop.

Butiksprovisionering till Blocket/Wayke är uttryckligen blockerad tills dokumenterat kontrakt och beviljad åtkomst finns. Handlarens vanliga appsession används för Trafexas privata profil-API; den är ingen partnernyckel eller verifiering av ett externt konto. Annonsleveransens separata spärrar nedan gäller fortsatt.

## Officiella annonskontrakt, kontrollerade 2026-10-13 till 2026-10-15

### Blocket / Bytbil

[Blockets Pro Import API](https://api.blocket.se/pro-import-api/docs/client-documentation) dokumenterar JWT i `X-Auth-Token`, tilldelning via butikssupport och behörigheter för en handlare eller handlargrupp. En grupp kräver uttrycklig `dealer_code`. Den lokala prototypen använder V4. Vid omkontrollen den 15 oktober rekommenderar dokumentationen V5 för nya bilintegrationer; [versionshistoriken](https://api.blocket.se/pro-import-api/docs/changelog) beskriver ändrade fordonsfält och migrationskrav. Exakt version och OpenAPI-schema ska verifieras inför aktivering; V4-prototypen är inte bevis för stöd för senaste versionen. Skrivningar behandlas asynkront: POST 201 betyder mottaget, medan verifierad publicering kräver rätt annons, `publish/done` och `blocket_ad_id`. Det finns ingen separat testmiljö. Ingen förnyelse eller betald exponering ingår här.

[Kategoriinformationen](https://api.blocket.se/pro-import-api/docs/category-reference) beskriver bilannonser: modellår och registreringsnummer eller VIN, miltal med uttrycklig enhet och kategorin 1020. Trafexa skickar aldrig VIN. Registreringsnummer kräver handlarens uttryckliga opt-in; utan detta avvisas Blocketexporten. Titel och kontaktfält skickas inte för bilkategorin. Bilder måste vara JPEG eller PNG; WebP exporteras inte. Märke/modell skickas inte som påhittade providerspecifika enumvärden.

`blocket-provider.ts` är endast verifierad med mockade HTTP-svar. Den använder en fast officiell destination, spärrar omdirigeringar och skickar ett begränsat offentligt payload. Den verifierar även företagets dealerbindning och annonsidentitet vid statusavläsning. Den bygger ingen annonslänk från gissningar.

Pris lagras i heltalsöre i Trafexa. Den förberedda adaptern exporterar enbart exakt konverterbara hela kronor, eftersom stöd för decimalbelopp ännu inte har verifierats mot den maskinläsbara OpenAPI-specifikationen. Ören avvisas uttryckligen och avrundas aldrig tyst. Detta är en lokal försiktighetsregel, inte ett påstående om Blockets prisbegränsningar.

### Wayke

[Waykes officiella API](https://api.wayke.se/) anger systemklient/OAuth2 för andra integrationer än läsande sökning. [Waykes officiella integrationsrepo](https://github.com/wayke-se/Documentation) innehåller separata DMS- och medieanvisningar. Sök-/webbwidget-nycklar är inte bevis för skrivrätt till ett handlarkonto.

Det fullständiga DMS-kontraktet för import, filialbehörighet, mediehantering och bekräftad publicering behöver fortfarande verifieras tillsammans med beviljad partneråtkomst. Ingen Wayke-skrivadapter eller antagen autentiseringsendpoint införs. Kanalen är förberedd i det interna kontraktet och förblir ej ansluten.

## Beständig utsändning och säker status

Worker får bara arbeta med ett beständigt jobb från det privata registret. Jobbet binder företag, lagerbil, annonsversion, kanal, anslutningsversion, konto och dispatcher. Serverkonfiguration och färsk verifierad behörighet krävs. Databasens claim kontrollerar aktuell företagsstatus, medlemskap, lagerstatus, foton och anslutning innan sändning.

Externt `source_id` är det stabila `listingId`, medan varje internt jobb binder en oföränderlig `listingVersion`. Nya versioner ska uppdatera samma externa annons och aldrig skapa en annons per jobb. Den förberedda Blocketadaptern stödjer endast första versionens skapandekontrakt: senare versioner avvisas utan nätverksanrop tills PUT och beständigt `request_id`-korrelerat uppdateringsbevis är implementerade. Därmed kan en gammal publiceringslogg inte felaktigt godkänna ett senare jobb.

Detta är ett mocktestat kontraktsprototyp, inte en aktiveringsklar Blocketintegration. I det riktiga annonsflödet ökar versionen när utkastet markeras klart; redan första utsändningsbara versionen är därför normalt minst version 2. Den avvisas också av prototypens konservativa versionsspärr. Före aktivering behövs en separat beständig extern leveransrevision, beslut mellan CREATE och UPDATE och bevis som hör till den nya leverantörsrequesten. Att bara konfigurera en API-nyckel räcker inte.

- `queued` / `retryable`: SQL-claim med versionskontroll och unik lease.
- `dispatching`: endast innehavaren av aktuell lease får registrera resultat.
- `submitted`: leverantören har accepterat annonsen; publicering väntar på verifiering.
- `outcome_unknown`: tidsgräns, nätverksfel eller utgången lease; enbart läsande statuskontroll tillåts.
- `published`: leverantörens verifierade publiceringsbevis, aldrig en lokal optimistisk uppdatering.
- `rejected`: bekräftad avvisning, separat från oklart nätverksresultat.

429 och 5xx ger inte automatisk omsändning i Blocketadaptern. Ett borttappat svar kan innebära att utsändningen lyckades; att skicka POST igen kan skapa dubbla annonser. Även misslyckad resultatsparning lämnar jobbet för reconciliation efter leaseutgång. Inga cronjobb, heartbeat-anrop eller workers aktiveras i denna leverans.

Medier löses via en betrodd serverresolver som hämtar den faktiska privata originalfilen, avkodar och normaliserar den utan EXIF-metadata och lagrar nya bytes i den separata privata bucketen `ads-export-media`. Användare får inte skriva till exportbucketen. Resolvern måste läsa tillbaka filen och verifiera SHA-256 innan den utfärdar åtkomst. Ursprungliga objekt i `ads-vehicle-photos` får aldrig signeras för extern export; deras användarregistrerade katalogmetadata bevisar inte normalisering.

Workern kräver `normalizationVersion: vehicle-photo-v1`, 64-teckens SHA-256 och exakt exportväg `companyId/stockId/photoId/sha256.extension` vid rätt betrodd Storage-origin. Åtkomstlänkar ska gälla minst 24 timmar för asynkron bildhämtning. Länkar och credentials får inte lagras i publika DTO:er eller felmeddelanden. Tidsgränsen är en lokal miniminivå som behöver bekräftas mot partnerns faktiska köhantering inför aktivering.

## Inför verklig anslutning

1. Beviljad partneråtkomst och bekräftat konto/filial för varje handlarföretag.
2. Verifierat aktuellt auth-, pris-, fordons- och mediekontrakt, inklusive återkallad eller uppdaterad annons.
3. Credentials i godkänd serverkonfiguration; inga hemligheter genom formulär, metadata eller klientkod.
4. Kontraktstester och godkänd kontroll mot partnerns validering; inga offentliga testannonser.
5. Faktiskt registrerad worker, betrodd konto-/konfigurationsbindning och kortlivad readiness. Först därefter kan utsändningsknappen köa verkligt arbete.

Andra annonskanaler ska implementera samma gränssnitt och tillföra egna verifierade kontrakt. En generell URL eller importfeed räcker inte som behörighetsbevis.

## Nästa leveranskontrakt: separat extern revision

Följande är krav för kommande adapteraktivering, inte redan införda tabeller eller aktiverade API-anrop:

1. En beständig kanalidentitet binder `company_id`, `listing_id`, `channel`, stabilt `source_id` och eventuellt verifierat `provider_ad_id`. Identiteten består när annonsens text, bilder eller interna version ändras och när anslutningens credentials roteras. Ett nytt externt konto kräver uttrycklig migrationshantering, inte automatisk nypublicering.
2. Varje leverans binds till en oföränderlig begäran med eget jobb-ID, extern leveransrevision, `CREATE` eller `UPDATE`, anslutningsversion, exakta publika innehållets hash och beständig intern request-identitet. SQL väljer operation under lås från tidigare verifierad kanalhistorik. Intern `listingVersion` avgör aldrig om POST eller PUT ska användas.
3. Första leveransen kan vara `CREATE` även när intern annonsversion är 2 eller högre. Senare leveranser får använda `UPDATE` först när rätt tidigare annons och konto har verifierats. Okänt tidigare utfall blockerar en ny skrivning. Reconciliation är läsande och 404 ger inte ensamt tillstånd att skicka om.
4. Blockets dokumenterade logg har leverantörens `request_id`, och loggendpointen kan filtreras på detta. Hur den identiteten säkert erhålls för just Trafexas begäran, även när svaret försvinner, återstår att verifiera. Ett lokalt UUID ska inte skickas som ett påhittat leverantörsfält eller antas vara en idempotency-nyckel.
5. Publiceringsbevis binder aktuell leveransbegäran, konto, annonsidentitet och leverantörens publicerings-ID. Ett gammalt `publish/done` för en tidigare begäran får inte godkänna en senare ändring. Råa externa fel, credentials och signerade bildlänkar får inte hamna i handlarens statistik eller fakturaunderlag.
6. Blockets dokumentation anger att PUT/PATCH sammanfogar fält i stället för att ersätta hela annonsen. Att utelämna ett gammalt fält raderar det inte. Fältrensning, bildersättning och avpublicering måste kontraktstestas särskilt så att återkallade uppgifter inte ligger kvar hos partnern.

## Beslutad debiteringsenhet

Kunden har valt **per unik publicerad annons och kanal**. Den beständiga enheten är därför företag + annonsidentitet + kanal. Första verifierade publiceringen skapar en enhet; ändrat innehåll, nya jobb, upprepade statusbesked och omsändningsförsök skapar inte ytterligare enheter. Samma annons på både Blocket och Wayke kan ge två enheter när båda publiceringarna är verifierade. Köad, accepterad för behandling, okänd eller avvisad leverans ger ingen enhet.

Statistik och fakturaunderlag kan byggas på den enheten medan partneråtkomst saknas. Versionshanterade kanalpriser, granskat pris före sändning, låsta månadsunderlag, nedsättningar och granskade fakturautkast har separata kontrakt. Verkliga moms-/betalningsbeslut måste anges uttryckligen; ett antal annonser eller en prisaccept är ingen utfärdad faktura. Borttagning eller senare avpublicering ska behålla historisk evidens. Förnyelse, betald exponering och återbetalning ingår inte automatiskt i det beslutade priset. Lokal statistik visar Trafexas egna leveranshändelser; API:t är inte bevis för ändringar som handlaren gjort direkt i Blockets admin.
