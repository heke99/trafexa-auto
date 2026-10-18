# Granskad förnyelse av kundens dokumentlänk

Handlaren kan efter en ny uttrycklig granskning förnya en utgången personlig dokumentlänk till en offert, ett avtal som kunden ännu inte har godkänt eller ett färdigsignerat avtal. Förnyelsen gäller kundens kontofria dokumentåtkomst. Den skapar inget konto eller lösenord och ändrar inte dokumentets innehåll, mottagare, offertvillkor, underskrifter eller avtalsparter. Grundflödet beskrivs i [kundportalen](CUSTOMER_PORTAL.md).

## Behörighet och granskning

Den verkliga handlaraktör som ursprungligen publicerade offerten eller begärde avtalssigneringen måste fortfarande vara aktiv, verifierad och godkänd samt ha aktuell företagsbehörighet. För offert krävs ägare, administratör eller säljare; för avtalslänkar krävs ägare eller administratör. Finans- och läsroller får inte förnya en länk. En annan kollegas företagsroll eller superadminåtkomst ersätter inte den ursprungliga aktörens dokumentproveniens.

Länkstatus läses först när användaren uttryckligen öppnar den. Statuskontroll skickar inget mejl. Före förnyelse visas mottagare, dokumentreferens, version och länktillstånd. Handlaren anger en motivering och bekräftar både det granskade utskicket och att den tidigare dokumentlänken ersätts. Servern binder granskningen till exakt företag, affär, meddelandetyp, källa, utgången åtkomstpost, tidigare köpost, mottagaradress, dokumenthash, dokumentversion och leveransgeneration.

Bara en faktiskt utgången länk med giltig oförändrad dokumentkälla får ersättas. Ett erbjudande måste fortfarande invänta svar enligt offertens egna villkor; en osignerad avtalslänk får inte användas för en ny kundunderskrift efter att kundens part redan har godkänt. Ett färdigmeddelande kräver båda avtalsparternas sparade bekräftelser och förblir en länk med enbart läsåtkomst. Att förnya länken förlänger inte offertens giltighetstid eller gör ett färdigsignerat avtal osignerat.

## En ny leveransgeneration

Databasen registrerar den granskade förnyelsen och en ny köpost atomiskt. Den tidigare utgångna åtkomstposten återkallas. Ursprungliga köposter, krypterade mejl, providerreferenser, utskicksförsök och dokumentkvitton bevaras som historik; deras mottagare eller innehåll skrivs inte om. En ny generation gäller samma meddelandetyp, dokumentreferens och frysta mottagaradress. Den nya dokumentåtkomsten får en egen giltighet på sju dagar; offertens eller avtalets villkor förlängs inte.

Servern försöker endast behandla det exakta nya kö-ID som granskningens beständiga kvitto anger. Det finns ingen reservväg som väljer ett annat väntande mejl för samma dokument. Innan den nya token binds och innan utskick påbörjas kontrolleras aktuell generation, dokumentets källa, verklig handlaraktör, mottagare, hash och version igen. Den gamla generationens worker får inte skicka efter att en ny generation har ersatt den; ett sent leveransutfall får endast registreras mot sitt historiska kö-ID och lease.

Den nya dokumentnyckeln lagras som hash i åtkomstposten. Det fullständiga mejlet med länken sparas separat krypterat innan extern sändning. Webbläsarens granskningssvar innehåller inga råa dokumentnycklar, krypterade mejlnyttolaster eller serverhemligheter. Kunden får en personlig länk via mejl och öppnar samma dokumentflöde utan inloggning.

## Fel, avbrott och återförsök

Aktiv utskickslease eller okänt providerutfall ger ingen rätt att automatiskt förnya och skicka igen. En väntande post, eller en bearbetningspost vars lease har löpt ut, kan endast ersättas om den saknar sändningsförsök, första försökstidpunkt, providerstartmarkör och providerreferens och inte har någon aktiv lease. Den tidigare posten stoppas då så att den inte ligger kvar som ett skenbart väntande utskick. En aktiv bearbetningslease eller en tidigare providerstart tillåter inte denna återhämtning. En statusuppdatering eller omladdning är aldrig ett nytt utskick.

Begärans-ID, fullständigt granskat underlag och det beständiga kvittot bevaras för ett identiskt återförsök. Ett osäkert nätverkssvar får inte leda till ett nytt UUID eller nytt mejl utan att det tidigare resultatet har klarlagts. Samma kö-ID använder samma frysta mejl och provider-idempotensnyckel vid tillåtna försök. Okänt utfall efter påbörjad providersändning skickas inte automatiskt igen. Provideracceptans betyder att mejltjänsten tagit emot mejlet, inte att kundens inkorgsleverans har verifierats.

Företagsbyte, rollbyte, återkallat konto, förändrad dokumentkälla eller annan mottagare stoppar åtgärden och privat återläsning. Ett avbrott eller ett saknat mejl får inte ta bort en sparad kundaccept eller underskrift. Den tidigare länkens token och kaka ger ingen fortsatt dokumentåtkomst efter återkallelsen; den nya länken ger bara sin uttryckligen bundna åtkomst. Ett färdigsignerat dokuments tidigare signeringsbevis behåller sin ursprungliga åtkomst- och underskriftsproveniens.

## Drift och avgränsning

Förnyelsen använder projektets befintliga offert- och avtalsmejlkonfiguration och samma avsändare: `kundtjanst@trafexa.com`, med svar till `info@trafexa.com`. Saknad eller pausad transport ska visas före ett nytt utskicksförsök. Ingen cron, automatisk ködränering, kundregistrering eller Supabase Auth-inbjudan aktiveras genom funktionen.

Verifierade tester, migrationer och publiceringsstatus redovisas separat i [implementationsstatus](IMPLEMENTATION_STATUS.md). Tester använder syntetiska dokument och mottagare. Dokumentationen är inget bevis för faktisk kundmejlleverans, bankidentifiering, BankID eller kvalificerad elektronisk underskrift.
