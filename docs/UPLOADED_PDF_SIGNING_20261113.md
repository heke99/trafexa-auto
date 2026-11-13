# Uppladdad PDF för fristående signering – 13 november 2026

## Beteende och gräns

En behörig ägare/administratör kan ladda upp ett eget PDF-original för en affär, granska det och uttryckligen godkänna/skicka med sitt namn. Kunden öppnar en personlig mejllänk, läser originalet och signerar med namn och en bekräftelse. Något kundkonto eller separat offertgodkännande behövs inte för denna fristående PDF-källa.

Detta är inte ett konstruerat accepterat offertunderlag eller en native avtalsmall. Affärens strukturerade avtal används fortfarande för betalnings-/leveransflödet. Denna begränsning visas före uppladdning. PDF-signeringen är en enkel elektronisk underskrift via personlig mejllänk och behörigt säljkonto, inte BankID eller certifikatbaserad PDF-signering.

Originalet sparas oförändrat i en privat lagringsplats. Det färdigsignerade dokumentet innehåller originalets sidor plus en uttryckligen redovisad signeringssida. Original, signerat PDF och JSON-signeringsevidens kan hämtas separat. Evidensen binder originalets SHA-256, det frysta metadataunderlagets hash, den signerade PDF-filens hash, aktör/namn/tidpunkt och metod. Redan sparade original och kvitton skrivs inte om.

## Säkerhets- och återhämtningskontroller

- Högst 4 MB och 1–100 originalsidor. Gränsen kontrolleras på faktiskt lästa multipart-bytes före `formData()`, även när Content-Length saknas eller är fel. Originalets bytegräns kontrolleras också separat.
- Strukturell PDF-inspektion efter pdf-lib-dekodning omfattar indirekta, komprimerade och nästlade objekt. Krypterade/malformed PDF, formulär, JavaScript, OpenAction/AA, Launch, XFA, EmbeddedFiles, RichMedia/aktiva underarter och tidigare Sig/DocMDP/Perms-signaturer nekas. Ingen osignerad omexport av certifikatsignerat original sker.
- Explicit främmande Origin nekas. När en same-origin multipartklient utelämnar Origin krävs browserkontrollerad `Sec-Fetch-Site: same-origin`; vanlig Auth-/rollkontroll krävs alltid dessutom.
- Kund-id, namn och mejladress binds till originalet. Aktuell företags-/affärs-/kund-/avsändaråtkomst läses om före utskick, gäståtkomst och signering. Ändrad kund, mejl, avstängd aktör/företag och avbruten affär blockerar felaktig fortsatt signering.
- Inga direkta anon/authenticated-rättigheter till privata tabeller eller den privata lagringsplatsen. Worker-RPC:er är service-only. Inga publika objekt-URL:er skickas till webbläsaren.
- Kundens HttpOnly-cookie `trafexa-uploaded-pdf` har SameSite=Lax, Secure vid HTTPS, Path=/pdf-document och högst sju dagar/återstående källgiltighet. Token tas bort ur sidans URL efter invitation-routen; endast SHA-256 finns i databasen. Ingen Auth-identitet skapas för kunden.
- Uttryckligt säljargodkännande sparas före begäran om kundunderskrift. Kunden signerar inte genom en GET eller iframevisning. PDF-rendering och namn/font-stöd kontrolleras före signaturcommit.
- Beständiga request-id/kvitton hindrar dubbla signaturer. Efter ett verifierat avslutat uppladdningsförsök kan en ny avsiktlig uppladdning av samma fil få ett nytt id. Okänt svar återförsöks med samma id.
- Separat beständig mejllease använder befintlig Resend-transport, avsändare och serverkonfiguration. Ett känt 429-avslag kan återförsökas uttryckligt med identisk kropp/nyckel. Okänt leverantörssvar, övergiven lease eller överskriden idempotensperiod skickas inte blint igen. Vanlig statusläsning skickar inget mejl.
- Gästens signeringscommit tar samma källradlås som återkallning före den slutliga behörighetskontrollen. Vinner återkallningen nekas underskriften; vinner underskriften bevaras den och den senare återkallningen stänger länken.
- Kundlänken kan återkallas utan att radera redan sparade underskrifter/arkiv. Ägaren kan fortfarande hämta sitt verifierade arkiv; den återkallade länken nekas.

## Nycklar och explicit återhämtning

`UPLOADED_PDF_LINK_SECRET` är en valfri stabil serverhemlighet för härledning av den första mejllänken. När den saknas används redan konfigurerad `SUPABASE_SECRET_KEY`; ingen ny variabel krävs för att aktivera funktionen. Vid rotation av härledningsnyckeln jämförs en återförsändnings kandidat med den sparade tokenhashen. Avvikelse stoppar utskicket, bevarar den befintliga länken och visar att Trafexa måste kontrollera den sparade inbjudan. Ändra inte sparad token eller kvitto för att forcera en återförsändning. Återställ den ursprungliga härledningsnyckeln i säker serverkonfiguration för återhämtning; okänt utskicksresultat kräver ändå operatörskontroll innan nytt försök.

Färdigmejlet härleder ingen ny behörighetslänk: det hänvisar till kundens ursprungliga personliga länk och erbjuder en HTTPS-dokumentvy som kan användas på samma enhet med den befintliga HttpOnly-cookien. Dokumentvyn ger ingen åtkomst i sig. Därför fortsätter kundens ursprungliga länk och färdigmejlet att fungera när service-nyckeln roteras efter första utskicket.

Om arkivlagringen tillfälligt misslyckas efter kundens commit sparas underskriften. Kundens uppdatering reparerar arkivet utan mejlutskick. Säljarens uttryckliga knapp **Skicka färdigsignerat avtal** verifierar/reparerar arkivet och försöker sedan skicka den väntande bekräftelsen. PDF-mejlkön har ingen schemalagd worker; dessa uttryckliga återhämtningsåtgärder ingår i denna version.

## Verifiering

**2/2 samtidighetsprov PASS** i riktig isolerad PostgreSQL med oberoende psql-sessioner: återkallning före signering nekas efter observerad låsväntan; signering före återkallning bevarar underskriften och återkallar länken efter observerad låsväntan. Test: `node tests/uploaded-pdf-db/native-concurrency.mjs`.

**3/3 migrationsguardprov PASS**: en befintlig publik bucket eller inkompatibla MIME-/storleksinställningar stoppar hela migrationen utan delvis skapade tabeller eller ändrade bucketinställningar. En kompatibel privat bucket bevaras oförändrad. Granskningen sker efter INSERT/ON CONFLICT under radlås, så även en konkurrerande bucketregistrering kontrolleras. Test: `node tests/uploaded-pdf-migration.test.mjs`.

**15/15 PASS**: `node tests/uploaded-pdf-signing.test.mjs` kör faktiska upload-/invitation-/downloadroutes, serveråtgärder, full migrerad PGlite, private/RLS- och workergränser, byte-/hashkontroller och riktig PDF-renderare. De fyra sista proven täcker service-nyckelrotation, valfri stabil länkhärledning, fail-closed vid ändrad härledningsnyckel samt arkivfel med senare uttryckligt färdigmejl. Transportfelet och Storage/Resend IO är kontrollerade lokala adaptrar. Inga externa mejl eller hosted data används.

**2/2 PASS**: `node tests/uploaded-pdf-ui.test.mjs` kopplar den riktiga React-vyn i Chromium via lokal HTTP till de faktiska åtgärderna/SQL/lagringsadaptern. Båda bredderna 320 och 1440 px omfattar två avsiktliga uppladdningar av samma fil, säljarens namn/ack/skicka, genererad mejllänk, riktiga invitation-cookie, borttaget URL-token, öppnat original, valideringsnekning utan underskrift/inmatningsförlust, kundens signering och PDF-nedladdning. Inga pageerrors eller dokumentbredder över viewport; busy-signalen till föräldern frigörs efter verifierad efterläsning.

Den lokala HTTP-adaptern ersätter Nexts fullständiga RSC-transport och extern Auth/Storage/SMTP. Headless-Chromiums PDF-plugin är inte samma sak som en användares PDF-visare; den explicita öppna-/hämta-original-länken utövas också. En grön lokal kedja bevisar inte att en faktisk produktionsmottagare har fått eller signerat ett mejl.

Typkontroll och diffkontroll passerar. Skärmbild vid 320 px har granskats visuellt; efter slutförd signering döljs den stora original-iframeytan och den signerade filens primära knapp använder projektets befintliga gröna knappstil.

## Drift och städning

Migrationen skapar endast schema och en privat bucket; inga priser, kunder, verkliga avtal eller underskrifter skapas. Root ansvarar för den slutliga gemensamma testkörningen, hosted tillämpning och publicering. Denna delagent har inte muterat produktion eller skickat något mejl. Testdatabaser, HTTP-servrar, browserkontexter och tillfälliga byggkataloger stängs av testerna.

Mejlstatusen för denna dokumentkälla ligger i dokumentets egen kontrollerade vy/lease; den ingår inte som en påhittad native transactional-email-kind. Extern backup/lagringsretention och full inloggad produktionssignering kräver egna drift-/åtkomstförutsättningar.
