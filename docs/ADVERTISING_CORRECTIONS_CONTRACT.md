# Rättelser av låsta annonsunderlag

Rättelser är separata, oföränderliga nedsättningar av det interna faktureringsunderlaget. De är ingen faktura eller kreditfaktura. Alla belopp anges i SEK, heltalsöre, exklusive moms. Originalets publiceringar, antal, priser, kontrollsumma och låsning bevaras.

## Belopp och granskning

En nedsättning måste avse en publiceringsrad i exakt det låsta originalet för företaget och månaden. Beloppet måste vara positivt och får tillsammans med tidigare nedsättningar inte överstiga originalradens belopp. En rad som satts ned helt har fortfarande antal ett och återstående belopp noll. Nya kanalpriser och ändrade aktuella publiceringsuppgifter används inte för att beräkna rättelser.

Superadmin anger rad, belopp och motivering, granskar uppgifterna och bekräftar med en från början omarkerad kryssruta. Motiveringen har högst 500 tecken och får inte innehålla kontrolltecken. Granskningen binds till en SHA-256-kontrollsumma över företag, månad, originalets ID och kontrollsumma, hela den ordnade rättelsehistoriken och exakta belopp. Ändrad historik kräver ny granskning.

Beloppen räknas med PostgreSQL numeric/bigint och JavaScript BigInt. Samma företagslås som vid prissättning och periodstängning samordnar kontroll och lagring. Begärans-ID förhindrar dubbla nedsättningar vid återförsök; återanvändning med ändrade uppgifter ger konflikt. Kvittot binds till faktisk administratör, företag, begäran, original och rättelserad. Återförsök kontrollerar aktuell behörighet först.

## Åtkomst och historik

Endast aktuellt godkänd UUID-superadmin kan registrera nedsättningar. Användarredigerbara metadata ger ingen behörighet. Företagets aktuella ägare, administratör och ekonomiansvarig har läsåtkomst. Företagsvyn kräver aktivt företag, aktuellt medlemskap och godkänt konto. Superadmin kan läsa historik även för ett suspenderat företag.

Rättelser kan inte redigeras eller raderas. Privat databaslagring innehåller faktiskt administratörs-ID och begäransuppgifter. Företagets läsvy visar granskningsreferens, belopp, datum, motivering och avsändarrollen Superadmin utan andra administratörers Auth-ID. Behörigheten kontrolleras både före och efter serveråtgärder.

## Vyer och export

Rättelser visas från det låsta månadsunderlaget via Visa rättelser av låst underlag. Ursprungligt belopp, sammanlagd nedsättning, återstående belopp och radvis historik visas tillsammans. Upp till 2 000 rättelser tillåts per period. Större historik avvisas atomiskt och kräver en separat lösning för större volymer.

Originalets CSV ändras inte. En separat privat export finns på `/api/advertising/billing/[month]/corrections/csv`. Den innehåller originalrader, bevarade antal, originalbelopp, nedsättning och återstående belopp i exakta ören, rättelse-ID, motivering, datum och båda kontrollsummorna. Underlaget läses tillbaka och aktuell behörighet kontrolleras innan bytes lämnas ut. En samtidig rättelse stoppar exporten så att användaren kan läsa in och granska igen. Svar är privata och cachelagras inte; fritext neutraliseras mot kalkylbladsformler.

## Fortsatt ekonomi

Rättelse av en felaktig nedsättning och efterdebitering behöver ett eget granskat flöde innan det kan aktiveras. Fakturautställning behöver fullständiga säljar-/kunduppgifter och adresser, skatteregler, nummerserie, betalningsvillkor, betalningsuppgifter och valt bokföringssystem. Detta steg skickar inga externa annonser, fakturor, betalningar eller mejl.
