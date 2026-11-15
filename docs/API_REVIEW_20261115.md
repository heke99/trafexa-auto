# API-granskning 15 november 2026

Granskningen omfattar webbansökan, företags-/butiksprofilens HTTP-gräns, PDF- och fotouppladdning, dokumenthämtning, offentlig butik, fakturamejlens webhook och intern annonskörning. Verifieringen använder isolerade underlag, simulerad transport och lokal databas. Inga riktiga utskick, uppladdningar, underskrifter, fakturor eller partnerpubliceringar görs.

## Rättade fel

- Webbansökan och företagsprofilens JSON-mutationer hade bytegränser men saknade tidsgräns för en ström som aldrig avslutas. Efter fem sekunder avbryts nu läsningen med HTTP 408 före någon skrivåtgärd. Befintliga bytegränser, origin-kontroller och validering behålls.
- PDF-mall och uppladdat signeringsoriginal kunde returnera inmatningsfel efter att fil och registrering redan sparats, om registreringens svar inte gick att validera. Detta ger nu HTTP 503/`unavailable` och behåller återförsöket som obekräftat. Användarinmatning valideras fortfarande separat före lagring.
- Felaktiga identifierare i lagrade fotometadata behandlas som ett obekräftat serversvar, inte som felaktig användarinmatning. Samma fil- och begäransidentitet kan kontrolleras igen.

## Kontrollerade kontrakt

Intern annonskörning kontrollerar aktivering och Bearer-behörighet före body och databas. JSON har en gräns på 4 KiB och exakt fältvalidering. Blockets transport använder fast API-origin och tillåter inte omdirigeringar. Beständig journal och återläsning skyddar mot dubbelsändning vid tappade kvittenser. Företags-/kontobindning, återkallad grupp och unika avgiftsenheter kontrolleras i lokalt SQL-korslager.

Webhooken verifierar den oförändrade råtextens Svix-signatur före tolkning; felaktig signatur, för stor body och fel mottagarlista når inte databasen. Endast fakturamärkta leveranshändelser tillämpas. Tillfälliga eller ogiltiga databaskvitton kvitteras inte som framgång.

Dokumenthämtning kontrolleras för behörighet, företag, signerad version, återkallad åtkomst och korrupt original. Offentlig butik exponerar bara publicerade DTO-fält och bilddata, med kontroller för privata uppgifter och otillåtna query-parametrar.

## Integrationsstatus

**Blocket:** V5-transport och skyddad intern körning finns. Verklig partnercredential, scope och en full partnerresa är inte verifierade i denna granskning. Testerna skickar inte annonser till Blocket.

**Wayke:** kanal-, payload-, pris- och statistikunderlag finns, men extern provideradapter/transport saknas. Verklig publicering till Wayke är därför ännu inte färdig.

Företags-/butiksprofilens API skapar Trafexas interna underlag. Det skapar inte automatiskt butikskonton hos externa annonskanaler.
