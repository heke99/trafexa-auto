# Trafexas plattformsadministration

Företagets kontaktadress är `info@trafexa.com`. Den adressen ger ingen administratörsbehörighet. Användaren har uttryckligen godkänt `hekmat.h@trafexa.com` för superadminåtkomst.

## Åtkomst

Öppna `https://app.trafexa.com/admin`. Ett Trafexakonto måste först skapas och dess e-postadress verifieras genom Supabase Auth. Registrering och bekräftelse behåller den lokala returvägen `/admin`. Administratören behöver inget handlarföretag eller företagsmedlemskap.

Migrationen innehåller inga administratörer eller godkända adresser. En betrodd databasoperatör reserverar den uttryckligen godkända adressen i `private.platform_admin_bootstrap_reservations`. Inloggad användare aktiverar därefter åtkomsten med knappen **Aktivera administratörsåtkomst**. Aktiveringen är en explicit serveråtgärd; sidvisning och menysondering gör aldrig denna skrivning.

Databasen kontrollerar det faktiska Auth-kontots UUID, verifierade adress, spärrstatus och frånvaro av anonym/SSO-identitet. Adressen måste motsvara en privat, aktiv och oanvänd reservation. Aktiveringen binder reservationen till UUID en gång och skriver en oföränderlig revisionspost. Fortsatta adminåtgärder kräver detta aktiva UUID i den privata listan. E-postdomän, egen profilmetadata och rollen företagsägare ger ingen plattformsåtkomst. Avstängd administratör återaktiveras inte genom bootstrap.

## Funktioner

- Företagssökning med organisationsnummer, status och antal medlemskap/lagerobjekt; högst 50 rader per sida.
- Aktivering eller avstängning av ett företag med obligatorisk motivering, granskning och uttrycklig bekräftelse. Databasen jämför förväntad status och loggar aktör, företag, skäl och begärans UUID.
- Samma begärans UUID och innehåll kan upprepas utan dubbel ändring. Ett historiskt kvitto ersätter inte en ny läsning av företagets aktuella status.
- Inkomna ansökningar från webbformuläret med sidindelning och strukturerad detaljvy. Separat granskat kontogodkännande skickar en personlig inbjudan med välkomsthälsning och godkännandebekräftelse enligt [kontokontraktet](ACCOUNT_APPROVAL_CONTRACT.md). Enbart ändrad handläggningsstatus skickar inget mejl.
- Konton visar företagsnamn, organisationsnummer och kontaktperson. Sökning stöder namn, företag, organisationsnummer och e-post; flera företagskopplingar och ansökt företag utan medlemskap visas tydligt åtskilda.
- Vanliga handlarroller har fortsatt företagsbunden åtkomst. Adminlistor och revisionstabeller exponeras inte genom direkt tabellåtkomst.

## Verifiering och driftsgränser

Tester använder de verkliga TypeScript-modulerna, komponenterna och hela SQL-migrationskedjan med Auth/Storage-fixturer. De kontrollerar nekad åtkomst, falska roller och metadata, bekräftad identitet, reserverad adress, statuskonflikter, revisionsskydd och upprepade begäranden.

Ingen administratörs lösenord skapas av verktyg. Kontoägaren registrerar sig och verifierar sin adress själv. Befintliga signerings- och offertarkivmigrationer som ännu inte är applicerade i hosted Supabase är separata från denna adminmigration; admin kräver endast den redan applicerade dealergrunden och kontaktförfrågningstabellen. Externa partneranslutningar och arkivets servernyckel måste fortfarande konfigureras innan de berörda funktionerna kan användas.
