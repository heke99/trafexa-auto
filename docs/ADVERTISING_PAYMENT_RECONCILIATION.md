# Manuell avstämning av annonsfakturor

Trafexas utfärdade annonsfakturor får ett separat register för manuellt kontrollerade inbetalningar och administrativa rättelser. Registreringen flyttar inga pengar och verifierar ingen bankhändelse automatiskt. Fakturan, kreditfakturan, deras frysta källor och PDF-filer ändras aldrig av avstämningen. Handlarens egna bilaffärsbetalningar har ett annat kontrakt.

## Granskning och åtkomst

Verklig aktiv, verifierad och godkänd UUID-superadmin registrerar poster. Klientroller, e-postadress och användarmetadata ger ingen behörighet. Företagets godkända aktiva ägare, administratör och ekonomiansvariga läser endast företagets egna fakturor och betalningshistorik. Försäljare, visningsroller, andra företag, anonyma och service-role-anrop har ingen skrivåtkomst. Superadmin får avstämma verkliga historiska inbetalningar även när gäldenärsföretaget är avstängt; handlarens läsåtkomst följer fortfarande aktuell företags- och medlemsstatus.

Varje registrering kräver exakt faktura och källhash, aktuell avstämningstoken, positivt belopp, kontrollerat transaktions-ID, bankmeddelande/OCR, bokföringsdatum, motivering och uttrycklig bekräftelse. Datum får föregå fakturans utfärdande för verkliga förskott, men får inte ligga efter serverns aktuella kalenderdag i Europe/Stockholm. Datumintervallet är 2000–2099. Historiska ursprungsbelopp eller moms räknas inte om.

Transaktions-ID är en stabil, granskad identifierare från underlaget, med 1–128 tecken ur `A–Z`, `a–z`, siffror och `._:/-`, inledande bokstav eller siffra. Det är skiftlägeskänsligt och reserveras för säljarens organisationsnummer. Bankmeddelande/OCR lagras separat och behöver inte vara unikt: flera delbetalningar kan ha samma OCR. Systemet kan hindra återanvändning av samma angivna identifierare, men kan inte upptäcka att samma verkliga bankpost manuellt tilldelats två olika identifierare.

## Belopp och status

Varje post använder positiva heltalsören upp till int64-max. API-belopp och interna räknare representeras som decimalsträngar. Summor räknas med PostgreSQL `numeric` och klientens BigInt, så att flera giltiga int64-poster inte orsakar överflöde eller avrundning.

Inbetalningar och återföringar bildar en separat, oföränderlig journal. Avstämt belopp är summan av inbetalningar minus deras fulla administrativa återföringar. Delbetalning stöds. Kvar att betala är högst återstående fordran, aldrig ett negativt belopp; överskott visas separat. Nollfaktura utan betalningar är avstämd. Ett överskott räknas inte automatiskt av mot en annan faktura.

En full kreditfaktura sänker originalets fordran till noll. Befintliga inbetalningar ligger kvar och visas som ett överskott att hantera, utan påstående om utförd återbetalning. Kreditstatus, avstämningsstatus, dokumentstatus och mejlleverans är separata. En senare verklig inbetalning kan även registreras mot ett redan krediterat original, där hela inbetalningen då blir överskott.

## Rättelser utan radering

Felaktig registrering rättas med en uttrycklig full återföring som refererar originalposten. Belopp, betalningsidentifierare, bankmeddelande och bokföringsdatum kopieras från den frysta originalposten; den nya motiveringen, registreringstidpunkten och aktören bevaras. Samma post kan återföras högst en gång. En återföring är en administrativ korrigering av registret och är inte en bankåterbetalning.

Transaktions-ID:t förblir reserverat efter en återföring. För en rättad nyregistrering måste superadmin först slå upp den senaste registreringen för identifieraren, granska dess exakta ursprungsföretag, faktura, belopp, datum och källhash samt bekräfta målfakturan. Bara en helt återförd, ännu inte ersatt kedjeände kan ersättas. Nyregistreringen måste behålla samma säljare och betalningsidentifierare samt uttryckligen ange föregående post och dess källhash. Den får avse en annan faktura eller ett annat kundföretag för samma säljare, så att felaktig fakturamatchning kan rättas spårbart. En senare rättelse fortsätter från den senaste helt återförda kedjeänden. Delad fördelning av en bankpost över flera fakturor ingår inte.

Uppslag över företag är endast för faktisk superadmin. Handlarens läslista avslöjar inga främmande företags- eller fakturadetaljer. UUID-hänvisningen till en tidigare korrigerad post är en opak historikreferens och ger ingen läsåtkomst till den posten.

## Samtidighet och återhämtning

Alla operationer använder befintlig låsordning för säljarens fakturering och därefter företagets underlag, tillsammans med aktuella Auth-, kontogodkännande- och behörighetskontroller. Kreditutfärdande, betalningsregistrering, dubblettkontroll och rättelser kan därför inte passera varandras granskning i samma säljarflöde. Avstämningstoken binder fakturans hash, eventuell kredits hash, senaste journalnummer, postantal, avstämda belopp och aktuell dag. Token påverkas inte av vilken historiksida som visas.

Begärans-ID binds till aktuell aktör, operation och exakt payload. Ett identiskt återförsök kontrollerar färsk behörighet och återlämnar samma registrerade post innan ändrad historik eller dag prövas. Ändrad payload med samma ID nekas. Vid osäkert nätverksutfall måste samma fullständiga begäran bevaras, inklusive granskningsuppgifter; ett nytt ID får inte skapas tyst. Ursprungspost och återföring kan inte ändras eller raderas via klientåtkomst.

Historiken hämtas med nyckelbaserad sidindelning, 50 poster per sida i fallande journalnummer. `nextBeforeSequence` anger nästa sida; all historik ingår alltid i totalsummorna. Journalnumren är interna ordningsnummer och kan ha luckor efter avbrutna transaktioner. De är inte fakturanummer eller bokföringsverifikationer.

## Avgränsningar och verifiering

Ingen bankanslutning, import av kontoutdrag, verklig återbetalning, automatisk överföring till annan faktura, ränta, påminnelse, inkasso eller bokföringsexport aktiveras. Ekonomisystem är fortfarande inte valt. Inga betalningar eller verkliga kundposter skapas av testerna. Lokal SQL, rollgränser, rättelsekedjor, exakta stora belopp och oberoende samtidighetsanslutningar ska verifieras före hosted migration och publicering. Faktiskt verifierat leveransläge rapporteras separat från detta kontrakt.
