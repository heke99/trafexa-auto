# Affärs- och dokumentetapp 14 november 2026

## Resultat

- Datum och klockslag på stängda affärskort, uttryckligen Europe/Stockholm. Inne i affären visas den ursprungliga skaparens namn. `deals.created_by` bevaras och skyddas mot omfördelning; framtida statistik kan gruppera på stabilt konto-id. Namn hämtas från kontots namn eller samma faktiska aktörs företagssignatur, aldrig kunden eller betraktaren. Okänd uppgift uppfinns inte.
- Handlarens direktavtalslänkar innehåller företagets id. Hämtning behåller färsk konto-/roll-/företagskontroll. Väntande direktavtal läses automatiskt var 15:e sekund på synlig sida samt vid återgång till sidan; ingen ny inbjudan skickas.
- Arkivering tar bort en affär från aktiva listan, med anledning, granskning, versionskontroll och revisionshistorik. Återställning ändrar synlighet, inte affärens status. Signerade original, PDF-historik och signeringsbevis finns kvar i läsläge. Aktiva reservationer, pågående signering och oavslutade betalningar hindrar arkivering.
- Pappersaffär kan registreras från lagerbilen eller en befintlig affär med köpare, överenskommet pris, datum och pappersreferens. Först granskas ett fryst underlag; därefter intygas faktisk pappersaffär och bil/affär registreras såld atomärt. Ingen digital signatur eller betalning fabriceras; affären märks Avslutad, inte Levererad utan leveransunderlag. Se [pappersflödet](../PAPER_SALES_20261114.md).
- PDF-bakgrundsmallar laddas upp och får manuellt placerade kund-/bil-/prisfält. Original och mallversioner är privata och oföränderliga. Servern hämtar och fryser riktiga affärsuppgifter; överlappning, textutrymme, saknade uppgifter och tecken kontrolleras. Ifylld PDF går vidare till befintlig säljargranskning, utskick och kundsignering med hashbunden evidens. Automatisk fältigenkänning ingår inte.

## Verifiering

Samlad regression omfattar 243 kanoniska testfiler och 2 209 godkända fall, utan överhoppade fall. Ursprunglig helkörning följdes av riktade omkörningar efter tre testmiljöers saknade komponent-/routergränser; omkörningar ersätter motsvarande per-filresultat och dubbelräknas inte. De sista två kort-/statusfallen ingår i de 2 209. Normalt lokalt produktionsbygge och typkontroll passerar, och Vercels exakta PR-bygge kontrolleras före merge. Separat PostgreSQL 17-prov med oberoende sessioner bekräftar verklig låsväntan och exakt en pappersaffär vid parallellt återförsök. Verklig kundsignering finns registrerad och båda färdigmejlen är levererade; inget nytt mejl har skickats av denna etapp. Agenten har ingen inloggad handlarwebbläsare och påstår inte att själv ha hämtat det verkliga kunddokumentet genom den sessionen.

## Utrullning och drift

Publicera kompatibel app före databasändringarna. Kör därefter pappersaffärer, affärsarkiv och PDF-mallar i den ordningen. Äldre RPC-svar utan arkiv-/säljarfält accepteras av den nya läsaren. När arkiverade poster finns krävs den nya läsaren; återställ inte endast appen till en äldre version utan kompatibilitetsåtgärd. Hosted migrationers faktiska versionsnummer synkas till filnamnen efter tillämpning. Inga befintliga affärs-/signaturrader fylls med påhittade data eller skrivs om av migrationerna.

PDF-mallen måste vara statisk, okrypterad, högst 4 MB och 100 sidor, utan formulär, aktiva funktioner, rotation eller beskärnings-/koordinatförskjutning. Manuell placering och förhandsgranskning krävs. Kundsigneringen använder den befintliga personliga mejllänken; BankID aktiveras inte av denna etapp.

## Publicering och efterkontroll

Publicerat via [PR #69](https://github.com/heke99/trafexa-auto/pull/69), main `6b1500642571134a4f0ce9907afec72f2a174ef4`, READY-produktion `dpl_5tVCPAydPCzVrvtyUmZHgZsojrdJ`. Inloggningssidan på app.trafexa.com returnerade samma deploymentsmarkör. Databasen uppgraderades efter att denna app var aktiv:

1. `20261114092944_manual_paper_sales.sql`
2. `20261114092957_deal_list_archives.sql`
3. `20261114093010_pdf_background_templates.sql`

Filernas SQL är oförändrad; filnamnen följer faktisk hosted migrationshistorik. Fyra befintliga affärer och både företags-/kundsignaturernas kontrollvärden är oförändrade före/efter. Två av fyra äldre affärer har verkligt aktörsbundet namn genom företagssignaturen; okända namn uppfinns inte. Inga pappersaffärer, arkivmarkeringar eller PDF-mallar skapades som produktionsprov. Nya relevanta RPC-funktioner ger ingen anonym exekveringsrätt.

Säkerhetsrådgivaren identifierar avsiktligt tio privata tabeller med RLS utan direkta klientpolicyer samt fyra uttryckligen autentiserade PDF-RPC:er med `SECURITY DEFINER`. Deras färska godkända konto-, aktivt företag- och owner/admin-kontroller verifieras i runtimeproven. Direkt tabellåtkomst är återkallad; privata original, lineage och fältdata exponeras inte genom generella klientpolicyer. Befintliga andra advisoryposter ändrades inte av etappen.
