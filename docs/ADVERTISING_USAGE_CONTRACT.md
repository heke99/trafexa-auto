# Annonsstatistik och faktureringsunderlag

Beslutad debiteringsmodell: **en unik verifierad publicering per annons och kanal**. Samma Trafexa-annons på Blocket och Wayke ger två enheter. Nya annonsversioner, återförsök och byte av externt annons-ID skapar ingen extra enhet för samma annons och kanal. Köad eller inskickad betyder inte publicerad.

## Källa och spårbarhet

Det privata publiceringsregistret fylls enbart när den betrodda service-workern registrerar en publicerad annons efter verifierat leverantörsbesked. De befintliga anslutnings-, konto-, lager-, versions- och leasekontrollerna gäller fortfarande. Ingen vanlig användare kan ange egna publiceringsantal eller skriva kvitton. Flera företag får inte läsa varandras underlag.

Enheten binds till företag, annons, kanal, ursprungligt leveransjobb/version och extern annonsidentitet. Alla externa ID-alias behålls oföränderligt; samma ID kan inte flyttas till en annan annons för att dölja dubbelräkning. Kollision stoppar publiceringsresultatet atomärt och behöver avstämmas. Externa ID-namnrymder måste bekräftas i respektive verkligt partnerkontrakt före aktivering.

Kalendermånader använder Europe/Stockholm med korrekt sommartid. Nya enheter dateras vid den första verifierade registreringen i Trafexa, inte med ett gissat historiskt publiceringsdatum. Äldre publicerade annonser får ingen uppfunnen månad och debiteras inte på nytt när registret införs.

## Vyer och export

Företagets ägare, administratör och ekonomiansvarig kan läsa underlaget under Annonsering. Superadmin väljer ett företag under Företag → Annonsunderlag och behöver inget företagsmedlemskap. Historiska underlag för ett suspenderat företag är läsbara för aktuell superadmin utan att företagets annonsutskick återaktiveras.

Vald månad visar nya unika publiceringar per kanal. Aktuell jobbstatus visar hela jobbregistret separat; publicerade jobb kan vara flera versioner av samma annons och är inte faktureringsantal. CSV-exporten innehåller period, registreringsstart, kanalantal och separata aktuella jobbstatusar. Privata nedladdningar upprepar faktisk användar-, företags- och behörighetskontroll och återläser underlaget före svar.

Priser är **osatta**. Styckpris och fakturabelopp är null/blankt, aldrig ett påhittat nollbelopp. Detta är ett antalunderlag, ingen utfärdad faktura. Prisavtal, versionsbundet pris i publiceringsögonblicket, periodavstämning/stängning, radvis granskning, moms på Trafexas tjänst och faktisk fakturautställning är separata nästa steg.

## Integrationsgräns

Blocket- och Wayke-adaptrarna förblir inaktiva. Det finns inga verkliga partnercredentials eller aktiva workers i denna leverans och inga externa testannonser skickas. En publiceringskvittens i databasens kontrollerade test är simulerad partnerdata, inte bevis på en aktiv partneranslutning. Innan aktivering behövs kontobunden åtkomst, extern leveransrevision, korrekt CREATE/UPDATE och bevis för den aktuella leverantörsbegäran enligt ADVERTISING_INTEGRATIONS.md. Bankintegrationernas underlag beskrivs separat i BANK_PARTNER_REQUIREMENTS.md.
