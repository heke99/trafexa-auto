# Granskad moms och betalningsvillkor för annonsering

Fortsättning från main `5e694c5` (PR #26). Superadmin öppnar Företag → Annonsunderlag → Fakturering → Visa moms- och betalningsunderlag. Företagets aktuella ägare, administratör och ekonomiansvarig läser egna uppgifter och sparade underlag under Annonsering. Försäljare, läsare och andra företag nekas. Faktisk godkänd UUID-superadmin krävs för ändringar; e-post och klientmetadata ger ingen behörighet.

## Granskning och lagring

Inställningar kan sparas ofullständiga efter uttrycklig granskning och motivering. Inga verkliga bankuppgifter, momsregistreringar eller betalningsvillkor förifylls. Varje ändring får en ny version, kontrollerad föregående version och aktörsbunden återförsöksnyckel. Betalningsvillkor väljs mellan 1 och 90 dagar. Format och kontrollsiffra kontrolleras för Bankgiro, PlusGiro eller svensk IBAN; kontots existens och ägarskap måste kontrolleras separat av administratören.

Ett sparat fakturautkast måste väljas uttryckligen för beräkning. Underlaget får sparas först när båda parters frysta faktureringsuppgifter och aktuella finansiella beslut är kompletta, och det valda utkastet fortfarande motsvarar aktuell källa. Historiskt original, rättelser och nettobelopp skrivs inte om. Inställningar kan öppnas utan valt utkast.

Det enda implementerade momsläget är uttryckligen granskat svensk standardmoms 25 procent: registrerad säljare, momsregistreringsnummer `SE` + säljarens frysta tiosiffriga organisationsnummer + `01`, och båda parternas frysta landskod `SE`. Andra bedömningar kräver ett separat implementerat flöde. Inget registerslag görs för att bekräfta verklig momsregistrering. Saknad bedömning ger okänd moms och totalsumma, även när nettobeloppet är noll.

## Exakta beräkningar och oföränderlighet

Varje publiceringsrad räknas efter samtliga oföränderliga nedsättningar. Med heltalsören är moms per rad `(netto * 25 + 50) / 100`, med heltalsdivision: halva ören avrundas uppåt. Radmoms summeras sedan; avrundning görs inte enbart på totalsumman. Två rader à två öre ger fyra öre netto, två öre moms och sex öre inklusive moms. Detta är en uttrycklig versionshanterad beräkningsregel (`calculationVersion: 1`). JavaScript använder BigInt och databasen exakt numeric; alla radbelopp och summor måste rymmas i positiv int64. Överskridande avvisas utan avrundning eller trunkering.

Sparad status är `reviewed_draft`. Komplett ursprungligt fakturautkast, inställningsversion, källgranskning, rader och summor binds till kanonisk JSON och SHA-256. Identisk utkast-/inställnings-/beräkningsversion återanvänder samma bedömning. Äldre versioner markeras inaktuella vid senare källändring men behåller sitt innehåll och sin PDF, även om nya uppgifter är ofullständiga. Högst 100 versioner per företag och period, 20 historikposter per sida; detaljer läses separat.

SQL använder befintlig global säljarspärr före företagets faktureringsspärr. Skrivningar kontrollerar färsk behörighet, granskade källor, versionskonflikter och kvitton. Privata tabeller saknar direkt klientåtkomst; serveråtgärder verifierar scope, fullständiga kvitton, hashkedja och faktiska beräkningar igen.

## PDF och leveransgräns

Privat PDF hämtas från `/api/advertising/financial/[id]/pdf`; `companyId` som queryparameter är för faktisk superadmin. Företagsläsning använder aktuell vald företagskontext. Behörighet och samma oföränderliga version verifieras före rendering och innan bytes lämnas ut. Alla svar har private/no-store, Vary Cookie och nosniff. Varje sida visar **GRANSKAT UTKAST — EJ UTFÄRDAD FAKTURA**. PDF innehåller frysta parter, nettobelopp, radmoms, totalsumma, momsnummer, betalningsvillkor, konto och källreferenser. Upprepad rendering av samma version ger samma bytes.

Etappen utfärdar inga fakturor och skapar inga fakturanummer, faktura-/förfallodatum, betalningskrav, betalningar, bokföringsposter eller externa utskick. Befintliga fakturautkast och deras PDF behåller sitt tidigare format. Bokföringssystem är ännu inte valt. Fakturautställning, rättelse/kredit, avstämning och ekonomiintegration är fortsatta separata steg.

## Primärkällor och avgränsning

Kontrollerna bygger på följande källor, granskade 15 oktober 2026. De ersätter inte verksamhetens kontroll av det konkreta skattefallet, kontoregistreringen eller mottagarens identitet.

- [Skatteverket: skattesatser, normal moms 25 procent](https://www4.skatteverket.se/rattsligvagledning/edition/2026.14/429414.html).
- [Skatteverket: momsregistreringsnummer](https://www4.skatteverket.se/rattsligvagledning/edition/2026.11/394342.html).
- [Bankgirot: kontonummer med sju eller åtta siffror](https://www.bankgirot.se/tjanster/inbetalningar/bankgironummer/vanliga-fragor/).
- [Bankgiroinbetalningar, användarmanual §5.2.2](https://www.bankgirot.se/globalassets/dokument/anvandarmanualer/bankgiroinbetalningar_anvandarmanual_sv.pdf) och [officiella 10-modul-exempel](https://www.bankgirot.se/globalassets/dokument/anvandarmanualer/10-modul.pdf): kontrollsiffra för Bankgiro och PlusGiro.
- [Nordea: PlusGiro, två till åtta siffror](https://www.nordea.com/en/our-services/domestic-cross-border-payments).
- [SWIFT IBAN Registry, release 103 september 2026](https://www.swift.com/fr/swift-resource/9606/download): svensk IBAN med 24 tecken och MOD97-10.

Verifieringsresultat och faktisk publiceringsstatus finns i [IMPLEMENTATION_STATUS](IMPLEMENTATION_STATUS.md).
