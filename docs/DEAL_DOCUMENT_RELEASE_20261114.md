# Affärs- och dokumentetapp 14 november 2026

## Resultat

- Datum och klockslag på stängda affärskort, uttryckligen Europe/Stockholm. Inne i affären visas den ursprungliga skaparens namn. `deals.created_by` bevaras och skyddas mot omfördelning; framtida statistik kan gruppera på stabilt konto-id. Namn hämtas från kontots namn eller samma faktiska aktörs företagssignatur, aldrig kunden eller betraktaren. Okänd uppgift uppfinns inte.
- Handlarens direktavtalslänkar innehåller företagets id. Hämtning behåller färsk konto-/roll-/företagskontroll. Väntande direktavtal läses automatiskt var 15:e sekund på synlig sida samt vid återgång till sidan; ingen ny inbjudan skickas.
- Arkivering tar bort en affär från aktiva listan, med anledning, granskning, versionskontroll och revisionshistorik. Återställning ändrar synlighet, inte affärens status. Signerade original, PDF-historik och signeringsbevis finns kvar i läsläge. Aktiva reservationer, pågående signering och oavslutade betalningar hindrar arkivering.
- Pappersaffär kan registreras från lagerbilen eller en befintlig affär med köpare, överenskommet pris, datum och pappersreferens. Först granskas ett fryst underlag; därefter intygas faktisk pappersaffär och bil/affär registreras såld atomärt. Ingen digital signatur eller betalning fabriceras. Se [pappersflödet](../PAPER_SALES_20261114.md).
- PDF-bakgrundsmallar laddas upp och får manuellt placerade kund-/bil-/prisfält. Original och mallversioner är privata och oföränderliga. Servern hämtar och fryser riktiga affärsuppgifter; överlappning, textutrymme, saknade uppgifter och tecken kontrolleras. Ifylld PDF går vidare till befintlig säljargranskning, utskick och kundsignering med hashbunden evidens. Automatisk fältigenkänning ingår inte.

## Verifiering

Riktad verifiering och full regression slutförs mot samma publicerade källversion; slutresultat och publiceringsidentitet anges i PR och kompletteras här efter utrullningen. Produktionsbygget har passerat lokalt. Verklig kundsignering finns registrerad och båda färdigmejlen är levererade; inget nytt mejl har skickats av denna etapp. Agenten har ingen inloggad handlarwebbläsare och påstår inte att själv ha hämtat det verkliga kunddokumentet genom den sessionen.

## Utrullning och drift

Publicera kompatibel app före databasändringarna. Kör därefter pappersaffärer, affärsarkiv och PDF-mallar i den ordningen. Äldre RPC-svar utan arkiv-/säljarfält accepteras av den nya läsaren. När arkiverade poster finns krävs den nya läsaren; återställ inte endast appen till en äldre version utan kompatibilitetsåtgärd. Hosted migrationers faktiska versionsnummer synkas till filnamnen efter tillämpning. Inga befintliga affärs-/signaturrader fylls med påhittade data eller skrivs om av migrationerna.

PDF-mallen måste vara statisk, okrypterad, högst 4 MB och 100 sidor, utan formulär, aktiva funktioner, rotation eller beskärnings-/koordinatförskjutning. Manuell placering och förhandsgranskning krävs. Kundsigneringen använder den befintliga personliga mejllänken; BankID aktiveras inte av denna etapp.
