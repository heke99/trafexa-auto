# Fortsättning: handlare och superadmin

Utgångspunkt: main `dcb67ef` (PR 41). Detta dokument beskriver implementerade kontrakt; separat leveransprotokoll anger verifierade testresultat, applicerade migrationer och produktionsversion. Användaren valde uttryckligen manuell betalningsavstämning först.

## Registrering och säkra återförsök

Kund och finansintresseanmälan skapas via `create_customer_request` respektive `create_finance_intake_request`. Företag, aktuell aktör, begärans-ID, typ och kanoniskt innehåll binds till ett oföränderligt kvitto. Samma begäran returnerar samma skapade post; ändrat innehåll med samma ID nekas. Aktuell Auth, kontogodkännande, företag och medlemsroll kontrolleras även när ett historiskt kvitto återläses. Direkt INSERT för `authenticated` på de två tabellerna återkallas; befintliga granskade interna serverfunktioner behåller sina särskilda kontroller.

Formulären bevarar ett osäkert försöks identitet i sessionslagring som hash, UUID och tidsstämpel. Råa kund-/finansuppgifter sparas inte där. Samma innehåll kan återförsökas efter stängning och omladdning i samma webbläsarsession. Olösta ID:n byts inte automatiskt vid nekad åtkomst, konflikt eller hög ålder. Verifierat kvitto krävs innan formuläret återställs. Nya begäranden stoppas om identiteten inte kan sparas säkert eller journalen är full; ett känt försök kan återläsas. Detta är inte semantisk dubblettrensning på namn eller e-post och återställer inte en raderad webbläsarsession.

## Superadmin och rollanpassad arbetsyta

Konton kan sökas på e-post med serverstödd sökning, statusfilter och sidindelning. Markören binds till aktuell administratör och sökkriterier. Byte via kontots företag och tillbaka bevarar kriterierna och läser färsk data. Inkomna ansökningar har mobilkort med åtkomliga åtgärder. Handlarens startsida föreslår uppgifter som matchar rollen; säljare uppmanas inte att registrera privata lagerinköp.

En inbjudan som förberetts av en annan administratör förblir skyddad av sitt befintliga aktörs-/leveranskontrakt. Denna etapp inför ingen osäker övertagningsknapp. Separata globala support-/ekonomi-/integrationsroller och generell överlämning av inbjudningar kräver egna policyer och tester.

## Gemensam dokumentöversikt

Driftens saknade offertarkiv införs med en separat bootstrap som endast skapar detta arkivs förutsättningar. Den äldre externa signeringsprototypen aktiveras inte. Tester av driftens exakta migrationskedja utelämnar båda äldre prototypfilerna och verifierar skyddad PDF-nedladdning samt dokumentåtkomst efter leverans.

Ägare, administratör och finansansvarig kan söka, filtrera och bläddra bland arkiverade offerter, faktiskt lagrade signerade avtalsoriginal och signeringsbevis samt utfärdade annonsfakturor och kreditfakturor. Källan anger dokumenttyp och använder befintlig skyddad nedladdningsroute. Pågående avtalsutkast visas inte som färdiga original. Markörer och svar binds till företag, användare, roll och kriterier. Inga lagringssökvägar eller interna belopp behövs i listans metadata.

## Manuell avstämning och leverans

Avstämning läses av ägare, administratör och finansansvarig. Endast ägare och administratör registrerar betalning, spårbar återföring eller leverans. Betalningsposter har belopp i exakta ören, bankreferens, bokföringsdatum, anledning och aktör. Poster ändras eller raderas inte; en återföring hänvisar till originalposten och visas med dess belopp, referens och datum före bekräftelse. Begärans-ID och versionskontroll hindrar dubbla registreringar och samtidiga motstridiga beslut.

Registreringen är **manuell avstämning**, inte verifiering mot bank, bokföringssystem eller finanspartner. Inga pengar flyttas. Kunden måste ha accepterat den exakta offerten och båda parter ha signerat avtalet; ett privat avtalsoriginal måste vara registrerat. Leverans kräver fullt avstämt belopp och affärens egen aktiva reservation. Accepterade offerters reservationer följer befintlig bevaranderegel: ett passerat ursprungligt utgångsdatum är inte ensamt ett frisläppningsbesked.

Leverans sparar ett oföränderligt kvitto och markerar lagerposten `sold` och affären `completed` atomärt. Direkt behörighetsomgång via vanliga statusuppdateringar tillåts inte. Levererade affärer finns i registret och superadmins totalsiffror, och avtalsoriginalet kan fortsatt hämtas.

**Avgränsning:** leveransflödet gäller raka affärer med positiv inbetalning. Inbyte, skuldlösen, utbetalning till kund/långivare och negativa nettobelopp spärras uttryckligen tills en separat avräkningsmodell stöds. Överbetalning eller betalningsåterföring efter leverans hanteras inte genom att låsa upp ett avslutat affärskvitto; det behöver ett särskilt korrigerings-/återbetalningsflöde.

## Första fungerande handlarnätverket

Ingen bil delas automatiskt. Ägare/admin publicerar uttryckligt valda publika bilfält och utpris. Godkända användare med aktivt företag och medlemskap kan söka och bläddra bland publicerade bilar. Inköpspris, kalkyl, kostnader, registreringsnummer, kunddata och privata bilder delas inte. Bilar som reserveras eller säljs försvinner från tillgängligt utbud; ändrad källa eller ändrat pris kräver ny publicering.

Ägare/admin/säljare kan, efter uttrycklig bekräftelse, skicka en fordonsbunden intresseförfrågan och besvara den i appen. Avsändaren godkänner att företag och verifierad kontomejl delas. Endast respektive parts behöriga personal läser samtalet. Förfrågan är inte en reservation, försäljning, kreditansökan eller betalning. Inga externa mejl skickas av detta flöde.

Första versionen visar högst 500 egna bilval, 100 samtal och de senaste 100 meddelandena per samtal; ytterligare lagrad historik markeras uttryckligen. Full historikbläddring och bindande B2B-reservationer är separata fortsättningar. Blocket, bank- och finansintegrationer kräver fortfarande verklig partneranslutning innan skarp extern leverans aktiveras.

## Verifiering

Automatiska prov använder syntetiska företag och poster, faktiskt migrerad SQL och verkliga komponenter. Separata samtidighetsprov körs i isolerad PostgreSQL med flera anslutningar. Webbläsarprov använder appens CSS och uttryckliga serveradaptrar. Hosted efterkontroller körs endast med kollisionsskyddade syntetiska transaktioner som avslutas med rollback och separat nollkontroll. Inga verkliga kundposter, betalningar, leveranser, nätverksförfrågningar, fakturor eller utskick skapas för testning.
