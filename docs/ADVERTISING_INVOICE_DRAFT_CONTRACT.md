# Faktureringsuppgifter och fakturautkast

Detta steg sparar versionerade faktureringsuppgifter och privata granskningsutkast från Trafexas låsta och rättade annonsunderlag. Utkastet har status draft, valuta SEK och momsstatus unresolved. Beloppen är exklusive moms. Dokumentet saknar fakturanummer, förfallodatum, betalningskrav, beräknad moms och belopp inklusive moms. Fakturautställning, bokföring och mejlutskick ingår inte.

## Faktureringsuppgifter

Kundens juridiska namn och organisationsnummer hämtas från det faktiska företaget. Kontakt- och adressfälten är faktureringsmejl, postadress, extra adressrad, postnummer, ort, uttrycklig landskod och referens. Säljarens profil har dessutom juridiskt namn och organisationsnummer. Uppgifterna sparas som oföränderliga versioner med aktuell versionskontroll, granskning och aktörsbundna begärans-ID.

Aktuell godkänd UUID-superadmin kan ändra kund- och säljaruppgifter. Företagets ägare och administratör kan ändra sitt eget företags kontakt- och adressuppgifter; ekonomiansvarig har läsåtkomst. Säljarprofilen är gemensam för Trafexa. Inga användarredigerbara administratörsmetadata ger åtkomst. Superadmin kan läsa historik för suspenderade företag; företagsvyn kräver aktuellt aktivt medlemskap, aktivt företag och godkänt konto.

Delvis ifyllda profiler kan sparas. Företagsnamn, organisationsnummer, faktureringsmejl, postadress, postnummer, ort och landskod redovisas som saknade när uppgiften är okänd. En mejladress används inte som postadress. Tidigare bekräftat säljarföretag kan fyllas i genom ett uttryckligt val i formuläret, men sparas först efter granskning. Faktureringsuppgifter som är kompletta innebär inte att fakturan är färdig för utställning; momsbedömning återstår alltid i detta steg.

## Sparat utkast

Endast superadmin får skapa ett fakturautkast. Det kräver ett låst original och granskning av exakt aktuellt rättelseunderlag och aktuella uppgiftsversioner. Underlaget innehåller originalrader och antal, nedsättningar, återstående belopp, båda parternas uppgifter och alla saknade fält. Beloppen beräknas med heltalsöre och BigInt/numeric utan flyttalsavrundning. Noll efter full nedsättning bevarar originalraden och antalet.

En kanonisk JSON-text och SHA-256-kontrollsumma binder hela utkastets källa. Likvärdig källa ger samma sparade utkast; återförsök med samma begäran skapar ingen extra version. Ändrad granskad källa eller uppgiftsversion kräver ny granskning. Kvittot kontrolleras mot företag, faktisk administratör, begäran, utkast och källhash. Säljarens globala lås tas före företagets faktureringslås för att profil- och utkaständringar ska följa samma låsordning.

Nya faktureringsuppgifter och senare rättelser ändrar inte ett sparat utkast. Aktuell jämförelse i appen markerar äldre utkast som inaktuella. Högst 100 utkastsversioner tillåts per företag och månad. Historiken läses i sidor om högst 20 versioner och varje valt utkast hämtas separat med aktuell behörighet. Utkastsversion och internt ID är granskningsreferenser, inte en fakturanummerserie.

## Privat PDF

`/api/advertising/invoices/[id]/pdf` återger endast den valda sparade versionen. Företagsvalet kommer från den inloggade företagskontexten; uttrycklig companyId-frågeparameter kräver faktisk superadmin. Identitet och sparad källa kontrolleras igen efter rendering innan bytes lämnas ut. Förändrad aktuell profil får markera versionen som inaktuell utan att skriva om dess PDF. Svar är privata och cachelagras inte.

Varje PDF-sida märks UTKAST — EJ UTFÄRDAD FAKTURA. Dokumentet visar versionsbundna adresser, referenser, original-/rättelsebelopp, saknade uppgifter och kontrollsummor. Skapande- och ändringsdatum i PDF-metadata kommer från den sparade versionen, vilket ger samma bytes vid upprepad rendering av samma utkast. Typsnittet levereras med funktionen; text med tecken som inte stöds avvisas kontrollerat.

## Nästa ekonomisteg

Faktisk utställning behöver vald bokföringskoppling, fastställd momsbedömning, kompletta rättsliga fakturauppgifter, betalningsvillkor, betalningsuppgifter och kontrollerad nummerserie. Därefter behövs leveransbekräftelser, betalningsavstämning och juridiska kreditfakturor. Ägaren har ännu inte valt bokföringssystem. Dessa frågor kan förberedas medan ofullständiga utkast granskas.
