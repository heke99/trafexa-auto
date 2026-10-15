# Personal, roller och företagsinbjudningar

Personalpanelen finns i **Företag & inställningar** för företagets aktiva ägare och administratörer. Trafexas superadminbehörighet är separat och tilldelas aldrig genom företagsroller eller en inbjudan.

## Roller och åtkomst

Ägaren kan bjuda in administratörer, säljare, finansansvariga och läsare. Administratörer kan bjuda in och hantera säljare, finansansvariga och läsare. Administratörer får inte ändra andra administratörer eller ägare. Ingen kan ändra sin egen roll eller status i personalpanelen. Ägarrollen kan inte tilldelas, ändras eller stängas av genom den vanliga personalredigeringen. Ett separat [flöde för ägarrollen](COMPANY_OWNERSHIP_TRANSFER.md) byggs i samma företagsvy och kräver nuvarande ägares begäran samt mottagarens uttryckliga accept.

Roll- och statusändringar kräver en motivering, granskning och uttrycklig bekräftelse. Servern och databasen läser den aktuella behörigheten och jämför förväntad roll/status/version innan ändringen. Samma begärans UUID och innehåll kan återförsökas utan dubbel ändring. Ett historiskt kvitto ersätter inte en ny läsning av aktuell behörighet.

## Bjuda in en kollega

1. Ange kollegans e-postadress och önskad roll i personalpanelen.
2. Granska och spara inbjudan. Den gäller i sju dagar och kan återkallas.
3. Dela länken `https://app.trafexa.com/invitations` med kollegan genom er vanliga kontaktväg.
4. Kollegan registrerar sig eller loggar in med den inbjudna adressen, verifierar adressen och granskar sin inbjudan.
5. Kollegan accepterar uttryckligen. Därefter kan det nya företaget öppnas i arbetsytan.

Ingen mejlsändning sker när inbjudan sparas. Delningslänken innehåller ingen hemlighet eller åtkomsttoken. Inbjudningar visas endast efter verifierad autentisering för den faktiska Auth-adress de tillhör; andra adresser och företag kan inte sökas fram av mottagaren.

Acceptansen binder medlemskapet till Auth-kontots UUID. Företaget måste fortfarande vara aktivt och den som bjöd in måste fortfarande ha rätt att ge rollen. En utgången eller återkallad inbjudan ger ingen åtkomst. En redan avstängd medlem kan inte återfå åtkomst genom att acceptera en ny inbjudan; behörig personal måste granska medlemskapet. Sidvisning, inloggning och bekräftelselänk accepterar aldrig en inbjudan automatiskt.

## Databas och verifiering

Inbjudningar, begäransreferenser och revisionsspår ligger i privata tabeller med RLS och utan direkt klientåtkomst. Publika RPC-funktioner använder invoker-wrapper och smala privata definerfunktioner med låst sökväg och faktisk identitetskontroll. Företagets befintliga RLS gäller även efter en rolländring eller avstängning under pågående session.

Verifieringen använder verkliga TypeScript-moduler och React-komponenter samt migrationskedjan med PostgreSQL/PGlite-fixturer. Databastester täcker företagsgränser, skyddade roller, aktuella behörigheter, verifierad adress, utgång/återkallelse och återförsök. PGlite använder en enda backend; dessa tester bevisar inte samtidig låsväntan mellan separata databasanslutningar.

## Separat överlåtelse av ägarrollen

Panelen för ägarrollen öppnas uttryckligen under personalvyn och laddas först då. Endast aktuell ägare eller administratör får läsa. Ägaren väljer bland befintliga aktiva administratörer med verifierad adress och godkänt konto; urvalet läses i sidor om 50. Endast den valda mottagaren kan acceptera. Begäran gäller i 24 timmar och kan återkallas av aktuell ägare med motivering. Ingen e-post skickas automatiskt. Acceptansen gör mottagaren till ägare och tidigare ägare till administratör i samma transaktion. Detaljer och verifieringsgränser finns i [kontraktet](COMPANY_OWNERSHIP_TRANSFER.md).
