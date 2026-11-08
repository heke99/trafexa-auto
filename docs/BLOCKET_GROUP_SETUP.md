# Blocket gruppanslutning V5

## Status och källunderlag

Pågående etapp från PR #34/main `b79032211fb1f9aacd1e3defdc41da53faeac6c3`, 15 oktober 2026. Underlaget är den klientdokumentation som användaren uttryckligen laddat upp som `client-documentation.md` och dokumenterat önskemål om gruppanslutning. Faktisk grupp-JWT, tokenomfattning och kontoåtkomst är ännu inte verifierade. Dokumentation är inte bevis för en aktiverad anslutning. Integrerad helsvit 1139/1139, produktionsbygge inklusive TypeScript och hosted rollbackprov passerar. Publiceringen återstår att verifiera.

## Företagsbunden konfiguration

Varje handlarföretag binds till rätt `dealer_code` inom gruppanslutningen. Behörig administrativ provisionering sparar endast icke-hemlig `credentialReference` tillsammans med kontobindningen. JWT eller andra hemliga nycklar får inte sparas i databas, formulär, loggar eller klientkod. Serverns faktiska credential och dess tillåtna kontoomfattning behöver verifieras separat före extern sändning.

Detta flöde ger inte valfri partnerklient åtkomst till Trafexas privata API. Handlarens autentiserade appsession och partnerns serverbehörighet är separata kontrakt. Butiksprofilens tidigare Trafexa-JSON är inte ett verifierat Blocket-kontoskapandeanrop.

## Trafexas annonsprogram

Enligt Blockets besked till Trafexa registrerar Blocket Trafexa Nordic AB, org.nr 556855-4884, som juridiskt bolag för fakturering av anslutna butiker. Handlarens befintliga butik behåller sitt namn och sina kontaktuppgifter. DMS-företaget behåller sitt eget organisationsnummer. Annonsimporten använder butikens `dealer_code`.

Nästa etapp i superadmin:

1. Registrera en anslutningsperiod för befintlig Blocketbutik med handlarens avtalsreferens och önskat startdatum. Lägg in Blockets bekräftelse och fakturans faktiska startdatum separat. Visa väntande respektive aktiv status utifrån bekräftelse och datum.
2. Registrera uppsägningsdatum och avtalat slutdatum. Spara separat det datum Blocket bekräftar för återgång till egen fakturering. Visa avvikelser som behöver följas upp. Behåll historiken vid återanslutning och spärra överlappande perioder för samma butik.
3. Håll perioderna åtskilda från API-kopplingens giltighet och från annonsernas livscykel. Utträdet avser faktureringen. Eventuellt byte av API-behörighet samordnas med Blocket för samma butik, och annonsernas identiteter bevaras.
4. Använd det befintliga annonsunderlaget för rapportering per handlare. Räkna unika annonser per butik och marknadsplats. Stäm av Trafexas kostnad mot Blockets fakturaperiod och bekräftade fakturadatum.

## Bytbil via samma Pro Import API

Den [officiella klientdokumentationen](https://api.blocket.se/pro-import-api/docs/client-documentation) beskriver både Blocket och Bytbil i samma API. Vid gruppbehörighet skickas butikens `dealer_code` vid skapande. API:t returnerar `blocket_ad_id` för Blocket och kan returnera `offer_id` för registrerade fordon på Bytbil.

Den befintliga V5-leveransen verifierar och sparar Blockets annons-ID. För Bytbil behöver leveransjournalen dessutom spara `offer_id` och status separat efter verifiering mot rätt butik, annons och begäran. Verifiera i pilot att butikens Bytbil-publicering ingår och vilket svar som utgör bevis för synlighet. En Blocket-bekräftelse ensam ska inte öka Bytbil-räknaren. Återanvänd samma annonsidentitet och leverans i stället för ett extra skapandeanrop för Bytbil.

## Leverans och osäkra utfall

V5-adaptern ska skilja skapande med POST från uppdatering med PUT enligt det verifierade externa kontraktet. En beständig leveransjournal ska registreras före ett externt skrivförsök och binda företag, annonsversion, konto, åtgärd och försök. Journalen ersätter inte leverantörens egna garantier och hävdar ingen odokumenterad idempotens.

Publiceringsbevis måste avse aktuell begäran och rätt extern annons. Vid timeout eller annat osäkert utfall markeras leveransen som okänd och begränsas till läsning/avstämning tills ett säkert beslut finns. Inga automatiska återutskick får skapa en dubblett efter ett osäkert skrivförsök. Köat och inskickat är fortsatt skilda från verifierat publicerat och från faktureringsenheter.

## Separat Trafexapublicering

Den [publika Trafexa-butiken](PUBLIC_DEALER_STORES.md) är ett eget uttryckligt publiceringsval. Den skapar ingen Blocket-annons, aktiverar ingen dispatcher och verifierar inget externt handlarkonto. Befintliga annonser eller konton återfylls inte automatiskt. Faktisk extern transport väntar fortsatt på verifierad token, scope och kontobindning.

## Riktad verifiering före integration

Runtimekontroll passerar 12 fall, provider 18 nya och 24 befintliga, native gruppjournal 23, faktisk bridge nio och admin-korslager sex. Native prov använder 117 lokala migrationsfiler före integreringen med fakturamejl. Dessa är delresultat; integrerad verifiering och hosted applicering har därefter passerat enligt IMPLEMENTATION_STATUS; publiceringen återstår. Inga verkliga tokens eller externa skrivningar används.

## Driftgräns inför publicering

Integrerad runtime passerar 12 prov och förblir avstängd som standard. Manuell intern POST kräver fyraminuters beredskapskontroll och separat jobbendpoint; ingen cron aktiveras. Servercredential kommer från `SUPABASE_SECRET_KEY` med `SUPABASE_SERVICE_ROLE_KEY` som fallback. V5-provider 42/42 är mockprov: exakt taxonomi på unikt ID/namn utan fuzzy-matchning, spärr för tvetydigt drivmedel/modell och `/validate` före CREATE. Endast dokumenterad bodylog för aktuell request-ID ger begäransbevis; annars förblir utfall okänt. Faktisk token och extern transport är fortfarande overifierade.
