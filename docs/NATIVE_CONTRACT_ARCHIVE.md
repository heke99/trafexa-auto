# Privat originalarkiv för native avtal

Etappen 15 oktober 2026 fortsätter från main `4fd3c5d`/PR #23 på `codex/trafexa-contract-archive-20261015`. PR #24:s main `a6a6c972` är integrerad och samlad helsvit 759/759 samt produktionsbygge passerar; implementation och riktade kontroller är klara; migration `20261015100653_native_contract_archive` är applicerad. Ny arkivering är fortsatt spärrad av saknad serverkonfiguration. Samlad test-/byggverifiering och publicering följs separat i [IMPLEMENTATION_STATUS](IMPLEMENTATION_STATUS.md).

## Aktuell fortsättning 18 oktober 2026

[Kontroll av arkiverade avtalsoriginal](CONTRACT_ARCHIVE_INTEGRITY.md) lägger en uttrycklig kontroll av de faktiska filerna i den befintliga panelen. Kontrollen använder samma privata läsbehörigheter och behöver ingen registreringsnyckel. Nedanstående serverkonfigurationsuppgifter är historiska från den första arkivleveransen; senaste produktionsmetadata inför PR #52 visar att `SUPABASE_SECRET_KEY` finns. Ett autentiserat hosted Storage-/backup-/återställningsprov är fortfarande separat från syntetiska tester.

[Arkivpaket och isolerat återställningsprov](CONTRACT_ARCHIVE_BACKUP.md) kan exportera befintliga verifierade original för separat förvaring. Extern lagringsleverantör är inte vald, och ingen automatisk backup aktiveras.

## Original och genererad kopia

Ett färdigsignerat native avtal får högst ett privat arkiv med ett sammanhörande originalpar: den signerade PDF-filen och dess JSON-signeringsevidens. Arkivering kräver en uttrycklig åtgärd av aktuell godkänd ägare eller administratör. Att slutföra signeringen eller öppna en nedladdningslänk laddar inte automatiskt upp filer.

Före arkivering genererar de befintliga GET-rutterna en kopia från den oföränderliga signeringsliggaren, först efter verifierad avsaknad av arkiv. Efter registrering återger samma rutter de sparade originalbytesen. Filnamnet anger `genererad-kopia` respektive `original`. En saknad, skadad eller felbunden originalfil ger fel och ersätts aldrig av en ny rendering under samma arkividentitet. Båda filerna hämtas och verifieras även när användaren bara begär den ena.

Arkivet gäller native tvåpartssignering enligt [CONTRACT_SIGNING_CONTRACT](CONTRACT_SIGNING_CONTRACT.md). Offertarkivet och den äldre avstängda provider-/prototypliggaren ändras inte av denna etapp. Ingen partner, mejlleverantör eller extern signingprovider aktiveras.

## Lagring och bindning

Migrationen skapar privata tabeller `private.contract_signing_archives` och `private.contract_archive_requests` samt den privata bucketen `native-contract-originals`. Metadata och begäranskvitton har förbud mot UPDATE/DELETE. Ett arkiv är unikt per signering och den första registreringen vinner; ett konkurrerande eller återförsökt underlag får inte skriva över originalparet.

Arkivet binds till exakt företag, affär, avtalsutkast, komplett kanoniskt innehåll och signeringsrevision **3**, renderer **`trafexa-native-v1`** samt evidensschema **1**. PDF och JSON har var sin verifierad SHA-256 och byte-storlek. PDF är högst 50 MiB och evidens högst 1 MiB. Bucketens tillåtna MIME-typer är `application/pdf` och `application/json`; objektvägarna är innehållsbundna:

```text
companyId/native-contracts/signingId/v1/signed-PDF_SHA256.pdf
companyId/native-contracts/signingId/v1/evidence-EVIDENCE_SHA256.json
```

Innehållskontrollsumman avser det signerade kanoniska underlaget. PDF-kontrollsumman avser de faktiska PDF-bytesen; evidensens `signedPdfSha256` binder den till just denna PDF. JSON-filen har dessutom en egen filhash. Servern renderar paret tillsammans och verifierar källa, signaturer, revisioner, exakta hashvärden och storlekar.

## Registrering och läsbehörighet

`archiveContractAction` i `src/lib/data/contract-archive-actions.ts` använder `archiveNativeContract` i `src/lib/documents/native-contract-archive.ts`. Webbläsaren skickar endast `companyId`, `signingId` och ett stabilt `requestId`. Aktuellt konto, företag, ägare-/administratörsroll och färdig signering verifieras före arbetet och på nytt under flödet.

Uppladdning görs med den autentiserade användarens verifierade session, utan overwrite, till den privata bucketen. Servern hämtar sedan de faktiska bytesen och verifierar båda originalen. Först därefter anropas `register_contract_signing_archive` genom den separata betrodda servergränsen, som bara `service_role` får exekvera. SQL kontrollerar källa, aktuell användarbehörighet, privat bucket och Storage-katalogens MIME/storlek. Katalogkontrollen bevisar inte filinnehållet; det gör serverns faktiska byte-återhämtning och SHA-256-kontroll.

`get_contract_signing_archive` använder aktuell autentiserad åtkomst och returnerar ett arkiv eller verifierat `null`. Ägare, administratör och ekonomiansvarig kan läsa inom företagets gräns. Kunden läser genom avtalets befintliga kundgräns med verifierad e-post och godkänt konto, utan krav på företagsmedlemskap. Finance och kunden kan inte initiera arkivering. Sales/viewer får ingen utökad åtkomst. En ännu behörig ägare/administratör kan läsa sina egna oregistrerade uppladdningar för återförsök; finance/kunden kan inte läsa sådana orphans.

De befintliga rutterna `/api/contract-signings/[id]/pdf` och `/api/contract-signings/[id]/evidence` kontrollerar behörighet, källa och arkivmetadata före och efter hämtning och verifierar båda filernas hash/storlek och parbindning. De använder den autentiserade klienten, privata/no-store-svar och ingen registreringsnyckel för läsåtkomst. Okänt utfall eller ett arkivläsfel får inte bli bekräftad arkivering eller en genererad ersättningskopia.

## Serverkonfiguration i Vercel

Produktionsmetadata lästes med `decrypt:false`: endast fyra `NEXT_PUBLIC_*`-variabler finns, utan `SUPABASE_SECRET_KEY` eller `SUPABASE_SERVICE_ROLE_KEY`. Inga hemliga värden hämtades. Ny arkivering returnerar därför `configuration_missing` före rendering/uppladdning och visar **”Originalarkivet är inte aktiverat. Kontakta Trafexa.”** Befintlig signering, genererade kopior och behörig läsning av redan registrerade original kräver inte denna registreringsnyckel.

Driftägaren konfigurerar nyckeln direkt i den betrodda tjänstens gränssnitt:

1. Öppna Trafexa Auto-projektets **Settings → Environment Variables** i Vercel och välj avsedd driftmiljö.
2. Lägg till endast servervariabeln `SUPABASE_SECRET_KEY` med rätt projekts servernyckel direkt i Vercel. Använd aldrig ett `NEXT_PUBLIC_`-namn. Spara inte värdet i kod, dokument, loggar eller chatten.
3. Publicera om avsedd deployment så att den får konfigurationen. Uppladdning sker först efter ägarens eller administratörens uttryckliga arkivåtgärd.
4. Verifiera ett avgränsat färdigsignerat testavtal: rätt roller/företag, båda uppladdade original, registrering och återhämtning av exakt samma par. Pröva nekad åtkomst och ett skadat/saknat original i avsedd testmiljö.

Ingen nyckel konfigurerades i denna etapp och ingen hosted Storage-API-rundresa är verifierad. Hosted SQL-rollback och lokala Storage-katalog-/transportmodeller ersätter inte detta driftprov.

## Avstämning och bevarande

Ett uppladdat objekt kan bli privat orphan om metadataregistreringen nekas eller utfallet blir okänt. Ett fel mellan PDF- och evidensuppladdning kan också lämna ett ofullständigt par. Bevara begärans- och objektreferenser för avstämning och återförsök med samma begäran. Ett timeout-svar bevisar inte att registreringen misslyckades. Första registrerade originalparet återanvänds efter aktuell behörighets- och bytekontroll.

Avstämning ska jämföra registrerade arkivpar med båda lagringsobjekten, faktisk SHA-256/storlek och aktuell signeringsbindning. Bekräftade original får inte skrivas över. Gör ingen blind radering utifrån en fillista, ett timeout-svar eller en utgången nedladdningslänk. Etappen innehåller ingen automatisk DELETE/städning; autentiserade användares UPDATE/DELETE av originalbucketen är uttryckligen spärrade.

Detta är ett privat originalarkiv, inte WORM-lagring, en garanterad permanent bevarandetid eller ett certifikatbaserat PDF-sigill. Långtidsbevarande, ansvarig driftägare, separat backup av Storage-filer, återställningsprov och återkommande integritetskontroll behöver ett eget driftbeslut. Databasbackupen omfattar inte Storage-filerna.

Efter nedladdning kan operatören exempelvis köra `sha256sum signerad.pdf signeringsbevis.json` på de lokala filerna och jämföra båda resultaten med betrodda registrerade arkivhashar. JSON-evidensens PDF-hash ska avse just den nedladdade PDF-filen. En kontrollsumma visar byteintegritet; den ersätter inte kontroll av behörighet, signeringskälla eller backup/återställning.

## Verifieringsgräns

Hosted migration och `supabase/tests/native_contract_archive.sql` passerar med noll kvarvarande fixtureanvändare, företag, signeringar, arkivrader eller originalobjekt. Lokala PostgreSQL 17.6-prov omfattar faktisk tvåpartssignering, konkurrerande första registrering, båda ordningarna mellan uppladdning/registrering, återkallad behörighet efter lås och återförsök utan deadlock. Där används en uttrycklig Auth-/Storage-katalogmodell, utan hosted filbytes. Riktade core-, transport-, action-, PDF-, GET-, integrations- och Chromiumkontroller är verifierade separat; faktiska antal och samlad körning finns i statusprotokollet. Ingen produktionspublicering eller full autentiserad Storage-API-verifiering påstås av dessa prov.
