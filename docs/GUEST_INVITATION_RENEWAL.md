# Granskad förnyelse av kundens dokumentlänk

Handlaren kan förnya en personlig länk till en obesvarad offert, ett avtal som kunden ännu inte har godkänt eller ett färdigsignerat avtals skrivskyddade dokument. Kunden behöver fortsatt inget Trafexakonto. Förnyelsen gäller samma frysta mottagare, dokumentversion och innehållshash; ändrade affärsvillkor kräver ett nytt dokumentflöde.

## Granskning och behörighet

Handlaren kontrollerar mottagare, version och den tidigare länkens giltighetstid före en uttrycklig bekräftelse. Offertlänkar får förnyas av ägare, administratör eller säljare. Avtalslänkar får förnyas av ägare eller administratör. Befintliga läsbehörigheter gäller även länkstatus. Superadmin får inte företagets skrivbehörighet genom sin plattformsroll.

En accepterad leverans kan förnyas när den senaste personliga länken faktiskt har gått ut. Ett utgånget, fortfarande väntande mejl har ett separat granskat återhämtningsläge: servern måste kunna verifiera att utskicket saknar aktiv arbetarlåsning, leverantörsacceptans och påbörjad sändning med oklart utfall. Förberett men ännu obundet dokument tillåts bara när inget försök har påbörjats. Försöksmarkörer måste vara konsekventa. Efter en bekräftad återförsökbar avvisning, exempelvis 429, kan en utgången väntande länk ersättas med en ny generation. Ett vanligt återförsök förlänger aldrig den gamla länken.

Vid återhämtning stoppas det gamla väntande mejlet och den nya generationen skapas atomiskt. Samtidig hantering av det gamla mejlet kan inte skapa ett andra utskick. Pågående, avvisade, stoppade eller okända leveranser förnyas inte genom återhämtningsåtgärden. Okänt leveransutfall kräver kontroll hos mejltjänsten.

Kundens redan registrerade svar och återkallade eller ogiltiga underlag ger inte rätt att skapa en ny godkännandelänk. För ett verkligt färdigsignerat avtal förnyas enbart läslänken till samma PDF och signeringsbevis. Kunden kan inte signera någon part eller lämna ett nytt offertsvar med den länken. Tidigare underskrifter, arkiverade original och betalnings- eller leveransregistreringar ändras inte. Läslänken kan förnyas även efter genomförd leverans när dokumentets ordinarie behörighetskontroller fortfarande passerar.

## Beständigt försök och leverans

En ny leveransgeneration får ett eget kö-ID och en separat personlig dokumentnyckel. Det ursprungliga utskicket och tidigare kvitton bevaras. Ursprungshändelsens idempotens gäller fortsatt generation noll. Statusläsningar väljer den senaste generationen för rätt dokument och frysta mottagare.

Förnyelsebegäran binder aktör, företag, affär, dokumenttyp, dokument, tidigare kö-ID, generation och dokumenthash till ett stabilt UUID. Samma UUID och samma underlag återger samma sparade kvitto. Samtidiga nya begäranden mot samma gamla generation kan inte skapa två förnyelser. En bekräftad konflikt kräver ny granskning; vid ett osäkert svar behålls det ursprungliga försöket även efter omladdning i samma webbläsarflik.

Servern försöker skicka exakt den nya köposten. En förnyelse är inte bevis på inkorgsleverans. Saknad eller pausad transport lämnar mejlet väntande. Tillåtna återförsök behåller kö-ID, krypterat mejlinnehåll och leverantörens idempotensnyckel. Okända utfall skickas inte automatiskt igen. Nycklar och krypterat mejlinnehåll lämnas inte till handlarens gränssnitt.

Ursprungsaktören för dokumentet och den handlare som förnyar länken är separata. Bådas relevanta behörighet kontrolleras före utskick; en köad förnyelse får inte skickas efter att förnyarens behörighet återkallats. Återläsning av ett tidigare förnyelsekvitto kräver samma aktör och roll som vid begäran. Förnyelsen flyttar inte dokumentets ursprung eller kringgår återkallad behörighet. Gamla länkar fortsätter att omfattas av sin ursprungliga utgångstid; en förnyelse gör dem inte giltiga igen.

## Verifiering

Aktuell test-, migrations- och publiceringsstatus dokumenteras i [IMPLEMENTATION_STATUS](IMPLEMENTATION_STATUS.md). Testerna använder syntetiska underlag och mockad mejlleverantör. Verklig inkorgsleverans är ett separat prov.
