# Kreditfakturor för annonsering

En faktisk, tidigare utfärdad annonsfaktura kan krediteras i sin helhet en gång. Superadmin granskar originalet, kreditbeloppet och en uttrycklig orsak innan utfärdandet. Delkreditering, ersättningsfaktura, mejlleverans, betalningsbokning och återbetalning är separata fortsättningar.

Kreditfakturan refererar originalets ID, fakturanummer, fakturadatum och SHA-256. Hela originalkällan sparas i det oföränderliga kreditunderlaget. Rader, tjänstedatum, nettobelopp och moms kopieras exakt från originalet, inklusive dess beräkningsversion och öresfördelning. Beloppen lagras som positiva heltalssträngar i ören med uttrycklig kreditriktning och visas som minskningar i PDF. Ingen ny momsberäkning görs och originalfakturan skrivs aldrig om. En faktura utan något belopp att kreditera blockeras.

Originalhänvisningen följer Skatteverkets [faktureringsvägledning](https://www.skatteverket.se/foretagochorganisationer/moms/saljavarorochtjanster/fakturering.4.58d555751259e4d66168000403.html), som kräver en särskild och otvetydig hänvisning till ursprungsfakturan och dess löpnummer. Produktionsprov av verksamhetens kompletta bokföringsprocess återstår separat.

Kreditdatum är dagens datum i Europe/Stockholm. Den gemensamma säljarens uttryckligt konfigurerade nummerserie för kreditårets kalenderår används, även när originalet kommer från ett tidigare år. Nummer och serie/löpnummer skyddas gemensamt för originalfakturor och kreditfakturor. Förbrukat nummer, dokument och aktörsbundet återförsökskvitto sparas atomiskt. Ett misslyckat utfärdande förbrukar inget nummer. Ett identiskt auktoriserat återförsök återger samma kredit; ändrad begäran med samma nyckel nekas.

Senare ändringar av pris, momsinställningar eller faktureringsprofiler hindrar inte rättelsen av ett redan utfärdat original. Företagets aktuella status och aktörens aktuella godkännande/behörighet kontrolleras däremot vid varje läsning och skrivning. Endast registrerad och godkänd UUID-superadmin utfärdar och konfigurerar serien. Företagets ägare, administratör och ekonomi läser sina egna dokument; försäljare, visningsroller och andra företag nekas.

PDF hämtas privat via `/api/advertising/credits/[id]/pdf`. Företagsval i frågesträngen kräver faktisk superadmin. Dokumentidentitet, oförändrad källa och aktuell behörighet kontrolleras före byteutlämning. Svar använder private/no-store, Cookie-variation och nosniff även vid fel. Tecken som PDF-teckensnittet inte kan återge blockeras före nummeruttag. Ingen betalningsinstruktion, förfallodag eller genomförd återbetalning påstås i kreditfakturan.

Verifieringsresultat och kvarstående produktionskontroller redovisas i [IMPLEMENTATION_STATUS](IMPLEMENTATION_STATUS.md).
