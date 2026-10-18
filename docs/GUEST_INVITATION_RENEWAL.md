# Historisk checkpoint PR #51: Granskad förnyelse av kundens dokumentlänk

Denna sida beskriver den första publicerade etappen. Det aktuella gemensamma flödet och dess kompatibilitet med sparade köposter beskrivs i [granskad förnyelse av dokumentlänkar](CUSTOMER_DOCUMENT_LINK_RENEWAL.md).

Handlaren kan förnya en personlig länk till en obesvarad offert eller ett avtal som kunden ännu inte har godkänt. Kunden behöver fortsatt inget Trafexakonto. Förnyelsen gäller samma frysta mottagare, dokumentversion och innehållshash; ändrade affärsvillkor kräver ett nytt dokumentflöde.

## Granskning och behörighet

Handlaren kontrollerar mottagare, version och den tidigare länkens giltighetstid före en uttrycklig bekräftelse. Offertlänkar får förnyas av ägare, administratör eller säljare. Avtalslänkar får förnyas av ägare eller administratör. Befintliga läsbehörigheter gäller även länkstatus. Superadmin får inte företagets skrivbehörighet genom sin plattformsroll.

Förnyelse tillåts endast när det senaste utskicket har accepterats av mejltjänsten och dess personliga länk faktiskt har gått ut. En pågående, väntande, avvisad, stoppad eller okänd leverans blir inte ett nytt utskick genom den här åtgärden. Ett väntande mejl har sitt befintliga granskningsflöde. En redan utgången länk med väntande mejl behöver hanteras med Trafexa; ett vanligt återförsök kan inte förlänga länken. Okänt leveransutfall kräver kontroll hos mejltjänsten.

Kundens redan registrerade svar, återkallade eller ogiltiga underlag och färdigmeddelanden ger inte rätt att skapa en ny godkännandelänk. Den här etappen förnyar inte läslänken till ett färdigt avtal.

## Beständigt försök och leverans

En ny leveransgeneration får ett eget kö-ID och en separat personlig dokumentnyckel. Det ursprungliga utskicket och tidigare kvitton bevaras. Ursprungshändelsens idempotens gäller fortsatt generation noll. Statusläsningar väljer den senaste generationen för rätt dokument och frysta mottagare.

Förnyelsebegäran binder aktör, företag, affär, dokumenttyp, dokument, tidigare kö-ID, generation och dokumenthash till ett stabilt UUID. Samma UUID och samma underlag återger samma sparade kvitto. Samtidiga nya begäranden mot samma gamla generation kan inte skapa två förnyelser. En bekräftad konflikt kräver ny granskning; vid ett osäkert svar behålls det ursprungliga försöket även efter omladdning i samma webbläsarflik.

Servern försöker skicka exakt den nya köposten. En förnyelse är inte bevis på inkorgsleverans. Saknad eller pausad transport lämnar mejlet väntande. Tillåtna återförsök behåller kö-ID, krypterat mejlinnehåll och leverantörens idempotensnyckel. Okända utfall skickas inte automatiskt igen. Nycklar och krypterat mejlinnehåll lämnas inte till handlarens gränssnitt.

Ursprungsaktören för dokumentet och den handlare som förnyar länken är separata. Bådas relevanta behörighet kontrolleras före utskick; en köad förnyelse får inte skickas efter att förnyarens behörighet återkallats. Återläsning av ett tidigare förnyelsekvitto kräver samma aktör och roll som vid begäran. Förnyelsen flyttar inte dokumentets ursprung eller kringgår återkallad behörighet. Gamla länkar fortsätter att omfattas av sin ursprungliga utgångstid; en förnyelse gör dem inte giltiga igen.

## Verifiering

Aktuell test-, migrations- och publiceringsstatus dokumenteras i [IMPLEMENTATION_STATUS](IMPLEMENTATION_STATUS.md). Testerna använder syntetiska underlag och mockad mejlleverantör. Verklig inkorgsleverans är ett separat prov.
