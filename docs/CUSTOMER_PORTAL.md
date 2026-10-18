# Kundens offert- och avtalsflöde via mejllänk

Kunden öppnar sitt dokument från en personlig mejllänk. Flödet skapar inget kundkonto, lösenord, Auth-användare, kontogodkännande eller företagsmedlemskap. Handlaren använder fortsatt sitt vanliga godkända företagskonto.

## Handlarens steg

1. Publicera kundens offert för granskning. Ägare, administratör och säljare använder sina befintliga behörigheter.
2. Kunden får en länk till exakt den publicerade offertversionen och kan acceptera eller avböja den med namn och uttrycklig bekräftelse.
3. Ägare eller administratör väljer en godkänd avtalsmall och skapar ett osignerat utkast från den accepterade offerten.
4. Efter separat granskning begär handlaren underskrifter. Kunden får en ny dokumentlänk till avtalet, läser villkoren och bekräftar med sitt namn och en kryssruta. Ingen ritad signatur krävs i gästflödet.
5. Företagets behöriga företrädare bekräftar sin part. Kundens och företagets bekräftelser binds till samma dokumenthash. Kunden kan därefter öppna det färdiga underlaget från dokumentlänken och hämta PDF och signeringsbevis medan länken gäller. Ett färdigmeddelande använder en separat länk med endast läsåtkomst.

En sparad signeringsbegäran är inte ett leveranskvitto. Handlarens mejlkort visar faktisk köstatus och utskicksinställning. Ett befintligt väntande mejl kan hanteras efter uttrycklig granskning och aktuell skrivbehörighet. Accepterat av mejltjänsten betyder inte bekräftad inkorgsleverans. Okänt utfall efter en påbörjad providersändning skickas inte igen automatiskt. Den senaste accepterade och utgångna länken kan [förnyas efter separat granskning](GUEST_INVITATION_RENEWAL.md) medan kunden fortfarande kan lämna sitt första svar eller avtalsgodkännande. Ett okänt leveransutfall eller ett färdigt avtals läslänk omfattas inte av förnyelsen.

## Dokumentlänken

`/customer-document/invitation?invitation=UUID&token=…` tar emot en slumpmässig 256-bitars dokumentnyckel, kodad med 43 base64url-tecken. Servern flyttar nyckeln till en HttpOnly-kaka begränsad till `/customer-document` och skickar vidare till dokumentvyn utan token i adressfältet. Länken gäller i sju dagar och ger endast åtkomst till sitt bundna dokument. Länknyckeln ger ingen generell kund- eller företagsåtkomst.

Den privata åtkomstposten binder dokumenttyp, dokument-ID, fryst mottagaradress, version och innehållshash. Där lagras nyckelns SHA-256. Servern kontrollerar behörigheten före läsning och bekräftelse. Gäståtkomstens databasfunktioner får endast anropas av den betrodda servern; webbläsaren får inga serviceuppgifter. Samma begärans-ID och innehåll ger samma sparade kvitto, och ändrat innehåll eller en inaktuell version avvisas.

Kundens svar och avtalsbekräftelse sparas i separata oföränderliga gästkvitton med dokumentkoppling. De kräver inget påhittat Auth-ID. Tidigare kontobundna signeringar och arkiv behåller sin historik. Den tidigare kundkontoplanens migrationer ligger kvar i migrationshistoriken, men dess offentliga portal- och kontoinbjudningsfunktioner är återkallade. Den befintliga godkända ansökningsinbjudan för bilhandlare är återställd och separat från gästlänkarna.

## Utskick och drift

`CONTRACT_EMAIL_ENABLED=true` gäller offert-/avtalsmejl och avtalsmeddelanden. Verifierad leveranskonfiguration och privata servernycklar krävs också. Flaggan aktiverar inte kön för webbansökningsaviseringar. Ingen automatisk tömning av gamla köposter eller cron ingår.

Mottagaren hämtas från sparat underlag. Det fullständiga mejlet med dokumentlänken sparas separat krypterat före extern sändning. Samma kö-ID, mejlinnehåll och provider-idempotensnyckel bevaras vid tillåtna återförsök. Inga Auth-inbjudningar, kontoadoptioner, lösenordsändringar eller sessionsåterställningar görs för kunden. En utgången eller återkallad dokumentlänk ger ingen åtkomst; avsändaren behöver hantera fortsatt tillgång till dokumentet.
