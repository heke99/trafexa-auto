# Överlåtelse av företagets ägarroll

## Omfattning och aktuell status

Pågående organisationsetapp från main `bb8f756` / PR #31, 15 oktober 2026. Dokumentet beskriver den implementerade kodcheckpointen. Native PostgreSQL 15/15, korslager 7/7, serveråtgärder 10/10, Chromium för ägarrollen 12/12 och befintlig personal-UI 8/8 passerar. Produktionsbygge inklusive TypeScript avslutas med exitkod 0. Ägarrollens fulla helsvit före integrationen passerar 970/970 utan fel eller överhoppade fall. Därefter sammanfogas kreditleveransen från PR #32/main `6bd1f9c`; integrerad slutkontroll pågår på den sammanslagna koden och dess 114 lokala migrationsfiler. Hosted migration `20261015173753_company_ownership_transfer` är applicerad, rollbackprovet passerar utan SQL-fel och nio separata efterkontroller är noll. Publiceringen återstår att verifiera. Aktuella bevis samlas i [IMPLEMENTATION_STATUS](IMPLEMENTATION_STATUS.md).

Överlåtelsen gäller rollen `owner` för ett företag i Trafexa. Den utför ingen juridisk överlåtelse av bolaget, ändrar inget organisationsnummer eller myndighetsregister och bekräftar inte firmateckningsrätt. Företagets `created_by` är historisk skapare och ändras inte. Filialer, supportövertagande, återställning av saknad ägare och rättelse av flera aktiva ägare ingår inte.

## Granska, begära och acceptera

1. Aktuell ägare öppnar panelen för ägarrollen under företagets personalvy. Panelen laddas först när den öppnas. Ägare och administratörer får läsa företagets aktuella underlag.
2. Ägaren väljer en befintlig aktiv administratör med verifierad Auth-adress och godkänt konto. Urvalet sidindelas med 50 kandidater åt gången. Nya externa mottagare måste först gå genom det vanliga personalflödet.
3. Ägaren anger motivering, granskar parterna och bekräftar överlåtelsen uttryckligen. Begäran binds till de aktuella medlemskapen och personalversionen och gäller i 24 timmar.
4. Den valda administratören öppnar samma panel med sitt eget konto, granskar begäran och accepterar uttryckligen före utgångstiden. Sidvisning och inloggning accepterar aldrig automatiskt.
5. Databasen kontrollerar aktuellt konto, företag, parter och versioner och gör mottagaren till ägare samt tidigare ägare till administratör i samma transaktion. Vid konflikt sker ingen delvis rollväxling.

Aktuell ägare kan återkalla en väntande begäran med motivering och uttrycklig bekräftelse. Utgångna, återkallade eller redan avslutade begäranden ger ingen ny acceptans. Ingen e-post, hemlig delningslänk eller extern leverans skapas av flödet. Parterna samordnar granskningen genom sin vanliga kontaktväg.

## Behörighet, versioner och återförsök

Vanlig personalredigering kan fortsatt inte skapa eller ändra ägarroller. Säljare, ekonomiansvariga och läsare får inte läsa eller ändra överlåtelsen; plattformsadministration är en separat behörighet och är ingen genväg till detta flöde. Endast nuvarande ägare begär eller återkallar, och endast exakt vald mottagare accepterar.

Begäran och acceptans kräver exakt en aktiv ägare i företaget. Företag med saknad ägare eller flera aktiva ägare spärras för separat granskad återhämtning. Ingen global unik ägarregel införs och äldre medlemskap skrivs inte om automatiskt. Avstängda medlemskap ger ingen behörighet.

Konto- och företagsstatus, medlemskap, roll, verifierad adress, kontogodkännande och förväntade versioner kontrolleras på servern och i databasen. En gammal arbetsvy eller begäran ersätter inte den aktuella behörigheten. Motivering och intygsversion ingår i det granskade underlaget. Byte av företag ska rensa öppnad vy och formulärtillstånd.

Mutationsbegäranden använder aktörsbunden idempotens: samma aktör, begärans-ID och exakta innehåll återger samma kvitto, medan återanvändning med annat innehåll avvisas. Ny aktuell autentisering och åtkomst krävs även vid historiskt återförsök. Ett kvitto från den genomförda överlåtelsen är historik och ger ingen fortsatt rätt att styra företaget.

## Dataskydd och verifieringsgränser

Begäranden, kvitton och revisionsspår sparas privat. UI-behörigheter måste motsvaras av server- och databasregler, inklusive återkallad åtkomst under pågående session. Separata anslutningar behövs för att verifiera samtidiga acceptanser, återkallelse och medlemsändringar.

Den här etappen ändrar inga annonser, priser, fakturor, betalningar, avtal, externa partneranslutningar eller mejlköer. Faktisk autentiserad produktionsrundresa och återhämtningsrutiner redovisas separat från lokala testresultat.
