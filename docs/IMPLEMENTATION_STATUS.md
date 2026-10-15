# Implementationsstatus

## Faktureringsuppgifter och fakturautkast, 15 oktober 2026 — verifierat inför publicering

Versionshanterade kund- och säljaruppgifter samt privata fakturautkast från exakt låst och rättat annonsunderlag är byggda. Superadmin hanterar säljarprofil och utkast; företagets ägare och administratör kan komplettera egna faktureringsadresser och kontaktuppgifter, medan ekonomiansvarig läser. Kundens juridiska identitet kommer från företagsposten. Ofullständiga uppgifter får sparas och markeras som saknade; ingen mejladress ersätter en postadress.

Varje granskat utkast bevarar original, nedsättningar, netto exklusive moms och båda parters uppgiftsversioner med kanonisk JSON och SHA-256. Senare profil-/underlagsändringar markerar äldre utkast som inaktuella utan att ändra dem. Privat PDF återger den valda versionen, med UTKAST / EJ UTFÄRDAD på varje sida och identiska bytes vid upprepad rendering. Aktuell behörighet och samma sparade version kontrolleras igen innan PDF-bytes lämnas ut.

Bokföringssystem är ännu inte valt enligt ägarens svar. Momsstatus förblir olöst; inga fakturanummer, förfallodatum, betalningskrav, momsbelopp, fakturor eller externa utskick skapas. Slutverifiering: **708/708 appfall**, **43/43 berörda PostgreSQL-grupper**, TypeScript och produktionsbygge passerar. De 17 riktade backendkontrollerna och elva PDF-/exportfallen överlappar dessa körningar och adderas inte till totalsiffrorna. Oberoende PostgreSQL → parser → faktisk PDF-kontroll passerade exakta int64-belopp, ofullständiga adresser, olöst moms, roller, återförsök, likvärdig källa och oförändrade äldre PDF-bytes efter profiländring. Sju nya hosted migrationer är applicerade med synkroniserade filversioner; 79 hosted migrationer observerades totalt. Hosted rollbackprovet passerade faktiska kunduppgifter, delvis ifylld privat profil, återförsök, roller och nekad utkastskapning utan låst original; samtliga åtta efterkontroller var noll. Positiv utkastskapning från låst avslutad månad verifierades lokalt. Inga nya advisor-varningskategorier tillkom. PDF-typsnittets paketering är verifierad i byggmanifestet. Merge och READY-produktion återstår vid denna commit. Se [ADVERTISING_INVOICE_DRAFT_CONTRACT](ADVERTISING_INVOICE_DRAFT_CONTRACT.md).

Efter merge av registeretappens main `29f3ce2` bevaras nedan de separata verifieringsresultaten för rättelser och register. De överlappar och adderas inte. Samlad app- och byggverifiering av den integrerade koden redovisas separat när den är klar.

## Rättelser av låsta annonsunderlag, 15 oktober 2026 — publicerat via PR #23

Separata oföränderliga nedsättningar kopplas till publiceringsrader i det låsta originalet. Aktuell UUID-superadmin granskar belopp och motivering innan lagring; företagets ägare, administratör och ekonomiansvarig läser original, nedsättningar, återstående belopp och historik. En nedsättning måste vara positiv och sammanlagt rymmas i originalradens pris. Full nedsättning bevarar raden och dess antal med återstående belopp noll. Originalet och dess CSV ändras inte.

Ett företagslås, aktuell granskningskontrollsumma och aktörsbundna begärans-ID skyddar mot samtidiga ändringar och dubbla återförsök. Kvittot verifieras mot företag, administratör, begäran, original och faktisk rättelse. Privat rättelse-CSV har egna radbelopp, granskningsreferenser och kontrollsummor samt skydd för fritext i kalkylblad. Ny rättelse eller återkallad behörighet under export stoppar privata bytes. Högst 2 000 rättelser per period; exakta ören och int64-beloppsgränser. Ingen faktura, kreditfaktura, betalning eller extern publicering skapas.

Historisk slutverifiering av rättelsefortsättningen före registerintegreringen: **606/606 appfall**, **32/32 berörda PostgreSQL-grupper**, TypeScript och produktionsbygge passerar. De 14 riktade action-/DB-kontrollerna och nio CSV-/exportfallen överlappar dessa körningar och adderas inte till totalsiffrorna. Oberoende PostgreSQL-granskning passerade bland annat int64-gränsen, kvarvarande radbelopp, återförsök efter senare rättelser, oförändrat original och återkallad åtkomst. Fyra nya hosted migrationer har tillämpats och lokala filversioner synkroniserats; hosted rollbackprovet passerade med noll kvarvarande uppgifter i samtliga sju kontrollaggregat. Positiv rättelse av låst avslutad månad är verifierad lokalt, medan hosted provet verifierade läsbehörighet och nekad rättelse utan original. Security advisors har inga nya varningskategorier; privata RLS-tabeller saknar avsiktligt direktpolicyer. Publicerat via PR #23 på main `4fd3c5d529b7ffa8ce16ebdaaabf41a22bf59132` efter registerintegrering. Samlad fullsvit gav 680/680 appfall och 32/32 berörda DB-grupper, TypeScript och produktionsbygge passerade. Deployment `dpl_4yZRrxD3FfaVyGZGg69YeSWbsvs2` verifierades READY i rätt projekt/arn1 med app/www/apex, login-/demo-HTTP200 och kontrollerad privat exportnekning med no-store. Inga runtimefel observerades i det omedelbara releasefönstret. Se [ADVERTISING_CORRECTIONS_CONTRACT](ADVERTISING_CORRECTIONS_CONTRACT.md).

## Fullständiga huvudregister och reservationsjobb, 15 oktober 2026

Fortsättning från main `eb3fa15` på `codex/trafexa-registers-20261015`. Lager, Kunder och Affärer använder nu egna serverläsningar av hela företaget: bokstavlig sökning, status-/kundtypsfilter, stabil sortering, 50 rader per sida samt faktiska total-, träff- och kategorisiffror. Affärsrader hämtar sina kund- och bilrelationer direkt från databasen. Kund-/bilväljare för ny affär söker och bläddrar även utanför grundsnapshotens 500 rader och återverifierar ett valt objekt oberoende av aktuell sökning. Fordonskostnader hämtas endast för öppnat fordon, genom alla dess kostnadssidor och med färska åtkomstkontroller före och efter. Fel eller återkallad åtkomst ger inte ett framgångsrikt tomt resultat eller delvis kostnadsunderlag. Se [registerkontraktet](DEALER_REGISTERS.md).

Dashboardens totalsiffror var redan serveraggregerade och är ingen ny korrigering i denna etapp. Grundsnapshoten kan fortfarande innehålla de 500 senaste lager-, kund- och affärsposterna för andra konsumenter. Finanslistan och finansformulärets snapshoturval ligger utanför denna leverans.

Användaren har den 15 oktober uttryckligen godkänt ett permanent reservationsminutjobb. Migration `20261015091915_reservation_expiry_scheduler` är applicerad. Hosted-readback bekräftar `pg_cron` 1.6.4 samt `trafexa-expire-reservations`, `active = true`, schema `* * * * *`, användare/databas `postgres` och kommandot `set statement_timeout='30s'; select private.expire_reservations();`. Anonym och autentiserad användare saknar EXECUTE på workerfunktionen; `authenticated` saknar USAGE på `cron`-schemat. Nio automatiska körningar är återlästa som `succeeded`; den första startade 15 oktober 09:20 UTC, 11:20 i Europe/Stockholm.

Även `20261015092417_dealer_registers` är applicerad. Registerfunktionens publika SECURITY INVOKER-wrapper anropar en privat SECURITY DEFINER-funktion med uttryckliga kontoapproval-, aktörs-, företags- och rollkontroller och företagsbundna frågor/relationer. Båda är STABLE med låst `search_path`. EXECUTE är tillåtet för `authenticated`, nekat för `anon` och `service_role`. Återläsning och fullständigt regenererat hosted-schema är införda; ett dokumenterat centralt typlager bevarar befintliga verifierade nullable-, bigint- och argumentlösa RPC-kontrakt utan att ändra returtyper eller runtimebehörigheter. Hosted historik hade **60 versioner vid etappstart och 68 vid efterkontroll**: två från denna etapp och sex billingmigrationer från parallella PR #21. PR #21-checkpoint `6234a91357e73f0b698a7a0dbd95b21de3006e35` är integrerad i denna branch.

Registeretappens historiska slutverifiering efter integreringen av PR #21 och före rättelsefortsättningen: **655/655 appfall PASS** med `node --test --test-concurrency=1 tests/*.test.mjs`, inklusive **55/55 nya Chromiumfall** för register, affärsväljare och faktisk arbetsyteintegration. Browserfixturerna har noll HTTP POST och noll okontrollerade browserfel; de använder in-memory-actions och ersätter inte autentiserad produktions-CRUD. **2/2 riktade register-PGlite-grupper** samt nedanstående 10 PostgreSQL-sessionstester är separata databasprov. `npm run build`, `npm run typecheck` och diffkontroll PASS. En tidigare körning med `--test-isolation=none` delade äldre testfilers miljöhakar och gav sju domänassertioner; filisolering löste testkörningens kontaminering utan produktändring. Inga tidigare checkpoints adderas till dessa totalsiffror. PR/main- och produktionsreadback sparas separat efter publicering, så denna commit gör inget framtida driftpåstående.

Utgångskoden använder låsordningen företag → lagerpost → affär → reservation, hoppar över låsta kandidater och skyddar offerter som redan är accepterade när utgången får affärslåset. Om utgången får låset först behålls tidigare affärssemantik: senare offertaccept återreserverar inte bilen. Företagets KEY SHARE-lås är inte ensamt ett skydd mot varje statusåterkallelse. **10/10 riktiga PostgreSQL 17.6-sessionstester** passerar enligt samordnarens verifierade körning. Båda hosted rollbackprotokollen `supabase/tests/dealer_registers.sql` och `supabase/tests/reservation_expiry_scheduler.sql` passerar; efterkontroll bekräftar noll kvarvarande testföretag och testanvändare. Driftkontrakt och låsgränser finns i [RESERVATION_EXPIRY](RESERVATION_EXPIRY.md); autentiserad produktionsbrowser-CRUD är inte verifierad genom dessa databasprov.

Security advisor före DDL: 38 INFO för privata deny-all RLS-tabeller samt två befintliga WARN: avstängt skydd mot läckta lösenord och `public.get_transactional_email_status` med SECURITY DEFINER-execute för `authenticated`. Efterkontroll visar samma två WARN och 42 INFO; ytterligare privata deny-all-tabeller har tillkommit från billing. Inga nya WARN. Nedanstående äldre checkpoints och testsummor gäller fortsatt sina angivna versioner.

## Kanalpriser och låsta månadsunderlag, 15 oktober 2026 — publicerat via PR #21

Fortsättning efter PR #20:s publiceringsregister och antalunderlag. Företag och kanal har versionshanterade priser i exakta heltalsören, SEK exklusive moms. Aktiveringstid sätts av servern; nya priser gäller framtida verifierade publiceringar och ändrar inte tidigare rader. Uttryckligt noll bevaras som ett beslutat pris; frånvaro av pris är null och blockerar låsning. Tidigare oprissatta publiceringar kan prissättas för vald kanal och månad efter motivering, uttrycklig granskning och kontroll av exakt aktuell underlagsversion. Redan prissatta rader skrivs inte om.

Aktuell faktisk UUID-superadmin kan granska priser och låsa månadsunderlag via Företag → Annonsunderlag. Företagets ägare, administratör och ekonomiansvarig läser samma prisdomän utan skrivreglage. Serveråtgärder och SQL kontrollerar aktuell identitet, kontogodkännande och företagsbehörighet; metadata ger ingen administratörsrätt. Prisändring, publicering, efterhandsgranskning och låsning samordnas med företagslås. Aktörsbundna återförsök, versionskontroll och oföränderlig granskning motverkar dubbla underlag.

Avslutad kalendermånad enligt Europe/Stockholm kan låsas först när alla publiceringar har pris och den aktuella versionen granskats. Registreringsstart under månaden kräver ytterligare bekräftelse av ofullständig historik. Pågående månader och månader helt före registreringsstart blockeras. Låsningen bevarar rader, antal, exakt summa, täckning, registreringsstart och periodgränser. Kanonisk originaltext verifieras med SHA-256 och mot det sparade innehållet; UI och privat radvis CSV återger det låsta originalet. Förändringar i aktuell källa markeras separat och ändrar inte originalet. Den äldre antalexporten förblir ett antalunderlag utan prisberäkning; versionerade quantity-RPC:er undviker ändrad betydelse för äldre klienter.

Gränser: högst **2 000 publiceringar** per månadsunderlag och **9 223 372 036 854 775 807 öre** för styckpris eller totalsumma. Större underlag eller överflöden avvisas utan trunkering eller avrundning. Belopp beräknas med PostgreSQL numeric/bigint och JavaScript BigInt. Inga momsbelopp, fakturanummer, utfärdade fakturor, betalningar, externa annonser eller mejlutskick skapas här. Blocket/Wayke och bankadapters förblir inaktiva. Se [ADVERTISING_BILLING_CONTRACT](ADVERTISING_BILLING_CONTRACT.md).

PR #21:s verifiering före registerintegreringen: **581/581 appfall** i full körning och **35/35 PostgreSQL/PGlite-grupper** passerar; produktionsbygget passerar. **26/26 berörda slutkontroller** passerar också men överlappar fullsviten och adderas inte till totalen. Browserfallen omfattar exakta decimaler/noll, skrivspärr för läsroller, granskad historisk prissättning, täckningsbekräftelser, låst original/CSV och rensning vid återkallad åtkomst eller sena svar från tidigare företag. Positiv stängning av avslutad månad är verifierad **lokalt**; hosted positiv stängning av sådan månad är inte bevisad. Hosted kontroll i nuvarande månad kan verifiera nekad låsning men ersätter inte det positiva provet.

**Publicerat:** PR #21 mergades till main `6234a91357e73f0b698a7a0dbd95b21de3006e35`. Produktionsdeployment `dpl_2StJtp8oxDDELqocc3VhMV9f4sMZ` verifierades READY för exakt denna commit, rätt projekt, region arn1 och app/www/apex. Sex migrationer tillämpades; syntetiskt hosted rollbackprov passerade och samtliga tio efterkontroller var noll. Login-/demoröktester gav HTTP 200. Tidigare daterade sektioner nedan är historiska checkpoints och deras testantal adderas inte till denna verifiering.

## Avtalsmallar och selektiv DocuSeal-port, 14 oktober 2026

Fortsättning från publicerad main `ecb0e2557979e5b481f1d18cc7668548a700881c`, PR #16. Företagsinställningarna har versionshanterade avtalsmallar med separat granskning, motivering och godkännande av owner/admin. En tidigare godkänd revision kan användas medan en ny redigeras; godkännande ersätter den tidigare revisionen atomärt och bevarar historiken. Finance får endast läsa godkända mallar, även vid direkt public/private RPC eller riktad familjeläsning. Sales/viewer och ej godkända konton nekas.

Affärens privata avtalsutkast hämtas först vid öppning och skapas av owner/admin/finance från exakt accepterad offert och aktuell godkänd mallversion. Malltext, originalvillkor, kund/bil/pris, moms och eventuellt inbyte sparas som en oföränderlig version. Aktörsbundet exakt återförsök, mall-/godkännande-CAS, låst offert och unik offert/mallkombination förhindrar oavsiktliga dubbletter. Avbrutna affärer nekas nya utkast; historiska kvitton och PDF-versioner kan läsas med aktuell behörighet. Mallfamiljer och avtalshistorik är sidindelade; en nysparad mall hämtas från exakt familj även om den inte hamnar på första sidan.

Privat PDF återger endast den sparade versionen, med exakta heltalsören och originalvillkor även om mallen inte innehåller motsvarande platshållare. Tolv namngivna textfält ersätts i en enda genomgång; HTML eller kod körs inte. Dokumentet är uttryckligen OSIGNERAT AVTALSUTKAST. Route verifierar aktör, kontoapproval, företag och roll före och efter rendering och svarar private/no-store. Ingen affärs-/betalnings-/leveransstatus ändras.

DocuSeal-källan är den av ägaren angivna `docusealco/docuseal`, låst till commit `3c65b0e4ba872fe71d5566c0d09c3ace59a7fb8a`. Endast namnteckningsfältets grafiska validering och canvaskontroll portas i denna leverans; valideringen har bounds och skydd för NaN/degenererade punkter. Den används i en lokal förhandsgranskning som inte sparar, identifierar eller signerar. Ägarens godkännande för användning och portning är dokumenterat i [DOCUSEAL_SELECTIVE_PORT](DOCUSEAL_SELECTIVE_PORT.md). Ingen full Rails-/Vue-applikation, konto- eller företagsmodell importeras.

Verifiering: **514 unika apptestfall** verifierade: full körning 513/513 PASS och därefter 24/24 berörda action/UI/download-fall efter finance-härdningen, inklusive ett nytt testfall. Antalen adderas inte som separata unika sviter. Produktbygge, TypeScript och diffkontroll PASS. Nya grupper: tio avtalsactions, åtta Chromiumgrupper, sju verkliga PDF-render/textgrupper, sex nedladdningsgrupper, fem portgrupper och en faktisk DealerWorkspace-integration. **30/30 PostgreSQL/PGlite-grupper** för avtal (10), kontogodkännande (6), offertgranskning (8) och offert/inbyte (6) PASS. Databastesterna gör verklig offertpublicering/kundaccept och prövar bland annat 53 mallfamiljer/53 avtalsversioner, aktuella/återkallade roller, finance approved-only samt direkta public/private ingångar.

Sex nya hosted migrationer är bekräftade: `20261014174918_contract_storage`, `20261014174931_contract_helpers`, `20261014174946_contract_template_mutations`, `20261014175000_contract_draft_mutation`, `20261014175014_contract_reads`, `20261014175028_contract_api`. Hosted historik har 49 versioner. Live rollback bevisar mallgodkännande, exakt accepterad offert, oföränderligt privat utkast och exakt återförsök; efterkontroll visar noll syntetiska Auth-konton/företag/mallar/utkast/kvitton/offerter/approvals. Inga nya säkerhetsvarningar; privata deny-all-tabeller ger INFO och tidigare avstängt skydd mot läckta lösenord är oförändrat.

Aktiv underskrift, signerade PDF:er och signeringsbevis är nästa steg. De äldre opublicerade signing/archive-migrationerna förblir unapplied och provider/worker är avstängda. Ingen verklig signeringsbegäran, mejl eller extern integration aktiveras. Full autentiserad produktionsbrowser, faktisk mejlleverans och verklig fleranslutningslåsväntan återstår separata verifieringar. Se [CONTRACT_TEMPLATE_CONTRACT](CONTRACT_TEMPLATE_CONTRACT.md).

## Privat inköps- och skickunderlag, 14 oktober 2026

Fortsättning från publicerad main `867b73bacfebdb09b186295a9125920249a7224a`, PR #15. Bilkortet hämtar privata versionsbundna inköps- och skickunderlag först vid öppning. Verifierade ägare, administratörer och ekonomiansvariga kan granska, spara och hämta exakt PDF-version; säljare/läsroller och väntande eller avstängda konton nekas även via direkt RPC.

Serverläst inköpspris, momsunderlag och fordonsidentitet sparas med leverantör, frivillig inköpsreferens, separata inköps-/kontrolldatum och sex manuella skickområden. Anmärkningar kräver beskrivning och ej bedömt presenteras uttryckligen. Okänd reparationsuppskattning är null; uttryckligt noll är 0. PostgreSQL-bigint och indikativ inköpspris-plus-uppskattning använder BigInt. Inga lager-, pris-, moms-, kostnads- eller betalningsuppgifter ändras av underlaget.

Aktörsbundet exakt återförsök, versions-/pris-/kalkyl-/fordons-CAS och oföränderlig historik skyddar sparningen. UI kräver granskning och rensar privat information vid nekad åtkomst eller byte av användare/företag/roll/bil. PDF-route verifierar den privata versionen och aktuellt konto/medlemskap före och efter rendering; svar använder private/no-store och inga delningslänkar. Se [PURCHASE_CONDITION_CONTRACT](PURCHASE_CONDITION_CONTRACT.md).

Färsk verifiering: **477/477 apptester**, produktionsbygge, TypeScript och diffkontroll PASS. Nya grupper inom apptotalen: åtta actiongrupper, sex Chromiumgrupper, åtta verkliga PDF-render/text/parsergrupper, sju nedladdningsgrupper och en faktisk DealerWorkspace-integration. **31/31 PostgreSQL/PGlite-grupper** för nytt underlag (6), kontogodkännande (6), kalkyl (7) och webbansökan (12) PASS. Tidigare 447/59 är en separat checkpoint och adderas inte som nya tester. Färsk bascheck av ansökan/Auth/godkännande passerar 31 grupper inom apptotalen.

Hosted historik är verifierad med 43 versioner: `20261014170812_purchase_condition_storage`, `20261014170827_purchase_condition_reads`, `20261014170842_purchase_condition_mutation` och `20261014170856_purchase_condition_api` är applicerade. Live rollback bevisar privat versionskopiering, exakt återförsök, okänd uppskattning och oförändrat lager. Efterkontroll visar noll syntetiska Auth-konton, företag, underlagsversioner, kvitton eller approvals. Säkerhetsadvisorn har inga nya varningar; privata deny-all-tabeller ger INFO och tidigare avstängt skydd mot läckta lösenord är oförändrat.

Kontomejlmallar är versionshanterade och ägaren har uppgett att Supabase-mejlen är konfigurerade. Faktisk mejlleverans och full autentiserad produktionsbrowser är fortfarande separata verifieringssteg; inga mejl eller SMTP-/DNS-ändringar sker här. PDF skapas i Trafexa; DocuSeal-grunden och de två äldre signing/archive-migrationerna förblir inaktiva. Underlaget är varken ett inköpsavtal eller signerat dokument. Verklig fleranslutningslåsväntan återstår separat.

## Granskat inbyte i offert, kundvy och PDF, 14 oktober 2026

Fortsättning från main `d21baadf3f6c2c22ddc1cd15a38005fe86ff5c00` (PR #14). Handlaren kan välja den senaste privata inbytesversionen med känd skuld till en **ny** offertversion och granskar exakt kundsynligt innehåll före skrivning. Noll skuld är känd skuld; okänd skuld kan inte bifogas. Affärspris, senaste offertversion och inbytesversion kontrolleras mot servern. Befintliga offerter och deras oföränderliga bytes behålls.

Kundvy och PDF läser samma sparade registrering/biluppgifter, värdering, skuld, netto och belopp att betala. Interna skick-/utrustningsanteckningar, kreditgivare och Auth-identiteter ingår inte i bilagan. Netto och mellanskillnad använder exakta heltalsören, även negativa belopp. Försäljningsbilens bruttopris är fortsatt momsunderlag; inbytesnettot minskar betalningsbeloppet utan att ändra momsberäkningen. Accepterad offert spärrar alla nya offertversioner via både gamla och nya API-vägar; behörigt exakt återförsök av tidigare sparad version bevaras.

Färsk godkänd Auth och faktisk företagsroll krävs. Nekad åtkomst rensar offert-/inbytesdata och sena resultat efter byte eller avmontering ignoreras. Underlaget utför inget inbytesköp, lagerintag, skuldlösen, betalning eller signerat avtal. Full autentiserad produktionsbrowser och verklig samtidig låsväntan verifieras separat. Hosted Auth-mejlkonfiguration och gamla signing/archive-migrationer aktiveras inte av denna leverans.

Verifiering: **447/447 apptester**, produktionsbygge/TypeScript och diffkontroll PASS. **55/55 berörda PostgreSQL/PGlite-grupper** för nya offertkopplingen (6), kontogodkännande (6), inbyte (6), offertgranskning (8), CRM (7), arkiv (1), kalkyler (7), avbrytning (7) och plattformsöversikt (7). Dessutom **4/4 oberoende fullkedjegrupper** för både gamla/nya publika/privata vägar, kundaccept, historiskt exakt återförsök och nekad behörighet. Totalt 59 verifierade databastestgrupper i denna leverans; tidigare 75 är en separat checkpoint och summeras inte till nya unika fall. PDF-sviten innehåller 11 verkliga render-/textgrupper utan skip, inom apptotalen.

Hosted readback: `20261014160150_trade_in_offer_snapshot`, `20261014160206_trade_in_offer_creation` och `20261014160219_trade_in_offer_api`, totalt **39 migrationer**. Live rollback PASS för oföränderlig kundsäker bilaga, exakt retry och negativ mellanskillnad. Efterkontroll noll syntetiska Authkonton, företag, offerter, submissions, inbytesversioner och approvals. Ingen ny säkerhetsvarning; samma 25 avsiktliga privata RLS-notiser och tidigare lösenordsskyddsvarning. Se [TRADE_IN_OFFER_CONTRACT](TRADE_IN_OFFER_CONTRACT.md).

## Obligatoriskt kontogodkännande, superadmininloggning och inbytesunderlag, 14 oktober 2026

Fortsättning från main `f44bd5e5495eabf9dd876060738d7528b0de444f`: aktiv verifierad plattformsadministratör i det privata UUID-registret går till `/admin` efter vanlig inloggning, callback och översikt, utan att skapa företagskonto. **Alla andra nya och befintliga konton utan privat godkännande väntar på superadminens beslut.** Inga verkliga konton godkänns automatiskt. Registrering, e-postverifiering, företagsroll och user_metadata räcker inte för systemåtkomst.

Superadminens Konton har filtrerad/paginerad lista och granskade godkännande-, avslags- och avstängningsbeslut med motivering, versionskontroll och aktörbundet exakt återförsök. Aktiv privat superadmin och den egna administratören skyddas från rutinbesluten. Profilnamn är en frivillig obetrodd uppgift: felaktigt/stort namn blir null och stoppar inte listan. Pending/rejected/suspended spärras från arbetsyta, företagsregistrering, kundofferter och inbjudningar samt direkta RPC/RLS/Storage-anrop. Konto, återställning, egen åtkomststatus och utloggning fungerar fortsatt. Ett säkert kund-/inbjudningsmål bevaras genom vänteläget och används efter godkännande utan krav på företagskonto. `/admin` visar också vänteläge för icke godkända konton. [Kontokontraktet](ACCOUNT_APPROVAL_CONTRACT.md) beskriver gränsen.

Databasspärren omfattar centrala företagsroller och faktisk Auth-identitet, kalkylens egna auktoriseringsfunktioner och äldre lager-/import-/affärs-/CRM-/offertfunktioner. Auth, godkännanderad och privat administratörsrad låses innan känsliga affärslås. Interna `_approved_impl` kan inte anropas av authenticated. Granskningen rättade särskilda kalkyl- och aktiveringsvägar samt äldre väntande skrivningar. Testdatabasernas uttryckligt godkända syntetiska regressionskonton är TESTONLY; de negativa godkännandetesterna stänger av denna förberedelse.

Affärens inbytespanel hämtas först vid öppning och är nycklad på företag/användare/roll/affär/status. Granskade versioner innehåller biluppgifter, skick/utrustning, värdering, känd/okänd skuld och kreditgivare. Netto och belopp att betala räknas i exakta heltalsören med stöd för negativa värden; okänd skuld ger inga beräknade totalsummor. Serverns affärspris, senaste version, faktisk behörighet och accepterad offert kontrolleras. Oföränderlig historik och exakt retry bevaras; färsk lista hämtas efter kvitto. Underlaget ändrar inte lager, offert, kundaccept, moms eller betalningar. Faktiskt inbytesköp och koppling till offert/avtal är nästa steg. Se [TRADE_IN_CONTRACT](TRADE_IN_CONTRACT.md).

Verifiering: **428/428 apptester**, produktionsbygge, TypeScript och diffkontroll PASS. **75/75 riktiga PostgreSQL/PGlite-grupper**: sex kontogodkännande, sex inbyte och 63 regressionsgrupper för CRM, offertgranskning, kalkyl, annonser, personal, plattformsadmin, webbansökningar och arkiv. Dessutom oberoende 36 negativa RPC/RLS/Storage-kontroller mot actual hosted-basis utan automatisk fixtureapproval. Konto-/inbytes-browserfall granskar nonce, CAS, behörighetsförlust, säker destination och mobil layout; faktisk DealerWorkspace kontrollerar roller, demo och lat hämtning samt bevarar offertpanelens scope-switch-regression. Full inloggad produktionsbrowser och verklig multi-connection-låsväntan återstår separata verifieringsgränser. Inga mejl, SMTP/DNS-förändringar, externa providers eller jobb aktiveras; hosted Auth-mallar och URL-konfiguration är fortsatt separat installation enligt AUTH_EMAIL_SETUP.


Hosted readback: de tio lokalt testade migrationerna är applicerade med faktiska versioner `20261014144857/144904/144910` (inbyte), `20261014144917/144924/144931` (approval storage/read/mutation), `20261014152407` (gates), `20261014152423` (kalkyler), `20261014152437/152452` (äldre lager-/affärsfunktioner). Totalt **36 hosted migrationer**. Kontopolicien bevaras med en semantiskt likvärdig ALTER POLICY; dess SELECT/PERMISSIVE/authenticated-egenskaper och uttryck verifieras i verklig migrationskedja. Native requestState-fel löstes med detta mindre ingripande DDL-steg; ingen automatisk approval-rejection visades. Live rollback PASS för pending-spärr, granskat godkännande, exakt retry och avstängning samt versionsbundet inbyte/negativ mellanskillnad/oförändrad affär och lager. Efterkontroll noll syntetiska Authkonton/företag; faktisk company-/aktiveringsgate återläst aktiv. Inga nya säkerhetsvarningar; privata RLS-tabeller saknar avsiktligt direkta policies och tidigare lösenordsskyddsvarning kvarstår. Äldre signing/archive-migrationer fortfarande pending.

## Superadminöversikt och Trafexas kontomejl, 14 oktober 2026

Fortsättning från main `f462531aa39237cb4326de1364e81801d151c451`: superadminens standardvy är Översikt med faktiska totalsiffror för företag, verifierade användare/medlemskap, ansökningar, lager, affärer, offerter och kundsvar, annonsunderlag och finansintresse. Sju kalenderdagars aktivitet räknas i Europe/Stockholm. Lagerprissumman använder exakta ören och avser tillgängliga/reserverade objekt, inte omsättning. Globala databastotaler gäller hela plattformen, utan arbetsytans 500-radersurval. DTO innehåller endast whitelistade aggregat och bekräftad aktör, ingen företags-/kund-/Auth-PII. Faktisk verifierad Auth och aktivt privat superadminregister krävs; vanliga företagsroller och user_metadata ger ingen åtkomst. Före-/efterkontroll och UI-generation/aktörsnyckel hindrar sena gamla svar efter återkallad åtkomst. Företag och inkomna ansökningar behåller sina granskade hanteringsflöden.

Registrering, återställning och callback är bundna till `https://app.trafexa.com` i produktion även om localhost eller främmande host/config anges. Intern next-whitelist bevaras; inga tokens eller providerfel exponeras. Sex svenska HTML-mallar och ämnesrader har Trafexa-layout, support `info@trafexa.com` och nativa Supabase-platshållare. **Hosted Auth Site URL, redirectlista och mallar är inte ändrade eller verifierade av denna publicering.** Tillgängliga connectors saknar Auth-config-operation och miljön saknar färdig management-autentisering. [AUTH_EMAIL_SETUP](AUTH_EMAIL_SETUP.md) anger exakt separat aktivering. Gitdeploy aktiverar inga mejlmallar; inga verkliga mejl, SMTP-/DNS-ändringar eller säkerhetsnotifieringsändringar genomförs.

Verifiering: **389/389 apptester**, med fyra verkliga produktionsorigin-/callbackfall, sex overview-actiongrupper och åtta admin-browsergrupper (två nya), plus alla sex mejlmallars providerplatshållare/mobilrendering i faktisk Chromium. Adminlayout 320/375/768/1440 px och exakt stort belopp kontrollerade. **7/7 PostgreSQL/PGlite-grupper** passerar faktisk hosted migrationsbas med Auth-/registryförbud, alla företag över 500-radersurval, exakta stora ören, Stockholmsmidnatt, faktiska statuskällor och rollback. Produktionsbygge, TypeScript och diffkontroll PASS. Hosted migration `20261014115643_platform_overview` applicerad, totalt 26 migrationer; live rollback PASS och noll testkonton/registryrader kvar. Inga nya säkerhetsvarningar. Hela det autentiserade produktionsflödet och faktisk mejlleverans verifieras separat.

## Kontrollerad avbrytning av affärer, 14 oktober 2026

Fortsättning från main `3042d900ecc04dec5c3924011e9740b909d9fb36`: ägare/admin/säljare kan granska motiverad avbrytning av företagets utkast eller reserverade affär. Endast affärens aktiva reservationer avslutas; tillgänglig lagerstatus kräver att ingen aktiv reservation återstår. Sålda/arkiverade lagerposter öppnas inte. Offerter, kundsvar och privat oföränderligt auditkvitto bevaras. Accepterad offert spärrar vanlig avbrytning och manuell reservationsfrigivning; den förlänger inte befintlig reservations giltighet. Se [kontraktet](DEAL_CANCELLATION_CONTRACT.md) och [hela planläget](PLAN_PROGRESS.md).

Färsk faktisk Auth, medlemskap, företag, förväntad affärsstatus och aktörbundet exakt återförsök kontrolleras. UI granskar före skrivning, behåller nonce vid okänt utfall, blockerar vid konflikt/nekad åtkomst och uppdaterar arbetsytan efter verifierat kvitto. Komponentnycklar omfattar användare/företag/roll/affär/status; demo och läsroller kan inte skriva. Lager-/affärslåsen har samma ordning i avbrytning och reservationsfrigivning.

Verifiering: **376/376 apptester**, inklusive sex nya actionfall, fyra faktiska browsergrupper och verklig DealerWorkspace-roll-/företags-/demo-/statusintegration. Produktionsbygge, TypeScript och diffkontroll PASS. **7/7 PostgreSQL/PGlite-grupper** kontrollerar faktisk migrationskedja och hosted basis, terminalstatus, annan affärs reservation, accepterad offert, nonce/CAS, roller, Auth, privat audit och rollback. Hosted migrationer `20261014113331_deal_cancellation` och `20261014113343_cancellation_reservation_release` applicerade; totalt 25 hosted migrationer. Live rollback PASS och efterkontroll noll testkonton/företag/kunder/fordon/lager/affärer/audit. Inga nya säkerhetsvarningar. Inga mejl, providers eller schedulerjobb aktiverade. Full autentiserad produktionsbrowser och verklig multi-connection-låsväntan återstår separat. Äldre signing/archive-migrationer fortsatt pending.

## Kundens offertgranskning och tydligare startsida, 14 oktober 2026

Fortsättning från main `da3ae5b89933d07be9f1e247bb7d3fed8e9aa6eb`: handlaren granskar den senaste sparade offertversionens mottagare och giltighet innan den uttryckligen tillgängliggörs. Kunden använder `/my-offers` med faktisk verifierad Auth och matchande sparad kundadress, utan företagsmedlemskap eller onboarding. Offertens oföränderliga företag/kund/bil/pris/moms/giltighet/villkor visas; interna inköpskostnader, kollegors Auth-identiteter och CRM-anteckningar ingår inte.

Kunden anger namn, bekräftar läst underlag och granskar accept eller avböjande före skrivning. Avböjande och handlarens återkallelse kräver motivering. Aktörbundna exakta återförsök, versionskontroll, aktuellt datum i Stockholm och låst affär förhindrar dubbla eller inaktuella svar. Senaste version, aktiva företag/affärer, faktiska Auth-förbud och e-postkontroll sker i databasen. Okänd momsmodell, utgång och ersatt version blockerar färska svar. Historiska accepterade/avböjda svar och privata auditkvitton är oföränderliga; aktuell lista läses om efter kvitto. Detta är kundens registrerade svar på offertens villkor, inte BankID-identifiering eller elektronisk underskrift; reservation/försäljning/finansiering/leverans sker inte automatiskt.

Kundens säkra återvändningsväg bevaras genom inloggning, registrering och lösenordsåterställning. `/my-offers` är privat, dynamisk och ej indexerbar. Företags-/användar-/rollbyte stänger handlarens offertpanel; ändrad verifierad kundadress återmonterar kundvyn. Sena resultat ignoreras och nekad åtkomst rensar visat underlag. Integritets- och tjänsteinformation omfattar offertens kunddata och svarshistorik. [OFFER_REVIEW_CONTRACT](OFFER_REVIEW_CONTRACT.md) beskriver gränser och RPC.

Hero visar nu systemets konkreta innehåll: lager/bilder, kalkyl/moms och kunder/affärer, med tydliga knappar för ansökan och demo. Illustrationens VMB-exempel använder korrekt marginalmoms (289 000 − 250 000 = 39 000, moms 7 800, direkta kostnader 5 000, resultat 26 200 kr). Falska kontroller i exempelbilden och publika löften om aktivt PDF-arkiv har tagits bort; faktisk offert-PDF presenteras. Statisk produktbild är uttryckligen exempeldata. Chromium på faktiska komponenter kontrollerade 320/375/768/1024/1440 px. Oberoende browser på produktionsbygget kontrollerade hero på 320/375/768/1440, 200-svar, CTA, inga sidfel/overflow samt faktisk DealOffers-integration i demo.

Verifiering: 365 unika apptester passerar (samlad körning 364/364 följd av den nya utloggningsregressionen i 13/13 riktade auth-/kundroutefall). De omfattar elva nya actionfall, fem verkliga offertbrowsergrupper samt kundkonto/routing/recovery och befintliga regressioner. Efter skärpt remontering uppdaterades två befintliga scope-testfall för uttrycklig återöppning, och riktad browserkörning passerade 12/12. Produktionsbygge och TypeScript passerar. 8/8 riktiga PostgreSQL/PGlite-grupper kontrollerar verkliga migrationer med och utan pending signering/arkiv, två företag, alla roller, verifierad/nekad Auth, nonce/CAS, statusutgång, historik, whitelist, kundpaginering och 61 offertversioner med omvänd UUID-ordning.

Hosted applicerat: `20261014103212_offer_review_storage`, `20261014103222_offer_review_reads`, `20261014103234_offer_review_dealer`, `20261014103245_offer_review_customer` (totalt 23 hosted migrationer). Live rollback-SQL PASS för publicering, exakt återförsök, kundens minimerade underlag/exakta moms och auditerad accept. Efterkontroll noll kvarvarande testidentiteter/företag/granskningar/audit. Advisors har inga nya säkerhetsvarningar; privata RLS-tabeller nekar direkt åtkomst. Tidigare lösenordsskyddsvarning kvarstår. Inga mejl, externa partnerutskick eller schedulers har aktiverats. Inloggad browser mot verklig produktion och multi-connection-låsväntan är fortsatt separata verifieringsgränser. Nästa affärssteg: inbytesunderlag och kontrollerad avbrytning.

## Kontaktlogg och kunduppföljningar, 14 oktober 2026

Fortsättning från main `b05ec029c6d6bb608985dc8a58781e87ea52fc8a`: kunder kan öppnas från kundtabellen eller företagets uppföljningar. Kontaktloggen registrerar telefon, e-post, möte eller anteckning med kontaktdatum, sammanfattning och valfritt uppföljningsdatum. Fler­radsanteckningar stöds; historiken sorteras på kontaktdatum även när äldre kontakter läggs in senare. Författare visas som Du/Kollega utan andra användares Auth-e-post.

Översikten och kundvyn hämtar företagets väntande uppföljningar med dagens datum i Europe/Stockholm och filter för förfallna/dagens, kommande och alla väntande. Databasfrågan omfattar hela företaget, inte arbetsytans 500 kundrader. Datum-/ID-baserad paginering och klick till en kund utanför tabellurvalet är verifierade. Granskad klar-/avbrottsmarkering kräver motivering och versionskontroll; orsaken och oföränderligt kvitto lagras i privat audit. Ett kvitto ersätter inte en färsk läsning av aktuell status.

Färsk Auth, faktisk företagsstatus och aktivt medlemskap kontrolleras före och efter serveråtkomst. Ägare/admin/säljare skriver, ekonomi/läsroller läser. Företags-/kundbyte, återkallad åtkomst och versionskonflikt hanteras utan att gammal kontaktdata används för en ny ändring. Inga e-post-, SMS-, partner- eller schedulerutskick aktiveras.

Verifiering: **340/340 apptester**, inklusive tio nya actiontester, fyra faktiska CRM-browsergrupper och dealer-integrationens kundval/nekad åtkomst/företagsbyte. Produktionsbygge och TypeScript passerar. **7/7 PostgreSQL/PGlite-grupper** kontrollerar faktisk migrationskedja, två företag/roller, datum, flerradssammanfattning, privata tabeller, återförsök, CAS och kronologisk paginering över 503 poster.

Hosted applicerat: `20261014094251_crm_contact_storage`, `20261014094301_crm_contact_reads`, `20261014094310_crm_contact_mutations`. Hosted rollbacktest PASS för kontakt, exakt återförsök, företagsgemensam förfallen uppföljning och auditerad färdigmarkering. Efterkontroll: noll kvarvarande testidentiteter/företag/kunder/kontakter/auditposter. Advisors har inga nya säkerhetsvarningar; avsiktliga privata RLS-listor och tidigare lösenordsskyddsvarning skiljs från denna leverans. Inloggad produktionsbrowser och verklig multi-connection-låsväntan är fortsatt separata verifieringsgränser.

## Webbansökningar och integritet, 14 oktober 2026

Fortsättning från main `74b0e9b7df559ced10229775025c1008107b6abb`: webbansökan kräver kontaktens namn, e-post, telefon, företagsnamn, svenskt organisationsnummer med kontrollsiffra, sökta tjänster och beskrivning. En omarkerad bekräftelse av läst integritetsinformation sparar policyversion och serverns mottagningstid. Den är inte ett generellt dataskydds- eller marknadsföringssamtycke. Stabilt begärans-ID och exakt kvitto förhindrar dubbletter och falsk framgång vid återförsök.

Superadminens **Inkomna ansökningar** visar alla uppgifter, äldre ofullständiga förfrågningar, status och historik. Behörighet bygger på faktisk verifierad Auth och det privata UUID-registret. Statusändring och uttryckligen granskad radering använder versionskontroll. Radering tar bort ansökarens uppgifter och ärendehistorik; ett begränsat pseudonymiserat tekniskt kvitto förhindrar återskapande vid sena återförsök. Ingen ansökan skapar automatiskt konto, kreditbeslut eller utskick till partner.

Cookiepolicy och integritetspolicy beskriver faktiska uppgifter, rättsliga grunder, lagringskriterier, rättigheter och leverantörsöverföringar. Endast nödvändiga cookies används; informationsrutan är inget samtycke till spårning och blockerar inte ansökan. Policybekräftelsen kan återöppnas och glömmas utan att autentiseringscookies raderas. Trafexa Nordic AB, 556855-4884, och kontaktadressen info@trafexa.com är bekräftade av ägaren. [WEB_PRIVACY_OPERATIONS](WEB_PRIVACY_OPERATIONS.md) beskriver verksamhetens återstående rutiner och avtalskontroller; policytext certifierar inte full GDPR-efterlevnad.

Verifiering: **325/325 apptester**, produktionsbygge och TypeScript PASS. **12/12 PostgreSQL/PGlite-grupper** passerar den faktiska migrationskedjan. Hosted rollbacktester verifierar obligatoriska fält, privat åtkomst, exakta återförsök, superadmindetaljer, status-CAS, radering och spärr mot återskapande. Efterkontroll: noll kvarvarande testkonton, ansökningar och raderingskvitton.

Hosted applicerat: `20261014075213_web_application_schema`, `20261014075229_web_application_submission`, `20261014075241_web_application_admin`, `20261014075445_web_application_erasure`. Migrationsverktygets requestState-fel löstes genom att dela samma testade förändring i mindre beroendeordnade migrationer. De gamla inkompletta submit-RPC:erna är stängda. Äldre pending signering/arkiv är inte applicerade. Inga nya säkerhetsvarningar; tidigare avstängt läckt-lösenordskydd kvarstår. Full inloggad produktionsbrowser verifieras separat från rollback och lokala UI-fixtures.

Färsk kontroll visar att `hekmat.h@trafexa.com` har aktiv förgodkänd reservation men ännu inget Auth-konto eller aktiverat UUID-registry. Ägaren registrerar adressen via `/register?next=/admin`, verifierar e-post och aktiverar den förgodkända åtkomsten i `/admin`. Detta skickar inga kontomejl från agenten.

13 oktober 2026 • aktuell leverans på `feat/vehicle-ads-and-calculations-20261013`, från main `0604605c9a96ca02c1a5d874e3d69b6288d4ed0b`; tidigare checkpoints redovisas nedan

## Annonskonto, privata fordonsbilder och kalkyl, 13 oktober

Implementerat lokalt: Annonskonto med faktiska lagerbilval, pris från servern, versionsbundna utkast/klarmarkering, bildval, registreringsnummeropt-in, granskningssteg och explicit bekräftade kanalutskick. Högst 50 poster per sida; roller och aktuell användare/företagskontext läses på servern. Ägare/admin begär kanalanslutning med icke-hemlig kontoreferens; säljare hanterar annonser, finans/läsroller läser. Historiska kvitton används inte som aktuell status: ny serverläsning krävs och återkallad åtkomst rensar UI-data. Okänt nätverksutfall behåller samma begärans-UUID.

Privat bilduppladdning och återläsning är implementerade med JPEG/PNG/WebP, 10 MiB/20 bilder, avkodning, orienteringsnormalisering och återkodning till samma format utan metadata. Registrering sker efter objektuppladdning och verifieras mot aktuellt Auth/företag igen. Ett privat orphan-objekt kan bli kvar om SQL-registrering nekas eller utfallet är okänt. Ingen användar-DELETE eller automatisk städning tillåts; det undviker register/delete-race och bevarar identiska retries. Fotoarkivering ändrar nya bildval men bevarar tidigare annonsversioners underlag. Retention/avstämning är en kvarstående driftuppgift, inte en påstådd schemalagd funktion. Supabases globala Storage-UPDATE-grant innebär inte overwrite i denna bucket: det saknas UPDATE/ALL-policyer och uppladdningen använder `upsert:false`.

Exakt fordonskalkyl använder serverhämtade decimalsträngar i heltalsören och `BigInt`, versionsbundna momsunderlag och separata värden för okänt (`null`) och bekräftat nollavdrag. Individuell VMB utgår från positiv försäljning-minus-inköp; andra kostnader minskar inte VMB-marginalen. Vanlig moms använder bekräftat inköps-/kostnadsavdrag. Saknad momsmodell eller underlag ger inget påhittat resultat efter moms. Företagets totalsummor och bilkalkyl är intern analys, inte bokföring, momsdeklaration eller förenklad VMB.

**Providergräns:** användaren har bekräftat att partneråtkomst saknas. Blocket/Wayke och workerdrift är förberedda/inaktiva. Ingen annons har skickats, ingen offentlig testannons skapats och inga credentials eller heartbeat-jobb aktiverats i denna lokala leverans. `requested` är en anslutningsförfrågan; `verified` kräver separat betrodd bindning. Köning kräver dessutom färsk dispatcher-readiness. `queued`, `submitted` och `published` är separata tillstånd och publicering kräver leverantörsbevis. Publicerad annons behöver inte ha en URL; en eventuell länk kommer från verifierad providerdata och konstrueras aldrig från gissningar.

Blocketprototypen stoppar senare annonsversioner, inklusive det verkliga första klarmarkerade utkastets version 2. Beständig extern leveransrevision, CREATE/UPDATE och request-korrelerat bevis är återstående aktiveringskrav. Waykes DMS-/medie-/publiceringskontrakt återstår. Implementerad exportbridge i `src/lib/vehicle-photos/export-media.ts` normaliserar faktiska privata bytes, lagrar utan overwrite separat i `ads-export-media`, återläser/hashverifierar och kontrollerar privata bucketar före eventuell länkutfärdning; `ads-vehicle-photos` signeras aldrig direkt externt. Bridgen är avstängd som standard och läser inga credentials: aktivering kräver betrodd injicerad serverklient. Länkgiltighet är normalt 48 timmar och minst 24 timmar ska återstå vid överlämning. Tidskravet är lokal policy inför partnerbekräftelse, inte ett verifierat providerlöfte. Exportobjekt städas inte automatiskt när länken går ut. Samma-format-normalisering är inte WebP→JPEG-konvertering och Blocketval med WebP spärras. [Integrationsunderlaget](ADVERTISING_INTEGRATIONS.md) beskriver providerkrav och driftgräns.

| Kontroll i den aktuella leveransen | Bevis och gräns |
| --- | --- |
| Faktisk annons- och kanal-UI med faktisk privat Gallery | PASS 6/6 Chromiumfall i `tests/advertising-ui.test.mjs`, inklusive 390 px, Strict Mode, snapshot-/kanalbekräftelse, okänd transport med samma UUID, köad kontra publicerad, saknad anslutning, WebP-spärr och återkallad åtkomst. Actiontransport är kontrollerade fixtures och alla page-HTTP-anrop blockeras |
| Annonsactions och DTO-gränser | API-agenten rapporterar PASS 19/19 actual-moduleloader-fall; detta är lokal serverkontraktsverifiering, inte hosted RPC eller partneråtkomst |
| Faktisk exportnormalisering och privata filbytes | PASS 9/9 via `node --test --test-isolation=none tests/advertising-export-media.test.mjs`: riktig JPEG/PNG/WebP-avkodning/metadata-rensning, faktisk filåterläsning/hash, oföränderligt återförsök, falskt scope/MIME, privata bucketar och exakt betrodd länk. Storage-transport är fixtures; inga hosted exportfiler eller partnerlänkar skapas |
| Samlad rootverifiering | PASS 305 appbeteenden efter riktad omkörning av den uppdaterade returvägsregressionen, inklusive faktisk Chromium-UI, 18 bildflödestester och 9 exporttester. Produktionsbygge och TypeScript passerar. Separat PASS 11/11 annonsdatabasgrupper och 7/7 kalkyldatabasgrupper mot faktisk migrationskedja; hosted rollbackkontroll av RPC-/Storage-gränser passerar. Inloggad produktions-CRUD och externa leverantörsflöden ingår inte i detta bevis |
| TypeScript och dokumentationskontroll | `npm run typecheck` och `git diff --check` PASS efter Gallerykoppling och uppdaterade kontrakt |
| Hosted migration/readback | Samordnaren bekräftar applicerade `20261013212215_vehicle_calculations` och `20261013212229_advertising`, privata bild-/exportbucketar samt noll verifierade kanalanslutningar och noll dispatchers. Appdeployment/autentiserat hosted UI-flöde verifieras separat; kanaler och workers är inaktiva |

## Personal och inbjudningar, 13 oktober

Personalpanelen har företagsbunden teamlista, roll-/statusadministration, privata e-postbundna inbjudningar och återkallelse. Mottagarsidan `/invitations` fungerar utan befintligt företagsmedlemskap. Inbjudningar gäller sju dagar och accepteras uttryckligen efter verifierad Auth. Ingen ägarroll eller superadminroll kan delas ut; avstängda medlemskap reaktiveras inte genom inbjudan. Inga utgående inbjudningsmejl eller hemliga delningslänkar används. [COMPANY_TEAM](COMPANY_TEAM.md) beskriver användarflödet och kontrakten.

Färsk verifiering: 210 appbeteenden passerar, inklusive 20 servergränstester, 13 navigationstester och åtta riktiga Chromiumfall för team/mottagare, mobilvy och Strict Mode. 13 PostgreSQL/PGlite-grupper kontrollerar faktisk migrationskedja, behörigheter, utgång, återförsök och fristående hosted-grund utan pending signering/arkiv. Bygge och TypeScript passerar. Shared Auth-radlås och slutlig väggklockekontroll skyddar acceptans; verklig multi-connection-låsväntan är fortsatt inte bevisad av PGlite.

Hosted `20261013192237_company_team` är applicerad efter verifierad migrationshash `11e5b2c9b051f2c3f136edf75ce0bb16eaf4ffd697348aa24585076e3a49cddf`. Hosted rollbacktest verifierar RPC-/tabellgränser, normaliserad inbjudan, identiskt återförsök och ägarskydd. Efterkontrollen visar noll testkonton/företag och noll kvarvarande testinbjudningar eller auditposter. Advisors visar avsiktliga privata RLS-listor utan direkt användarpolicy; inga nya säkerhetsvarningar. Det tidigare avstängda [läckta-lösenordskyddet](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection) och informationsnotiserna om nya oanvända index kvarstår.

Verifierad föregående main/produktion efter [PR #6](https://github.com/heke99/trafexa-auto/pull/6): `4711726afe1591e50a1e0b9551be0c55eb25db5c`, deployment `dpl_8dZBvac1KYRqhpZGAadyr2cnfNzG`, `READY`, target production, `arn1`, app/www/apex-alias. Native fetch av publik webb gav 200 med rätt kontaktadress utan synlig pilottext; `/admin` gick till login med `next=/admin` och registrering bevarade samma returväg. Den nya personalleveransens release verifieras separat i PR/deployment. Full autentiserad produktions-CRUD är fortfarande inte verifierad.

## Produktpresentation och plattformsadministration, 13 oktober

Publika texter och handlararbetsytans synliga pilotmarkeringar är ersatta med Trafexa Dealer och tydliga beskrivningar av lager, CSV-import, kalkyl, CRM, offerter, reservationer och privata dokument. Företagets kontaktadress är `info@trafexa.com`. Fiktiva exempel och verkliga krav på externa anslutningar är fortsatt tydliga. Produktgodkännanden visas som sådana, utan att påstå att en finanskanal är aktiv.

`/admin` är en separat plattformsportal med företagsöversikt, inkomna kontakter och granskade, motiverade statusändringar. Den kräver verifierad Supabase Auth och en privat UUID-lista; företagsägare har ingen automatisk global åtkomst. Registrering, inloggning och bekräftelselänk behåller den säkra lokala returvägen till admin. Sidvisning aktiverar aldrig behörighet.

Hosted Supabase har nio applicerade migrationer, inklusive `20261013184149_platform_admin`. Live katalogkontroll bekräftar invoker-wrapper, privata definerfunktioner med låst sökväg och inga execute-grants till anon/service_role. Nekad åtkomst har kontrollerats med rollback. Den användargodkända adressen `hekmat.h@trafexa.com` har en aktiv, oanvänd privat reservation. Kontot finns ännu inte i Auth och ingen UUID-superadmin har därför skapats. Kontoägaren registrerar sig, verifierar adressen och aktiverar den förgodkända åtkomsten själv.

Färsk lokal verifiering: 169 appbeteenden passerar, inklusive tre Chromiumkontroller av verklig admin-UI och åtta tester av authnavigation. Fyra PostgreSQL/PGlite-tester verifierar den faktiska migrationskedjan och admin även utan de två ännu pending signerings-/arkivmigrationerna. Bygge och TypeScript passerar. PGlite serialiserar anslutningar; verklig samtidig lockväntan över flera databasanslutningar och inloggad produktions-CRUD är inte verifierade. Se [adminflöde och drift](PLATFORM_ADMIN.md).

Advisors efter DDL: privata adminregister och revisionslistor har avsiktligt RLS utan användarpolicyer, med all direkt klientåtkomst indragen. [RLS-lintens beskrivning](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy). Auths befintliga [läckta-lösenordskydd](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection) är avstängt; detta är inte ändrat i denna leverans. Oanvända index är informationsnotiser vid denna nya databas och tas inte bort utan faktisk lastmätning.

## Hur historisk status ska läsas

Bygggrunden är återhämtad från originalarbetet och fortsättningen har lagt till finansåtkomst, företagskontext, reservationsutgång, import, kostnader, CRM, offertversion/PDF och ett avstängt signeringsbibliotek. PR #4:s 107/107 beteenden, 11/11 filsviter, 7/7 live-SQL-regressioner och PDF-fonttrace behålls som historisk verifiering. Efterföljande PR #5/main `7fc833f` har färsk rootkörning PASS 137/137 och bygge inklusive TypeScript, 14 sidor, ny dokument-PDF-route och fonttrace. Alla åtta migrationer har verifierats genom live-readback och databastyper har regenererats efter CRM. Tidigare lokal produktionsbrowser passerade 31/31 och samlad utvecklings-/mock-/produktions-QA 182/182; dessa är historiska resultat och har inte räknats om efter slutfixarna. PR #4 är faktiskt mergad till `main` med verifierad checkpoint `db7143` och identiskt tree med den testade implementationen. Historiska previewbevis bevaras. Historisk PR #4-produktion är verifierad `READY` och aktuell PR #5-produktion anges separat nedan; full auth och autentiserad CRUD genom produktionsgränssnittet är ännu inte verifierad.

Den tidigare statiska Trafexa-sajtens formulärkontroller hör till en annan kodbas och är inte verifiering av denna Next.js-/Supabase-app.

## Bekräftade resurser och auktorisation

| Resurs | Aktuell kunskap |
|---|---|
| Repository | `heke99/trafexa-auto`; denna branch fortsätter dealerappen som ersätter gamla sajten. |
| Vercel | Projekt `prj_zWks8Qd6m9ijWdu3tzid9RJlGgGE`, team `team_e3htkJPyBNSw3Ix1KQLlf180`; källkonfiguration Next.js och `arn1`. |
| Supabase | Trafexa Dealer, `buqdtssxrotkzndublrt`, Stockholm / `eu-north-1`; livekontroll bekräftar `ACTIVE_HEALTHY`. |
| Migrationer | Personalcheckpointen hade tio applied-versioner: team `20261013192237`, plattformsadmin `20261013184149`, tre grundmigrationer samt finansåtkomst `20261013151347`, reservationsutgång `20261013151355`, lagerimport `20261013152832`, offertversioner `20261013154317` och CRM `20261013160452`. Den aktuella annons-/kalkylleveransens två tillägg är verifierat applicerade enligt ovan. |
| Domäner | Readback bekräftar `trafexa.com`, `www.trafexa.com` och `app.trafexa.com` som verifierade i Vercel. Ingen DNSmutation; appens faktiska HTTP-/authflöde kontrolleras vid publicering. |
| Uppdrag | Originalchatten `01a13504-1d80-7611-92e8-9076ccf7605d`, användarturn `01a13554-497f-7729-abd7-e91341e8105c`, godkänner ersättningen av gamla sajten och byggandet i befintliga Trafexa Auto-resurser. |

## Historiskt verifierad main-merge: PR #4

| Referens | Faktisk status |
|---|---|
| Godkännande | Användaren instruerade ”fortsätt då och lägg in det på main”. |
| Pull request | [PR #4](https://github.com/heke99/trafexa-auto/pull/4), mergad till `main`. |
| Main-commit | `db7143cd633a2cee07457295fac8a75132e7352d` |
| Tree | `c12c75a8ce303aa7c26428334ad40dc7f00fe3b1`, identisk med testad implementation `403776131d3680e6f42aee566627fc2f9ab7f976`. |
| Lokal avstämning | Historisk PR #4-checkpoint; arbetskopian står därefter på den historiska main-checkpointen `7fc833f`. |
| Produktion | `dpl_8Z69TvzBVQVeVeKDwrUfAYjJUzWY`, `READY`, target `production`, rätt projekt och `arn1`, för ovanstående commit/tree. |
| Deployment-URL | [trafexa-auto-6uva9o390-div3rsa.vercel.app](https://trafexa-auto-6uva9o390-div3rsa.vercel.app) |
| Produktionsalias | `app.trafexa.com`, `www.trafexa.com` och `trafexa.com`. |
| Verifierad webb | Native fetch av [www.trafexa.com](https://www.trafexa.com/) gav 200, ”Mer bilaffär. Mindre administration.” och exakt deployment-ID. |
| Verifierad login | Native fetch av [app.trafexa.com/login](https://app.trafexa.com/login) gav 200, ”Välkommen tillbaka.” och exakt deployment-ID. |
| Canonical redirect | `trafexa.com/` gav 308 till `https://www.trafexa.com/`; beviset innehåller ingen shareparameter. |
| Täckningsgräns | Full auth/remote CRUD är inte verifierad och inga verkliga authmejl skickades. |

## Historisk main/produktion efter PR #5

Historisk main-checkpoint efter [PR #5](https://github.com/heke99/trafexa-auto/pull/5) är `7fc833f643a488b8af34bb950df22769e99be32b`, tree `89d9774a25c13f3197c5b9d09668baa05dbbe50f`. Produktion `dpl_6vcexX8f1Jw5mWPyYLzpFSd6g1sS` är `READY`, target `production`, rätt projekt/`arn1` och alias app/www/apex: [deployment](https://trafexa-auto-h8cvlrqe0-div3rsa.vercel.app). Native lagerdemo gav 200, ”Fordonslager” och exakt detta deployment-ID. Extern browseranslutning blockerades med CONNECT 403 före appkontroller: noll genomförda checks. Färsk rootkörning av denna main passerar 137/137 beteenden och produktionsbygge inklusive TypeScript, 14 sidor och ny dokument-PDF-route. Fonttrace PASS omfattar offert-PDF, demo- och dealer-page samt nya archive-actionens användning. Sex lokala Chromium-harnessfall ingår i totalsviten och är inte extern produktionsbrowser.

Vid PR #5 bekräftade livekontrollen åtta applicerade migrationer. PR #5:s två nya lokala migrationer är inte hosted-applicerade och servicekey för ny arkivregistrering saknas. Signeringsprovider och workerdispatch förblir tvingat `enabled:false`; hosted arkivering/signering är inte aktiverad. PR #5:s egna integrationsunderlag och verifieringar bevaras separat och testsummorna adderas inte som unika fall.

## Verifierade preview-checkpoints

| Artefakt | Bekräftad referens/status |
|---|---|
| Pull request | [PR #4](https://github.com/heke99/trafexa-auto/pull/4), då draft och attached till uppdraget; nu mergad enligt ovan. |
| Branch | `codex/trafexa-dealer-continuation-20261013` |
| Commit | `cf953d4078c047efefe3da1674a989ad571eea52` |
| Tree | `a204d647a4d81fa5d6f26f67c57165afa3ac1d0c`; avstämd mot den publicerade checkpointen `cf953d4`. |
| Deployment | `dpl_GveGscnZV3szkXC3xwgYKJNbtkst`, automatiskt skapad preview, `READY`. |
| URL | [trafexa-auto-304mxzp8h-div3rsa.vercel.app](https://trafexa-auto-304mxzp8h-div3rsa.vercel.app) |
| Mål | Preview i `prj_zWks8Qd6m9ijWdu3tzid9RJlGgGE`, team `team_e3htkJPyBNSw3Ix1KQLlf180`, region `arn1`. |
| Remote installation/bygge | Byggloggar för denna deployment visar `Running install command npm ci`, 73 installerade paket på sex sekunder, sedan `npm run build` och `READY`. |
| Skyddad fetch | HTTP 200 för lagerdemo, kunddemo/CRM och login via det native åtkomstverktyget. |
| Produktionspåverkan | Ingen ersättning av `main` eller produktion genom denna preview. |

Remote PDF-anrop utan appsession rapporterade HTTP 401, men åtkomstverktyget klassade det som `deploymentAuthRequired` och returnerade inte body. Det resultatet räknas därför inte som bevis för appens PDF-behörighetsgräns eller autentiserad remote PDF-CRUD. Appgränserna har passerat lokalt; faktisk remote PDF-hämtning återstår.

Den senare verifierade Node-checkpointen är:

| Artefakt | Bekräftad referens/status |
|---|---|
| Commit | `69ed849af1afe19c1c637f71940ec70384f1ce46` |
| Tree | `f9de92c9198e49135bb7fac2326dcd384f50e168` |
| Deployment | `dpl_EgM71HipZpPg2XVMzxefqFzt6vTx`, `READY`. |
| URL | [trafexa-auto-qv9b55c4h-div3rsa.vercel.app](https://trafexa-auto-qv9b55c4h-div3rsa.vercel.app) |
| Avstämning | Native readback verifierar projekt och commit; rätt projekt/team och `arn1`. Lager- och kunddemo gav 200 med förväntat gränssnitt. |
| Node.js | Manifest och lockfil låser `24.x`; lokal verifieringsmaskin kör `24.19.0`. |

Den tredje historiskt verifierade checkpointen är:

| Artefakt | Bekräftad referens/status |
|---|---|
| Commit/tree | `aed26dff099fc552687c29182d9a895da28ddd28` / `b36d0d668c9365df592001ffbd980b31ec28dd4a` |
| Deployment | `dpl_62td1ULZfX4FVG8WxrepwNvUrerC`, `READY`. |
| URL | [trafexa-auto-cvhiuxi96-div3rsa.vercel.app](https://trafexa-auto-cvhiuxi96-div3rsa.vercel.app) |
| Avstämning | Native readback matchar rätt projekt, commit och `arn1`; lager- och kunddemo gav 200 med deployment-ID. |
| Täckningsgräns | Den nya återställningsfixen tillkom senare och ingår inte i denna checkpoints verifierade resultat. |

Dessa är historiskt verifierade checkpoints. PR #4 är nu mergad; efterföljande main-pushar följs i Vercels deploymentstatus med respektive commit. Checkpointresultat överförs inte till senare kodversioner.

Efter Node-checkpointen tillkom två lokalt verifierade korrigeringar: beloppsvisningen i lager/affärer bevarar ören i stället för att avrunda till hela kronor, och pilot-API:t accepterar den specifika `VERCEL_BRANCH_URL`-originen. Andra Vercelhosts nekas fortfarande med 403. Två SSR-beloppsregressioner och en produktions-originregression ingår i de senaste 107 beteendetesterna. Därefter härdades återställningsförfrågan med fem regressioner för bekräftat svar och säkra SDK-/klient-/nätverksfel, utan verkliga authmejl.

## Återhämtad och fortsatt implementation

| Område | Vad som finns i kod/schema | Kvarstående omverifiering eller funktion |
|---|---|---|
| Webbgrund | Next.js App Router, React, TypeScript, Supabase SSR, Node `24.x`, låsta beroenden och Vercelkonfiguration. Databastyper regenererade; lokala kontroller PASS. Tre verifierade preview-checkpoints `READY`. | PR #4/main och produktion är verifierade; full auth och autentiserad remote-CRUD återstår. |
| Publik sida | Ny svensk Trafexa-hemsida, demo, integritet/villkor och mobilmeny. Lokal produktionsbrowser PASS. | Produktionssidan gav 200 och apex gav verifierad 308 till www; övriga produktgränser kvarstår. |
| Konto | Registrering, bekräftelsecallback, inloggning/utloggning och återställning. Återställning visar villkorlig framgång endast efter SDK-svar utan fel; SDK-/klient-/nätverksfel ger generiskt fel. Fem authregressioner PASS isolerat och i fullsviten, utan verkliga authmejl. | Komplett authflöde/redirects/cookies i avsedd miljö återstår. |
| Företag | Företagsskapande, företagsväxling och fem roller. Gemensam kontext verifierar användare, aktuellt medlemskap och aktivt företag; stale/ogiltigt val väljer inget annat företag automatiskt. SQL-isolering och tolv permanenta kontexttester PASS. | Autentiserat browserflöde mot produktionsgränssnitt, inbjudningar och filialer återstår. |
| Lager | Manuell registrering, sök/filter/sortering, pris/kostnader och CSV-import samt nya privata bilder och exakt fordonskalkyl. Beloppsvisning bevarar ören; SSR-, server-/SQL- och mockade UI-regressioner PASS. | Autentiserad produktions-CRUD och samtidighet; ny appdeployment och autentiserad bild-/kalkylverifiering, inköpsunderlag och full skick-/kostnadsspårning återstår. |
| Kunder/CRM | Kundkort/sök samt behovsladdad förfrågningspanel. Atomiskt kontakt-/lead-intag, sjudagars UUID-retry, sidindelning och statusbyte med kontroll av tidigare status. Action-, live-SQL- och mockade UI-kontroller PASS. | Autentiserad produktions-CRUD, full kontakt-/aktivitetshistorik och bredare kunduppdatering återstår. |
| Affärer | Affärsutkast, reservation/frigivning/utgång och offertversionering med prisbekräftelse/återförsöksskydd. SQL samt lokala/mockade kontroller passerade. | Autentiserad produktions-CRUD, inbyte och leverans återstår. Kundens offertgranskning/svar är separat implementerade ovan. Reservationsjobb och riktiga samtidighetstester har tillkommit i etappen 15 oktober, se ovan. |
| Finansiering | Internt `intake` med skärpt RLS: ägare/admin/finans ser företagets intag; säljare ser sitt eget. SQL för läs-/skrivgräns passerade. | Ingen bankadapter, kreditbedömning, utbetalning eller lagerkredit är aktiv. |
| Dokument/offert-PDF | Företagsanknutna metadata/privat bucket, oföränderligt offertsnapshot och sessions-/företagskontrollerad PDF-route. PDF-tester, fonttrace och lokala/mockade kontroller passerade. | Autentiserad PDF-hämtning genom produktionsflödet, mallbyggare, signering, signeringsevidens och hämtning av arkiverade dokument återstår. |
| Signeringsbibliotek | Slutlig adapter, domänmodell, ledger/store/user/worker/inbox/storage från PR #3, commit `86bbce9`, finns nu i appen. Server-wrapper tvingar provider och dispatch till avstängt läge. 106 lokala signeringsfall passerar. | Additiv migration, verkligt godkänt avtalsrenderunderlag, providermall/credentials, signeringsroutes, webhookdrift och hosted flöde behöver fortfarande aktiveras och verifieras. Se [integrationsguiden](DOCUSEAL_INTEGRATION.md). |
| Nätverk | Informationsvy inför kontrollerad pilot. | Publicering, inköpsönskemål, matchning, bud och B2B-affär återstår. |
| Ekonomi | Exakt individuell fordonskalkyl med vanliga moms-/VMB-referensregler, registrerade kostnader och explicit avdragsunderlag. Okänt underlag ger inget färdigt resultat efter moms. | Ingen full ekonomimodul, förenklad VMB, momsdeklaration, faktura, betalningsavstämning eller bokföringsexport. |
| Annonskonto | Versionerade annonsutkast, bildval, pris från lager, registreringsnummeropt-in, privat media och granskat kanalflöde är implementerade lokalt. | Hosted migration är applicerad; ny appdeployment och autentiserad driftkontroll redovisas separat. Blocket/Wayke saknar partneråtkomst och är inaktiva, med kvarstående revisions-/skrivkontrakt enligt ovan. |
| Demo-/pilotförfrågan | `POST /api/demo-requests`, ursprungskontroll inklusive specifik `VERCEL_BRANCH_URL`, JSON/storleksgräns, honeypot och privat intag. Produktionsregression tillåter avsedd branchorigin och nekar andra Vercelhosts med 403. | Komplett browser/API/databasflöde; förfrågningar sparas, automatiska aviseringar ingår inte. |
| Audit/integritet | RLS, företagsreferenser, kontrollerade mutationer och audittriggers. Sju live-SQL-regressioner med rollback passerade, inklusive CRM:s statuskolumn/grants och audit. | Aktuellt företags-/sessionsflöde och samtidiga anslutningar behöver ytterligare browser/integrationskontroll. |

## Migrationer och återhämtningsluckor

| Fil | Bekräftad applied-version |
|---|---|
| `supabase/migrations/20261013130218_dealer_foundation.sql` | `20261013130218` |
| `supabase/migrations/20261013130603_dealer_integrity_hardening.sql` | `20261013130603` |
| `supabase/migrations/20261013130654_explicit_data_api_grants.sql` | `20261013130654` |
| `supabase/migrations/20261013151347_finance_access_scope.sql` | `20261013151347` |
| `supabase/migrations/20261013151355_reservation_expiration.sql` | `20261013151355` |
| `supabase/migrations/20261013152832_stock_import.sql` | `20261013152832` |
| `supabase/migrations/20261013154317_offer_versions.sql` | `20261013154317` |
| `supabase/migrations/20261013160452_customer_leads.sql` | `20261013160452` |

De återhämtade arbetsförsöken för finansåtkomst och reservationsutgång har granskats och fortsatts med de bekräftade liveversionerna ovan. Lokala namn har synkroniserats till dessa versioner. Offertapply och live-readback är bekräftade; fullständiga databastyper har regenererats efter schemats fortsättning.

SQL-regressioner finns nu för `tenant_isolation`, `public_and_storage`, `finance_access_scope`, `reservation_expiration`, `stock_import`, `offer_versions` och `customer_leads`. Samtliga sju har passerat mot det bekräftade projektet med syntetiska fixtures och rollback. CRM-testet täcker båda företag, alla roller, sjudagars återförsök, 1000-kvittonsgräns, audit, statuskonflikt och begränsade kolumngrants, utöver övriga sviters företags-/lagrings-/reservations-/import-/offertgränser.

Livekörningen av offerttestet utelämnade det simulerade legacyfallet med ogiltiga källdata för att undvika ändring av tabellconstraints i liveprojektet. Hela offertsviten, inklusive tolv kontroller av källdatagränser, har i stället passerat i isolerad PGlite. Sex PDF-testfall ingår i de passerade Node-testerna. Denna skillnad i miljö och täckning är avsiktligt redovisad; isolerade legacyfall är inte liveändringar.

## Schemaläggning och kvarstående advisory

Historiskt läge vid PR #4/main: ingen scheduler var aktiv. Reservationsutgång skedde i den applicerade RPC-kedjan när ny affär skapades eller bil reserverades, med bevarade reservationsposter. En utgången post kunde ligga kvar med reserverad liststatus tills nästa sådan operation. Den 15 oktober har permanent schemaläggning uttryckligen godkänts; aktuell aktiveringsstatus anges i etappavsnittet ovan.

Automatisk godkännandegranskning avvisade historiskt `20261013153335_reservation_expiry_schedule`: åtgärden skulle installera permanent `pg_cron` och utföra minutvisa mutationer i produktionsdatabasen. Förslaget flyttades till `docs/proposals/reservation_expiry_schedule.sql`, utanför migrationskatalogen. Ett andra aktiveringsförsök avvisades eftersom den dåvarande main-instruktionen inte tydligt godkände detta separata permanenta minutjobb. Ingen förändring applicerades då och main-mergen genomfördes utan scheduler. Livekontrollen efter avslag bekräftade `pg_cron_exists = false`. Det senare uttryckliga godkännandet den 15 oktober ersätter den tidigare obesvarade frågan; det är inte i sig bevis på genomförd aktivering.

Vid denna historiska checkpoint rapporterade koordinerande agents security-advisor-kontroll endast att skydd mot läckta lösenord var avstängt. Inställningen ändrades inte av dokumentationsarbetet. Detta historiska advisoryresultat ersätter inte senare advisor-, åtkomst- eller browserregressioner; kontrollen före etappen 15 oktober anges ovan.

Originalplanens innehållsförteckning 1–22 och fulla fas 0–10 återhämtades, men inte hela originaltexten eller samtliga ursprungliga tester. [MASTERPLAN](MASTERPLAN.md) redovisar den rekonstruerade fortsättningen och källfragmentens begränsningar.

## Verifieringsprotokoll i denna fortsättning

| Kontroll | Nuvarande bevis/status |
|---|---|
| Projekthälsa och migrationlista | Bekräftat live av koordinerande agent: aktivt och friskt projekt, åtta applied-versioner enligt ovan med full readback. |
| Security advisor | Endast advisory om avstängt skydd mot läckta lösenord, enligt koordinerande agents senaste kontroll. |
| Node.js | Lokal verifieringsmaskin `24.19.0`; manifest/lockfil låser `24.x` i verifierad `READY`-checkpoint `69ed849`. |
| Remote `npm ci` och bygge | PASS i första checkpointen `dpl_GveGscnZV3szkXC3xwgYKJNbtkst` / `cf953d4078c047efefe3da1674a989ad571eea52`: 73 paket på sex sekunder, följt av `npm run build` och `READY`. |
| `npm run typecheck` | PASS efter CRM-typregenerering samt belopps-/originfixar; senaste byggning inklusive TypeScript PASS efter authfix, bekräftat av koordinerande agent 13 oktober 2026. |
| PR #4: `node --test --test-isolation=none tests/*.test.mjs` | Historiskt PASS 107/107: 44 routing-/validerings-/demo-/import-/PDF-fall, 32 DocuSeal-fall, 12 företagskontextfall, 12 CRM-actionfall, två SSR-beloppsfall och fem authåterställningsfall. Provider-/authtransport och serverberoenden mockas där respektive svit kräver det. |
| PR #4: `npm test` | Historiskt PASS 11/11 filsviter efter authfix, via exakt package-script. Nodedefault rapporterar filsviter; de enskilda beteendena är 107 enligt kommandot ovan. |
| Företagskontext | Tolv permanenta regressioner i `tests/company-context.test.mjs` PASS efter gemensam verifierad session och hantering av stale cookie. |
| Lösenordsåterställning | PASS 5/5 i `tests/auth-recovery.test.mjs`, isolerat och i fullsviten: bekräftat villkorligt svar, SDK-fel, nätverksfel, klientinitialiseringsfel och ogiltig e-post. Auth-SDK är mockat; inga verkliga authmejl skickade. |
| PR #4: `npm run build` | Historiskt PASS efter authfix, inklusive TypeScript och 14 sidor/API/SSR/proxy med Next.js 16.4/Turbopack. Senaste `route.js.nft.json` innehåller `DejaVuSans.ttf`; fonttrace PASS. |
| SQL-regressioner | PASS 7/7 mot `buqdtssxrotkzndublrt` med rollback, inklusive CRM. Offertens simulerade legacyfall utelämnat live; hela offertsviten inklusive tolv källdatagränser PASS i isolerad PGlite. |
| Reservationskonkurrens/utgång | Lazy expiry applicerad; schema/testunderlag finns. Separata samtidiga anslutningar och bakgrundsscheduler är olika kontroller. |
| Lokal produktionsbrowser | Historiskt PASS 31/31 mot port 3010, noll POST-anrop och noll JavaScriptfel. Detta är lokal produktionskontroll, inte autentiserad produktions-CRUD. De senare belopps-/originfixarna har separata regressioner ovan. |
| Samlad browser/QA | Tidigare PASS 182/182 över utveckling, mockade UI-actions och lokal produktion. Mockad UI-harness bevisar användarbeteenden men ingen verklig produktionsmutation. |
| Riktad browserkontroll efter slutfixar | PASS 9/9 för berörda lager-/affärsvyer, kostnadsdialog och behovsladdad CRM vid 320/1280 px mot produktionsbygget på port 3011. Noll POST-anrop och JavaScriptfel. Historiska 182/182 räknas inte om som ny full körning. |
| Mobil och tillgänglighet | Lokala QA-kontroller av förbättrade mobilmenyer/åtkomst passerade; remote efterkontroll återstår. |
| Remote preview | `READY`-checkpoints `cf953d4`, `69ed849` och `aed26df`, rätt projekt/team och `arn1`. Skyddad fetch verifierar respektive demo/loginyta; ingen autentiserad remote CRUD eller PDF-CRUD verifierad. Senare pushar följs via PR/Vercelstatus. |
| Produktionsrelease/domäner | Historisk PR #4/main `db7143` och aktuell PR #5/main `7fc833f` har verifierade produktionsdeployments. Äldre www/login/apexbevis tillhör `dpl_8Z69...`; aktuell lagerdemo matchar exakt `dpl_6vce...`. |

Uppdatera detta protokoll med faktiskt kommando, miljö, resultat och begränsning. Räkna inte partnerfunktioner som verifierade genom mockade beslut eller genom att en intern intresseanmälan går att spara.

## Prioriterad fortsättning

1. Bevara historisk main-/produktionscheckpoint `db7143` och aktuell `7fc833f`; efterföljande main-pushar följs i Vercelstatus med respektive commit.
2. Komplettera remote auth-/PDF-kontroller och följ verifierade migrations-/schedulerresultat för etappen 15 oktober; tidigare migrationstal hör till respektive checkpoint.
3. Komplettera ännu ej verifierad autentiserad browser-CRUD för två syntetiska företag; reservationskodens riktiga samtidighetstester redovisas separat i etappen 15 oktober.
4. Följ upp advisory om läckta lösenord samt faktisk driftåtkomst för publikt intag och dokument.
5. Följ upp verifierad produktion i avsett projekt och dokumentera enbart bekräftade efterföljande artefakter/driftresultat.
6. Fortsätt fas 1–3:s återstående personal-/filial-, inköps-/bild-, CRM-/affärs- och inbytesarbete, därefter dokumentfasen och de partnerberoende faserna.

Ingen finanspartner, signeringstjänst, BankID-underskrift, bokföringsadapter eller fordonsdataadapter är aktiverad av dokumentationen eller den återhämtade bygggrunden.

Arbetsytans grundsnapshot begränsar fortsatt lager, kunder och affärer till de 500 senaste posterna per företag för kvarvarande konsumenter. Etappen 15 oktober ger huvudregistren och affärsväljarna egna fullständiga databasläsningar. Importens dubblettkontroll och dashboardens serveraggregat använde redan hela företagets data. Finanslistan och finansformulärets snapshoturval omfattas inte av registeretappen.

## Tillägg: privat offertarkiv och beständig signeringsgrund

Integrationsgrenen `feat/offer-signing-integration-20261013` utgår från PR #4, commit `4037761`. Den inför PR #3:s slutliga signeringsmoduler, commit `86bbce9`, i huvudappens `src/lib/signing/`, plus privat offertarkivering och autentiserad hämtning. Providerklient och workerdispatch förblir tvingat avstängda via applikationens server-wrapper.

Arkivering gäller befintliga oföränderliga offertversioner, `kind=other`, för owner/admin/finance. Servergenererade PDF-bytes återläses och hashkontrolleras före service-only registrering. Direkta användaranrop kan inte förfalska arkivregistreringen. En ny offert registreras högst en gång; historiska kvitton behåller första dokument, fil, aktör och begäransreferens. UI ignorerar sena svar efter företagsbyte och bevarar referensen vid retry. Downloadroute `/api/documents/[documentId]/pdf` verifierar faktisk filhash och privat bucket före och efter fil-I/O.

| Kontroll i denna integrationsgren | Resultat och gräns |
| --- | --- |
| `npm run typecheck` | PASS efter appintegrationen |
| `node --test --test-isolation=none tests/*.test.mjs` | PASS 137/137 beteenden, inklusive 15 arkiv-/server-action-/servicefall, 8 downloadfall och 6 browserfall. Provider och SDK-gränser är kontrollerade fixtures |
| `npm run test:signing` | PASS 106 fall i adapter/domän/store/worker/user/storage samt 8 flödesfall mot lokal PostgreSQL/PGlite. Delvis överlapp med huvudappens tester; summorna ska inte adderas som unika fall |
| `npm test --prefix tests/offer-archive-db` | PASS: hela huvudappens migrationsordning körs lokalt före arkivets SQL-rollbackassertioner med faktiska roller, RLS, grants, privata Storage-kataloger, oföränderlighet och service-only registrering |
| Chromium-komponentflöde | PASS 6/6 med verkliga DealOffers/DealerWorkspace, mockade serveråtgärder och blockerad HTTP. Next HTTP/RSC-transport och hosted CRUD ingår inte |
| `npm run build` | PASS för Next 16.4/Turbopack och Node 24, inklusive den nya dynamiska dokument-PDF-routen |

Nya migrationer är `20261013165650_signing_ledger.sql` och `20261013165726_offer_document_archive.sql`. De är lokala, CLI-namngivna additiva migrationer efter de åtta redan applicerade migrationerna. Hosted applicering har inte gjorts. Den äldre signing-ledgerfilen från PR #3 ska inte appliceras dessutom. Databastyperna från liveprojektet bevaras; ett lokalt RPC-overlay beskriver arkivmigrationen.

`SUPABASE_SECRET_KEY` eller äldre `SUPABASE_SERVICE_ROLE_KEY` behöver konfigureras enbart på servern för ny arkivregistrering. Saknad konfiguration stoppar före render/upload. Verklig lagrings-CRUD, godkänt köpeavtalsunderlag, faktiska providermallar, signeringsroutes/webhookdrift och användarens produktionsflöde återstår. Detta tillägg är kod och lokala verifieringar; det ersätter inte PR #4:s tidigare preview eller någon produktionsdeployment. [OFFER_DOCUMENT_ARCHIVE](OFFER_DOCUMENT_ARCHIVE.md) anger RPC- och driftkontraktet.

## Tvåpartssignering och transaktionsmejl — 2026-10-14

Native signeringssessioner kopplar två olika aktuellt godkända/verifierade Auth-konton till samma immutable avtalsinnehåll. Kunden behöver inget företagsmedlemskap; bolaget signeras av aktuell owner/admin, finance läser. Kundens `/my-contracts` visar läsbara villkor och separat slutbekräftelse. Signerad PDF och JSON-bevis är privata och kräver två kvitton; full source/account/tenantkontroll upprepas efter rendering. Enkel elektronisk underskrift, utan BankID eller certifikatbaserad PDF-signatur. Originalfilsarkiv återstår.

Sex affärsmejlmallar och privat durable outbox: ansökningsbekräftelse, adminnotis, kontogodkännande, avtalsinbjudan och slutfört avtal till kund respektive bolagssignerare. Serverhändelser kan skicka när transporten är aktiverad. Superadmin visar konfigurationsstatus/kötal och kan explicit skicka nästa väntande mejl. Ingen schemalagd mejldispatch. Accepted är leverantörens accept, inte inkorgsleverans; leveranswebhooks återstår.

Verifiering: full appkörning **539/539**, därefter **22/22** slutliga berörda fall inklusive **två nya** dispatch-/mottagarbindningstest; totalt **541 unika verifierade appfall**, inte en separat full 541-körning. Databaskörning **39/39** grupper, dessutom **1/1** ny faktisk hosted-basis rollbackgrupp; totalt 40 verifierade databasgrupper. Produktionsbygge, TypeScript och diffkontroll passerar. Ny faktisk PG-signering inkluderar serverrenderad signerad PDF och verifierad filhash.

Nio nya små migrationer är hosted-applicerade; live readback visar **58** migrationsrader. Rollbacktestet genomförde verklig offertpublicering/kundaccept, mallgodkännande, avtalsutkast, begäran, två underskrifter, exakta återförsök, innehållshash och tre avtalsmejl i kö. Efter ROLLBACK är alla 13 kontrollerade testaggregat noll. Inga providerutskick gjordes.

Användaren bekräftade att ingen mejlleverantör är konfigurerad. Resend-domänen trafexa.com är skapad eu-west-1 med TLS och avstängd spårning, men väntar på DNS-verifiering. Produktnyckel/serverkonfiguration och separat Supabase Auth SMTP återstår. Utskicken är avstängda tills konfigurationen är färdig. Exakta offentliga DNS-poster finns i TRANSACTIONAL_EMAIL_SETUP.md. Faktisk leverans och hela återställningsflödet är ännu inte verifierade.

## Annonsstatistik och antalunderlag — 2026-10-14

Debiteringsmodellen är en unik verifierad Trafexa-annons per kanal. Nya versioner, återförsök och byte av externt ID ger ingen extra enhet. Ett privat oföränderligt register och externa ID-bindningar förhindrar dubbelräkning; kollision med annan annons stoppar publiceringsresultatet atomärt. Äldre publicerade annonser bevaras i en faktisk, odaterad baslinje och debiteras inte igen. Databasändringen låser jobben under baslinje/trigger-installation för att undvika tappade publiceringsresultat.

Kalendermånader använder Europe/Stockholm med sommartid. Företagets owner/admin/finance kan läsa månadsunderlag; faktisk UUID-superadmin väljer företag utan medlemskap och kan läsa historik för suspenderat företag. Privat CSV återläser exakt källa och aktuell behörighet. Månadens unika enheter är separata från aktuella jobbstatusar över hela historiken. Priser och belopp är osatta/null; ingen faktura utfärdas.

Verifiering: **556/556** appfall i samlad körning; **29/29** databasgrupper, inklusive sju nya statistik-/dedup-/legacy-/sommartids-/superadmingrupper samt befintlig annonsering och plattformsbehörighet. Produktionsbygge, TypeScript och diffkontroll passerar. Två nya migrationer är hosted-applicerade, totalt **60**. Livekontrollen hade inga befintliga publicerade jobb eller motstridiga externa ID-bindningar. Rollbackprovet använde verkliga claim/save-RPC:er med simulerat partnerbesked och verifierade att inskickat inte räknas, publicerat räknas en gång och terminalt återförsök inte dubblerar. Superadminens antalunderlag och osatta belopp verifierades. Efter ROLLBACK är alla sju kontrollerade testaggregat noll. Inga externa annonser eller mejl skickades.

Säkerhetsadvisorn visar avsiktligt privata RLS-tabeller utan klientpolicyer. Två redan befintliga varningar gäller Auths läckta-lösenordsskydd samt det separata publika mejlstatus-RPC:t, vars aktuella UUID-superadmin-gräns är explicit kontrollerad. De nya annonsunderlags-RPC:erna är invokerwrappers över privata behörighetskontrollerade hjälpfunktioner. Se [RPC-advisorns förklaring](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable).

Blocket/Wayke, bankintegrationer och workers förblir inaktiva. Nästa faktureringsarbete behöver fastställda kanalpriser, versionsbundet prisavtal, periodstängning och radvis avstämning före faktisk fakturautställning. Aktuella API-/bankberoenden finns i ADVERTISING_INTEGRATIONS.md och BANK_PARTNER_REQUIREMENTS.md. Senaste mejldomänkontroll: delvis verifierad, DKIM och CNAME godkända; MX/TXT för send väntar fortfarande. Ingen leveransaktivering ingår här.

Hosted kontroll 2026-10-15: samtliga sex nya annonsprismigrationer tillämpade och filversionerna synkroniserade med hostedhistoriken. 67 migrationer observerades totalt, inklusive en redan befintlig separat reservation_expiry_scheduler som inte ändrats i denna leverans. Syntetiskt rollbackprov passerade framtida priser, bevarat historiskt okänt pris, granskad nollprissättning, exakt återförsök, stora belopp, företags-/adminläsning och nekad låsning av aktuell månad. Separat efterkontroll gav noll i samtliga tio testdataaggregat. Positiv låsning av avslutad månad verifierades lokalt. Security advisors visade inga nya varningskategorier; privata RLS-tabeller har avsiktligt inga direktpolicyer. Main och produktionsdeploy återstår vid denna checkpoint.
