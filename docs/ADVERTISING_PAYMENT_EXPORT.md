# CSV för avstämning av en annonsfaktura

Exporten samlar en utfärdad annonsfakturas manuella avstämning och hela dess betalningsjournal i en privat CSV-fil. Den är ett granskningsunderlag för Trafexas registreringar. Den hämtar inga bankuppgifter och är inget kontoutdrag, bokföringsverifikat eller importformat för ett ekonomisystem. Filen ändrar inga fakturor, kreditfakturor, betalningsposter eller pengar. Grundflödet beskrivs i [avstämningskontraktet](ADVERTISING_PAYMENT_RECONCILIATION.md).

## Åtkomst och vald version

Verklig aktiv superadmin kan exportera en uttryckligen vald faktura för ett företag. Företagets aktuella, godkända ägare, administratör och ekonomiansvariga kan exportera egna fakturor. Försäljar- och visningsroller saknar denna åtkomst. Företagets och medlemskapets aktuella status gäller fortfarande för handlarens läsning; superadmins särskilda åtkomst till historisk avstämning följer grundkontraktet. E-postadress, klientmetadata eller ett angivet företags-ID ger ingen behörighet.

Begäran binder företag, faktura, fakturans sparade källhash och den avstämningstoken som användaren har läst in. Servern kontrollerar faktisk aktör och roll, hämtar journalens samtliga sidor och prövar åter aktuell åtkomst innan CSV lämnas ut. Ett företagsbyte eller en återkallad behörighet får inte ge en fil från tidigare åtkomst.

Varje sida måste avse samma företag, faktura, aktör, roll, fakturakälla och avstämningsversion. Ordning, unika journalposter, sidmarkörer och totalt postantal kontrolleras. Ett sista återläsningsprov kontrollerar att den granskade fakturans avstämning fortfarande motsvarar den exporterade versionen. Samtidig inbetalning, återföring eller kredit som ändrar avstämningsunderlaget stoppar exporten; användaren behöver då uppdatera och granska på nytt. Exporten påstår inte att flera serveranrop delar en atomisk databassnapshot.

## Innehåll och historiska hänvisningar

Filen innehåller fakturans identitet och källhash, avstämningsversion, SEK-belopp i heltalsören samt journalens frysta inbetalnings- och återföringshändelser. Registreringens tid, aktör, motivering, transaktions-ID och bankmeddelande hör till den privata granskningshistoriken. En eventuell kredit sänker fordran enligt grundkontraktet; inbetalningar och överskott är fortsatt registrerade belopp, inte bekräftade återbetalningar.

En rättad nyregistrering kan hänvisa till en tidigare post hos ett annat företag. Exporten följer inte sådana hänvisningar och hämtar inga främmande företagsnamn, fakturor eller bankdetaljer. Ett historiskt post-ID är en opak hänvisning och ger ingen åtkomst till dess innehåll. Föränderliga markeringar om en posts senare ersättningsstatus används inte som frysta journalhändelser i exporten.

Fakturans och varje journalposts sparade kontrollsummor bevaras. Filens SHA-256 identifierar exakt de exporterade UTF-8-bytesen; den är en innehållskontroll, inte en elektronisk underskrift eller bankbekräftelse.

## Format och gränser

CSV använder UTF-8 med BOM, semikolon som avgränsare, citerade celler och CRLF-radbrytningar. Citattecken i text dubbleras. Fritext som skulle kunna tolkas som en kalkylbladsformel neutraliseras även när inledande blanktecken eller osynliga kontrolltecken förekommer. Åtgärden gäller exporten; den frysta originaltexten i journalen skrivs inte om.

Belopp och journalnummer behandlas som decimalsträngar och BigInt. De får aldrig gå genom JavaScripts `Number`. För att behålla mycket stora tal och identifierare exakt i ett kalkylprogram ska motsvarande kolumner importeras som text; Automatisk öppning kan annars avrunda stora tal eller ta bort inledande nollor i identifierare och referenser. CSV innehåller inga formeluttryck som styr kalkylprogrammets celltyper.

Högst 10 000 journalposter på 200 sidor exporteras per faktura. CSV-filen begränsas till 2 MiB och hela det serialiserade framgångssvaret till 3 MiB, inklusive JSON-escapning. Ofullständig sidindelning, ändrad version, felaktiga kontroller eller överskriden gräns ger ingen delvis färdig fil. Exporten är en uttrycklig läsåtgärd och skapar ingen beständig exportkö eller automatisk bokföringsöverföring.

## Verifieringsläge

Funktionens verifierade tester och publiceringsstatus redovisas i [implementationsstatus](IMPLEMENTATION_STATUS.md). Detta kontrakt är inte bevis för att en viss produktionsanvändare har laddat ned filen eller att en extern bank- eller bokföringstjänst har kontrollerat innehållet.
