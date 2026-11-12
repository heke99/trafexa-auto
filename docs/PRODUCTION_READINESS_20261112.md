# Produktionsåtgärder och kvarstående verifieringsgränser – 12 november 2026

## Release verdict

**RED för ett fullständigt produktionsgodkännande:** de riktiga inloggade konto-/avtalsresorna och extern driftbackup kan inte verifieras med nu tillgänglig åtkomst. Detta betyder inte att dessa resor har påvisats trasiga. Kodrättningar och avgränsade driftändringar genomförs separat, med kontroller nedan. Blocket/Wayke och bank är fortsatt externa gränser; ingen partnerpublicering eller banköverföring har utförts.

## Bas och publicerad rättning

Repository `heke99/trafexa-auto`. PR #61 är squashad till main `8c3c1a6d1674952d7dce783b4b83f54751446e40`. Den tidigare körningens **1 999/1 999** avser just PR #61 och återanvänds inte som testresultat för följande ändringar.

PR #61:s produktion byggdes om med den nya händelsemejlflaggan: `dpl_7FjMFSAmb9E3MwL6GRkbKoBRTuC8`, READY och kopplad till Trafexas produktionsdomäner. Produktions-GET bekräftar login, glömt lösenord, skyddad admin-djuplänk och att register går till ansökan. Detta är server-GET genom Vercelverktyget, inte inloggad browser-E2E. Fel-/fatal-loggfiltret gav inga poster vid kontrollen.

## Händelsemejl och ansökningsnotiser

- `TRANSACTIONAL_EMAIL_ENABLED=true` har lagts i produktion. Konfigurationen gäller nya beständigt sparade händelser; kön har inget automatiskt schemalagt tömningsjobb.
- Kontoinbjudningar har ett separat flöde. Den nya flaggan ska inte beskrivas som att den ensam aktiverar kontoinbjudningar.
- Användaren valde **info@trafexa.com** för nya ansökningsnotiser. Ny hook skapar en gemensam företagsnotis, oberoende av superadminens inloggningsadress, och kontrollen kräver fortfarande giltig källa och minst en aktiv verifierad godkänd superadmin.
- Migration `20261112215300_application_shared_mailbox.sql` är applicerad. Hosted efterläsning verifierar rätt mottagarlogik och att det befintliga superadminkontot bevarats. Två äldre pending-händelser har lämnats orörda; ingen historisk kö skickades blint.
- Riktade lokala SQL-prov: ny mailbox **3/3 PASS**, befintlig outbox **5/5 PASS**. Korrekt adress/deduplicering, nekad köåtkomst, source-erasure och återkallad adminbehörighet under pågående lease kontrollerades.
- Sändardomänen är verifierad i Resend, sändning aktiv och klick-/öppningsspårning avstängd. Ingen suppression fanns för den valda företagsmottagaren. Detta bevisar inte en mottagen ansökningsnotis efter verklig webbansökan.

## Avtal, behörighet och det begärda PDF-provet

Användaren hittade inte avtalsutskicket och bad om ett skapat/skickat prov. Hosted efterläsning visade att superadmin saknar företagsmedlemskap. Ett separat, redan befintligt testmottagarkonto är verifierat/godkänt och har aktiv owner/admin-behörighet. Inget konto, lösenord eller medlemskap ändrades.

En signerbar inbjudan kräver rätt företagsroll, godkänd mall, en faktiskt kundaccepterad offert och serverns ordinarie krypterade utskicksflöde. Ingen acceptans, underskrift, JWT eller krypterad kökropp fabricerades. Den kontrollerade körmiljön blockerar direkt produktionsbrowser/POST; Vercelverktyget stöder GET, men ger ingen inloggad handlaridentitet. Denna gräns kan inte lösas genom att enbart anropa SQL och skicka en egen länk.

På användarens uttryckliga begäran skickades därför ett **osignerat tekniskt PDF-prov utan signeringslänk** till den tidigare godkända testmottagaren. Ordinarie PDF-renderare användes på tydligt fiktivt underlag, märkt TEST / OSIGNERAT / EJ BINDANDE; inga produktionsavtalsrader skapades. Bilagan: 15 443 byte, två sidor, SHA-256 `db3baec43f530fe0bc524900dfccb0924a147d01550c3952ff86396dda773af2`. Mejl-ID `01a1d1c7-4911-7393-a8ce-a3a9547ab400`; leverantören bekräftar `sent`, inte mottagarens inkorg eller genomförd signering. Utskicket gick genom Resendplugin, inte genom appens avtalsåtgärd, och räknas därför inte som godkänd produktionssignering.

Avtalsingången i handlarvyn heter nu **Avtal och underskrifter**. Superadmin får vägvisning med korrekt rollförklaring. För utkast krävs owner/admin/finance; för att begära underskrifter krävs owner/admin. Full väg: företagsinställningar → godkänn avtalsmall; Affärer → kundaccepterad offert → Avtal och underskrifter → skapa osignerat utkast → Visa och hantera underskrifter → Begär underskrifter för avtalsutkastet.

## Backup och säkerhetsuppdatering

[Backupberedskap och återställningsbevis](CONTRACT_BACKUP_READINESS_20261112.md): verklig lokal arkivexport → separat betrodd hash → befintlig offline-CLI utan servermiljö → återställda byte/hashar och privata filrättigheter. **23/23** prov samt tre ordinarie avtals-/leveransresor PASS. Användaren har bekräftat att separat backupdestination ännu inte är vald. Ingen extern driftbackup eller DB-backup utanför plattformen påstås vara aktiverad.

Zod är uppdaterad från 4.1.12 till exakt 4.6.7. Paketgranskningen efter uppdateringen gav **0 kända sårbarheter**. Hosted Supabase-advisorn hade före ändringarna två WARN-kategorier: avsiktligt adminskyddad SECURITY DEFINER-RPC samt avstängd läckt-lösenordskontroll. Den senare Auth-inställningen kan inte ändras via tillgängliga kopplingar. Privata tabeller med RLS utan direkta policies är stängda och används genom bevakade funktioner; direktåtkomst ska inte öppnas för att tysta denna information.

Cookieinformationen har en separat revision `2026-11-12` och beskriver annonsprogrammets nödvändiga sessionStorage, som endast innehåller begärande-/målmetadata. Integritetspolicyns ansökningsversion hålls stabil så att befintliga formulär och sparade medgivanden inte omtolkas. Policyprov **2/2**, cookiebrowser **3/3**, befintlig avtals-UI **10/10 PASS** före slutlig samlad regression.

## Annonsprogram, slutkontroller och ny publicering

F01–F03 är rättade med kontrollerade formulär, fältfel/fokus, bevarad inmatning, spärr under sparning och ett beständigt actor-/request-bundet kvitto. Vid okänt svar kan samma begäran lösas även efter reload; ett uttryckligt not_saved-kvitto hindrar en försenad originalskrivning. Endast opak målmetadata lagras i sessionStorage. Riktat: sju migrerade SQL/actionfall, åtta browserfall vid 320/1440 px samt fyra riktiga PostgreSQL-tvåsessionersprov PASS.

F06 är rättad: explicit butik och avtalsrevision binds till accepterad offert, jobb och unik publiceringsavgift. Bytbilpriser används inte som Waykepriser. Fasta avgifter är egna granskade rader genom moms, PDF, betalningssaldo och helkredit. Oklara eller förändrade programperioder stoppar låsning tills ett nytt uttryckligt avgiftsbeslut har granskats; prisbyte och bortfallen avtalsmånad hanteras med aktuellt kandidattoken och spårbart manuellt beslut, inte med en uppfunnen automatisk fördelning. Historiska original/priser skrivs inte om.

Riktade prisprov: sex SQL, sex actions/SQL-kedjor, tio legacyprisfall och 15 browserfall PASS. Avgiftsprov: sju SQL, elva parser/typfall och 15 UI-fall PASS, samt 34 historiska SQL-fall. Tre ytterligare riktiga PostgreSQL-tvåsessionersprov visar låsordning för legacy-prisändring/quote och avgiftsgranskning/periodlås. Nativecontainern saknar nätverk och publicerade portar; samtliga data är lokala syntetiska fixturer. Se bevis under [verification/20261112-readiness](verification/20261112-readiness/).

Applicerade migrationsversioner: `20261112215300_application_shared_mailbox`, `20261112220752_advertising_program_requests`, `20261112220925_advertising_program_publication_prices`, `20261112220940_advertising_store_fee_rows`. Repositoryfilernas namn har anpassats till dessa faktiskt tilldelade versioner; hosted historik har inte skrivits om. Backend och frontend levereras tillsammans. Ingen butik, avgift, pris eller partneranslutning skapades i produktion av migrationerna.

Arbetsmiljön startades om under den första slutkörningen. Den avbrutna delkörningen räknas inte som ett godkänt resultat; full regression startades om efter att miljön var klar. Slutlig samlad regression och release kompletteras nedan.

## Återstående användarberoenden

1. Verklig kontoinbjudan/aktivering, glömt lösenord och kontraktslänk behöver öppnas i en legitim produktionssession och mottagen inkorg. Testmottagarkontot har nödvändiga handlarbehörigheter; användaren har fått denna väg. Inga lösenord efterfrågas i chatten.
2. Separat backupdestination och driftval (ägare, åtkomst, intervall, retention, RPO/RTO och DB-återställning) är fortfarande inte valda.
3. Auth-leverantörens läckt-lösenordskontroll behöver aktiveras via dess ordinarie inställningar och verklig SMTP-/Auth-konfiguration bekräftas; ingen sådan aktivering har påståtts.
4. Partnerkontrakt och riktiga externa kopplingar ligger utanför dessa bevis. Manuella betalningsavstämningar kan användas utan att påstå bankintegration.
