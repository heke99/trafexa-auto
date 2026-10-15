# Blocket gruppanslutning V5

## Status och källunderlag

Pågående etapp från PR #34/main `b79032211fb1f9aacd1e3defdc41da53faeac6c3`, 15 oktober 2026. Underlaget är den klientdokumentation som användaren uttryckligen laddat upp som `client-documentation.md` och dokumenterat önskemål om gruppanslutning. Faktisk grupp-JWT, tokenomfattning och kontoåtkomst är ännu inte verifierade. Dokumentation är inte bevis för en aktiverad anslutning. Integrerad helsvit 1139/1139, produktionsbygge inklusive TypeScript och hosted rollbackprov passerar. Publiceringen återstår att verifiera.

## Företagsbunden konfiguration

Varje handlarföretag binds till rätt `dealer_code` inom gruppanslutningen. Behörig administrativ provisionering sparar endast icke-hemlig `credentialReference` tillsammans med kontobindningen. JWT eller andra hemliga nycklar får inte sparas i databas, formulär, loggar eller klientkod. Serverns faktiska credential och dess tillåtna kontoomfattning behöver verifieras separat före extern sändning.

Detta flöde ger inte valfri partnerklient åtkomst till Trafexas privata API. Handlarens autentiserade appsession och partnerns serverbehörighet är separata kontrakt. Butiksprofilens tidigare Trafexa-JSON är inte ett verifierat Blocket-kontoskapandeanrop.

## Leverans och osäkra utfall

V5-adaptern ska skilja skapande med POST från uppdatering med PUT enligt det verifierade externa kontraktet. En beständig leveransjournal ska registreras före ett externt skrivförsök och binda företag, annonsversion, konto, åtgärd och försök. Journalen ersätter inte leverantörens egna garantier och hävdar ingen odokumenterad idempotens.

Publiceringsbevis måste avse aktuell begäran och rätt extern annons. Vid timeout eller annat osäkert utfall markeras leveransen som okänd och begränsas till läsning/avstämning tills ett säkert beslut finns. Inga automatiska återutskick får skapa en dubblett efter ett osäkert skrivförsök. Köat och inskickat är fortsatt skilda från verifierat publicerat och från faktureringsenheter.

## Separat Trafexapublicering

Den [publika Trafexa-butiken](PUBLIC_DEALER_STORES.md) är ett eget uttryckligt publiceringsval. Den skapar ingen Blocket-annons, aktiverar ingen dispatcher och verifierar inget externt handlarkonto. Befintliga annonser eller konton återfylls inte automatiskt. Faktisk extern transport väntar fortsatt på verifierad token, scope och kontobindning.

## Riktad verifiering före integration

Runtimekontroll passerar 12 fall, provider 18 nya och 24 befintliga, native gruppjournal 23, faktisk bridge nio och admin-korslager sex. Native prov använder 117 lokala migrationsfiler före integreringen med fakturamejl. Dessa är delresultat; integrerad verifiering och hosted applicering har därefter passerat enligt IMPLEMENTATION_STATUS; publiceringen återstår. Inga verkliga tokens eller externa skrivningar används.

## Driftgräns inför publicering

Integrerad runtime passerar 12 prov och förblir avstängd som standard. Manuell intern POST kräver fyraminuters beredskapskontroll och separat jobbendpoint; ingen cron aktiveras. Servercredential kommer från `SUPABASE_SECRET_KEY` med `SUPABASE_SERVICE_ROLE_KEY` som fallback. V5-provider 42/42 är mockprov: exakt taxonomi på unikt ID/namn utan fuzzy-matchning, spärr för tvetydigt drivmedel/modell och `/validate` före CREATE. Endast dokumenterad bodylog för aktuell request-ID ger begäransbevis; annars förblir utfall okänt. Faktisk token och extern transport är fortfarande overifierade.
