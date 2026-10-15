# Publika handlarbutiker i Trafexa

## Status och avsikt

Pågående etapp från PR #34/main `b79032211fb1f9aacd1e3defdc41da53faeac6c3`, 15 oktober 2026. Användaren har uttryckligen begärt publik butik med valda annonser. Funktionen är implementerad och verifierad inför publicering: integrerad helsvit 1139/1139, produktionsbygge inklusive TypeScript och hosted rollbackprov passerar. Publiceringen återstår att verifiera. Se [IMPLEMENTATION_STATUS](IMPLEMENTATION_STATUS.md).

## Uttryckligt publiceringsval

Handlaren ska granska sin aktuella privata butiksprofil och uttryckligen välja högst 50 aktuella färdiga annonser för tillgängliga lagerbilar. Endast den granskade offentliga profilen och de valda annonserna får visas. Ändrat eller inaktuellt underlag kräver ny kontroll; en privat sparad profil eller ett annonsutkast är inte ett publiceringsbeslut.

Ingen befintlig butik, profil, bild eller annons publiceras genom automatisk återfyllnad. Funktionens införande gör inga befintliga verkliga uppgifter publika. Företagets interna kostnader, inköpsuppgifter, kunddata, medlemskap, credentials och privata arbetsanteckningar ingår inte i den offentliga informationen.

## Offentlig läsning och bilder

Publik webb och JSON-läsning använder en uttrycklig lista över tillåtna fält. Uttryckligen godkända och utvalda annonsbilder blir offentligt läsbara genom Storage-RLS. `get_public_store_photo` lämnar avsiktligt deras kanoniska `objectPath`; referensen innehåller namnrymds-UUID som medieidentifierare. Övriga bilder och annonser blir inte anonymläsbara. De utvalda bilderna använder ursprungligen uppladdade och normaliserade bildbytes som handlaren valt att publicera. Appens bildproxy normaliserar svaret, använder no-store och kontrollerar publiceringen igen efter nedladdning, men all möjlig byteåtkomst går inte genom proxyn och lagringssökvägarna är inte hemliga. Avpublicering kan inte återkalla bytes som någon redan laddat ned. Vanliga privata API:er kräver fortsatt sin ordinarie autentisering och företagsbehörighet.

Annonsfält för registreringsnummer, interna kostnader och kunduppgifter ingår inte i den offentliga listan; detta är inte ett löfte om att alla identifierare saknas i mediereferenser. Andra aktörer får läsa det publicerade JSON-underlaget som offentlig information. Detta innebär ingen generell partnernyckel, privat API-åtkomst eller rätt att ändra butiken. Privat partnerintegration måste ha ett separat verifierat behörighetskontrakt.

## Trafexa och externa annonsörer

Publicering i Trafexa är separat från valet att annonsera hos Blocket eller annan extern kanal. En publik Trafexa-butik skapar inget externt butikskonto och ger inget bevis för extern publicering. Kanalval, granskat pris, leveransjournal och faktureringsstatistik behåller sina egna regler. [Blockets gruppanslutning](BLOCKET_GROUP_SETUP.md) kräver fortsatt verifierad credential och kontoåtkomst före faktisk sändning.

## Verifierad delkontroll

Native SQL passerar 11/11 på 30 380,286749 ms med den fulla lokala kedjan om 117 migrationer. Butikshantering, offentlig serverrendering och mobil Chromium passerar 16/16 på 7 350,233895 ms. Befintlig arbetsyteregression passerar 102/102 och separat serveråtgärds-/HTTP-kontroll nio fall. Överlappande appfall adderas inte. Publikt produktionsflöde är ännu inte verifierat och inga verkliga butiker har publicerats av testningen.
