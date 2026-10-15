# Momsberäkning version 2 för annonsunderlag

Etappen fortsätter från main `a796bb2` (PR #29). Nya granskade underlag i gränssnittet använder uttryckligen `calculationVersion: 2`. Sparade underlag och fakturor i version 1 behåller sin källa, kontrollsumma, beräkningsmetod och PDF. Att beräkningsversion 2 finns gör inte i sig ett äldre underlag inaktuellt.

## Exakt moms på nettototalen

Den befintliga bedömningen av svensk inrikes standardmoms 25 procent gäller fortfarande: kompletta svenska parter, granskad momsregistrering/momsnummer och betalningsuppgifter krävs. Okänd moms förblir okänd, även vid nollnetto. Alla nedsättningar dras från den ursprungliga publiceringsraden innan moms beräknas.

Version 2 räknar i heltalsören:

1. Summera nettobeloppen för samtliga publiceringsrader.
2. Beräkna total moms som heltalskvoten `(totalNetto * 25 + 50) / 100`. Halva ören avrundas uppåt en gång på totalen.
3. Ge varje rad heltalsdelen av `radNetto * 25 / 100`.
4. Fördela skillnaden mellan total moms och summan av dessa heltalsdelar med ett öre per rad, störst decimalrest först. Vid lika rest avgör publicerings-ID i kanonisk UUID-ordning.
5. Visa raderna i deras ursprungliga ordning. En nollrad får inget fördelat öre.

Summan av radmomsen är därmed exakt lika med momsen på totalnettot, och summan av radbruttot är exakt totalbruttot. Radmomsen är en fördelning av totalmomsen och beskrivs så i UI/PDF. Radens pris och nedsättning ändras inte för att åstadkomma avrundningen. Två rader à 149,50 kr ger 299,00 kr netto, 74,75 kr moms och 373,75 kr inklusive moms; radmomsen blir 37,38 respektive 37,37 kr enligt ID-ordningen. Två rader à två öre ger fyra öre netto, ett öre moms och fem öre inklusive moms. Version 1:s tidigare resultat bevaras när ett äldre dokument öppnas.

JavaScript använder BigInt. PostgreSQL använder numeric med exakt `div` och `mod`; vanlig numeric-division följd av `trunc` används inte som ersättning för heltalsdivision. Vid stora belopp kan sådan division avrundas före trunkeringen. Den additiva rättelsen använder även exakt division i den äldre regelns framtida beräkningar och i fakturautställningens totalmomskontroll. Ingen historisk migrationsfil eller sparad snapshot skrivs om. Nettot `7378697629483820645` öre ger exakt `1844674407370955161` öre moms och `9223372036854775806` öre brutto.

Alla slutliga radbelopp och summor måste rymmas i icke-negativ int64. Mellanresultatet netto × 25 får vara större och beräknas exakt. Högst 2 000 rader, unika publicerings-ID:n och samma oföränderliga original/nedsättningar gäller. Gränsöverskridande avvisas utan trunkering.

## Version, granskning och historik

Versionen binds till källans kanoniska granskningsfingeravtryck och sparas i bedömningen. Version 1 och 2 kan finnas för samma ursprungliga fakturautkast och inställningsversion; de får olika granskningskontrollsummor. Identiskt återförsök och likvärdig källa inom samma beräkningsversion återhämtar samma underlag. Ett återanvänt begärans-ID med annan beräkningsversion avvisas.

Nya additiva `*_v2`-RPC:er används för läsning och sparande. Serveråtgärderna accepterar bara versionsvärdet 1 eller 2 och kontrollerar att svaret motsvarar begärd version. Äldre anrop utan version behåller version 1 för kompatibilitet. Gränssnittets nya läsningar och sparningar begär alltid version 2. Detaljläsningar väljer beräkning från den frysta versionen, aldrig från en aktuell standardinställning. Okänd version eller ändrad öresfördelning med samma total avvisas av parsern.

Ett version-1-underlag som spärras av `vat.roundingMismatch` kan ersättas i arbetsflödet genom att skapa ett nytt granskat version-2-underlag från samma aktuella fakturautkast och välja det vid utfärdande. Det äldre underlaget bevaras. Ändrade faktureringsuppgifter eller rättelser kräver fortfarande aktuella underlag. Ingen ny bedömning får kringgå regeln om en utfärdad faktura per företagsmånad.

## PDF, behörighet och avgränsning

Både den privata underlags-PDF:en och faktura-PDF:en beskriver den frysta beräkningsversionen. Version-1-text och layout behålls exakt; versionsbundna golden-hashprov kompletterar oberoende PostgreSQL-prov av bytes före och efter uppgraderingen. Version 2 beskriver moms på totalnettot med efterföljande öresfördelning. Samma kontroll av aktuellt konto, företag, roll och oförändrad sparad källa före/efter rendering gäller.

Behörigheter, säljar-/företagslås, granskning, historikgräns 100 och 20 poster per sida följer [moms-/betalningskontraktet](ADVERTISING_FINANCIAL_CONTRACT.md). Utfärdande följer fortsatt [fakturakontraktet](ADVERTISING_INVOICE_ISSUANCE_CONTRACT.md), inklusive separat nummerserie, säte, tjänstedatumsbekräftelse och moms på totalen. Ingen verklig kundfaktura, nummerserie, kreditfaktura, betalning eller e-post skapas av utvecklingens tester.

Regeln gäller den implementerade svenska 25-procentsbedömningen. Stöd för andra skattesatser, VMB, omvänd betalningsskyldighet eller Peppol-/ekonomileverantörens exportformat ingår inte. [Skatteverkets fakturainformation](https://www.skatteverket.se/foretagochorganisationer/moms/saljavarorochtjanster/fakturering.4.58d555751259e4d66168000403.html) och [rättsliga vägledning](https://www4.skatteverket.se/rattsligvagledning/edition/2026.11/394342.html) är bakgrunden för fakturans skattebas och öresavrundning; fördelningsordningen mellan rader är Trafexas uttryckligt versionshanterade implementationsregel.

Faktiska resultat, migrationsstatus och driftsgränser redovisas i [IMPLEMENTATION_STATUS](IMPLEMENTATION_STATUS.md).
