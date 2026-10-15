# Utfärdande av annonsfakturor

Denna etapp bygger vidare på main `3332905` (PR #27) och sammanfogar företags-/butiksprofilernas main `20cb4d1` (PR #28). Fakturautställning är en separat åtgärd efter sparat granskat moms-/betalningsunderlag. Granskade utkast behåller sitt format och blir inte automatiskt fakturor. Inga verkliga nummerserier, bankuppgifter eller fakturor konfigureras av utvecklingens testprov.

## Användarflöde och behörighet

Superadmin öppnar ett valt sparat granskat underlag under Företag → Annonsunderlag → faktureringsuppgifter → moms- och betalningsunderlag. Fakturering öppnas uttryckligen för den valda bedömningen. Företagets aktuella godkända ägare, administratör och ekonomiansvarig läser egna utfärdade fakturor; övriga roller och andra företag nekas. En vald bedömning krävs även för att konfigurera nummerserien, så säljarens juridiska identitet kommer från ett verifierat underlag.

Endast faktisk godkänd UUID-superadmin får konfigurera eller utfärda. E-postadress och klientmetadata är inte behörighetskällor. Byte av företag, användare, roll eller underlag återställer den privata vyn. Nekad åtkomst rensar även den överordnade ekonomivyn.

## Explicit nummerserie och juridiska uppgifter

En gemensam nummerserie används för säljarens organisationsnummer och serverns aktuella år i Europe/Stockholm. Prefix, första nummer, registrerat säte för bolagets styrelse och motivering måste anges och granskas uttryckligen. Inget aktivt startnummer eller prefix förifylls. Postort används aldrig som antaget registrerat säte. Administratören måste kontrollera att serien är avsedd för Trafexa och inte återanvänder nummer från annan fakturering; databasen kan inte verifiera ett externt bokföringssystems historik.

Formatet är `PREFIX-ÅR-LÖPNUMMER`, med minst sex siffror i löpnumret. Prefix har 2–12 versala bokstäver/siffror. Första och utfärdade löpnummer ligger mellan 1 och 999999999. Årsindelningen är ett produktval. Konfigurationen är oföränderlig och kan inte återställas eller bytas genom det här flödet; ett senare ändringsflöde kräver separat granskning utan att återanvända nummer. Samma prefix/år och samma fullständiga fakturanummer kan inte registreras två gånger. Säljarens serie delas över företagskunder; kunden ser inte den globala räknaren eller administratörens motivering.

## Granskning före utfärdande

Den valda bedömningen måste fortfarande motsvara aktuell säljar-/köparprofil, aktuella rättelser och moms-/betalningsinställningar. Servern visar föreslaget fakturanummer, dagens fakturadatum i Stockholm, förfallodatum och varje annonsrads datum. Förfallodatum är fakturadatum plus de frysta betalningsdagarna, räknat som kalenderdagar. Nummerreservering sker först vid lyckat utfärdande. Om en annan kund använder numret, ett dygnsskifte sker eller underlaget ändras måste administratören uppdatera och granska igen.

Varje ursprunglig publiceringsrads `publishedAt` är tidpunkten för verifierad registrering i Trafexa. Det är inte automatiskt verifierat att annonskanalen utförde tjänsten just då. En separat, från början omarkerad bekräftelse kräver att administratören kontrollerar att de visade datumen motsvarar de faktiska tjänstedatumen. Om datumen inte stämmer ska utfärdandet inte bekräftas; etappen skriver inte om den historiken. Fakturan fryser dessa uttryckligen granskade tjänstedatum per rad och visar också faktureringsperioden.

En period utan tjänsterader kan inte utfärdas. Ett känt nollbelopp med faktiska rader får granskas och utfärdas uttryckligen. Svensk inrikes standardmoms 25 procent, exakta heltalsören och radvis HALF UP efter nedsättningar bevaras från bedömningen. Inga nya skatteantaganden eller avrundningar till hela kronor införs. Som ytterligare villkor måste summan av den sparade radmomsen vara exakt lika med 25 procent av periodens nettobelopp, avrundat HALF UP till öre. Om dessa två beräkningar skiljer sig blockeras utfärdandet (`vat.roundingMismatch`), utan att det tidigare granskade underlaget skrivs om. En kompletterande beräkningsversion behövs för sådana underlag. Etappen hävdar inte att radvis avrundning är ett lagstadgat val eller ett färdigt Peppol-/bokföringsformat. Uppgifter som inte kan återges med renderer v1:s faktiska typsnitt blockerar utfärdande även via direkt RPC, före nummersättning.

## Transaktion, återförsök och sparat original

Globalt säljar-/faktureringslås tas före företagets lås, enligt befintligt kontrakt. Kontroll av källor, tilldelning av nästa nummer, fakturans oföränderliga snapshot och aktörsbundet återförsökskvitto hör till samma transaktion. Ett fel rullar tillbaka räknaren tillsammans med fakturan. Samma användares identiska begäran återhämtar den redan utfärdade fakturan efter färsk behörighetskontroll, även efter ändrad källa eller datum. Ändrad payload med samma begärans-ID avvisas.

Högst en faktura får utfärdas för samma företagsmånad, även om det finns flera bedömningar eller inställningsversioner. Senare rättelser/profiländringar kan markera källan som ändrad efter utfärdandet; fakturan bevaras och blir inte ett nytt utkast. En ny bedömning får inte orsaka dubbel fakturering. Kreditfaktura, ersättningsfaktura och avstämning behöver egna fortsatta flöden.

Sparad status är `issued`, med `rendererVersion: 1`. Fullständig bedömning, juridisk seriekonfiguration, fakturanummer, datum, tjänsterader, belopp och granskning binds i kanonisk JSON och SHA-256. Serveråtgärder och PDF-parser verifierar identitet, hashkedja, datum, belopp, kvitton och behörighet igen. Tabellen kan inte ändras eller raderas genom klientåtkomst.

## PDF och driftgräns

Privat PDF finns på `/api/advertising/issued/[id]/pdf`; `companyId` i query är för faktisk superadmin. Den egna företagsvyn använder aktuell vald företagskontext. Samma sparade faktura och färsk behörighet kontrolleras före rendering och innan bytes lämnas ut. Alla svar har private/no-store, Vary Cookie och nosniff.

Renderer v1 visar fakturanummer, faktura-/förfallodatum, säljarens juridiska namn, organisationsnummer, momsnummer, postadress och registrerade säte; köparens namn/adress; tjänsternas art, omfattning, granskade datum, antal, enhetspris, nedsättning, netto, momssats och momsbelopp; betalningskonto och referens. Samma sparade källa ger identiska bytes vid upprepad rendering med denna renderer och dess paketerade typsnitt. Fakturan är inte ett betalningskvitto. Databasbackup och återställningsrutiner krävs för det sparade ekonomiska originalet; separat bytearkivering och långtidsbevarande är fortsatta driftuppgifter.

Ingen e-post skickas vid utfärdande i denna etapp. Automatisk bankanslutning, betalstatus, påminnelser, ränta, inkasso, kreditfakturor, bokföring och integration med valt ekonomisystem ingår inte. Ekonomileverantör är ännu inte vald. Verifierad driftstatus och testernas praktiska gränser redovisas i [IMPLEMENTATION_STATUS](IMPLEMENTATION_STATUS.md).

## Primärkällor

- [Skatteverket: fakturering och fakturans innehåll](https://www.skatteverket.se/foretagochorganisationer/moms/saljavarorochtjanster/fakturering.4.58d555751259e4d66168000403.html): fakturadatum, unikt löpnummer i serie, momsnummer, parter/adresser, tjänstens art/omfattning och datum, belopp, nedsättning, momssats och momsbelopp.
- [Bolagsverket: uppgifter på webbplats, fakturor m.m. för aktiebolag](https://bolagsverket.se/foretag/aktiebolag/startaaktiebolag/foretagsnamnochverksamhetforaktiebolag/uppgifterpawebbplatsfakturormmforaktiebolag.495.html): företagsnamn, styrelsens registrerade säte och organisationsnummer.
- [Skatteverkets rättsliga vägledning om momsuppgifter och avrundning](https://www4.skatteverket.se/rattsligvagledning/edition/2026.11/394342.html). Se även [det befintliga moms-/betalningskontraktets källor](ADVERTISING_FINANCIAL_CONTRACT.md).

Dessa källor styr den avgränsade implementationen och ersätter inte verksamhetens granskning av det konkreta skattefallet och de uppgifter som bekräftas.
