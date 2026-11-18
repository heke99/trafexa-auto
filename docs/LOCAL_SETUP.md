# Isolerad lokal start

Använd Node 24, Docker och låsfilen. `scripts/local-supabase.mjs` låser Supabase CLI till 3.2.0 och tillåter inte `--remote`, `--linked`, `link` eller `push`. Ingen länkning till ett hosted projekt behövs. Docker måste kunna hämta Supabases officiella bilder; CLI kan använda GHCR när ECR inte är tillgängligt.

```sh
npm ci --ignore-scripts
npm run test:setup
npm run local:start
npm run local:bootstrap
npm run local:verify
npm run dev
```

`local:status` visar endast lokala adresser, inga nycklar. `local:start` kör riktiga Auth, PostgREST, Storage, PostgreSQL och pg_cron från `supabase/config.toml` och alla migrationer. Registrering är stängd. Authmejl stannar i lokal Mailpit på `http://127.0.0.1:54324`; serverflaggor för Resend, fakturamejl och Blocket är avstängda. Företag och verkliga mottagare följer inte med seed-filen.

`local:bootstrap` accepterar bara API på loopback:54321 och databaskontainern `supabase_db_trafexa-local`. Det skapar ett syntetiskt Auth-konto genom det lokala Admin-API:t, bekräftar adressen, registrerar privat kontogodkännande och en bootstrapreservation och aktiverar exakt samma verifierade UUID genom den vanliga RPC:n. Adressen är `starter-admin@example.invalid`, lösenordet för denna offentliga lokala fixtur är `Local-Trafexa-Fixture-Only-2026!`. Använd aldrig denna identitet eller detta lösenord i en hosted miljö.

Kommandot skriver `.env.local` med lokala nycklar och separata slumpmässiga PDF-länkhemligheter endast om filen saknas; befintlig fil bevaras. Nycklar skrivs inte till loggen. Öppna `http://localhost:3000/login`, logga in med fixturen och kontrollera `/admin`. För nya syntetiska handlare används webbansökan och superadminflödet; öppna inte vanlig registrering.

`local:verify` är skrivskyddat: Auths hälsosvar, versionsbundna obligatoriska RPC-namn i den migrerade databasen, privata Storage-bucketar och det faktiska reservationsschemat kontrolleras. Det skapar inga konton, dokument eller mejl. En sådan lokal kontroll bevisar inte att en hosted miljö har samma migrationer, SMTP, provideravtal eller filer. Skyddad hosted kontroll måste köras av driftansvarig i den uttryckligen avsedda miljön, utan att exponera servernycklar som en publik hälsorutt.

```sh
npm run db:types
npm run db:types:check
npm run local:stop
```

Typer genereras från den lokala fullmigrerade databasen. Den granskade adaptern för RPC-nullbarhet i `database.types.ts` bevaras. Granska diffen och kör TypeScript; en typändring ersätter inte serverns validering eller behörighetskontroller. Det manuella CI-jobbet `verify_clean_stack` kontrollerar att en ny ren stack ger exakt samma typer. Den centrala typfilen har genererats från en isolerad PostgreSQL 17-databas med aktuella migrationer. En verifierad ren start av hela Supabase-stacken krävs innan det manuella CI-jobbet görs obligatoriskt. `local:reset` raderar endast den lokala stackens data och återspelar migrationer/seed; kör bootstrap igen efteråt. Stoppa aldrig andra testkontainrar manuellt som en del av detta flöde.

## Driftmål och hemligheter

`.env.example` innehåller bara lokala ursprung och inga hosted projekt- eller nyckelvärden. `NEXT_PUBLIC_TRAFEXA_DEPLOYMENT_TARGET=local` är standard. Ett lokalt `npm run build && npm start` använder fortfarande explicit `NEXT_PUBLIC_APP_URL=http://localhost:3000`. `NODE_ENV=production` väljer inte driftmål. Riktig Vercel Production, eller uttryckligt `NEXT_PUBLIC_TRAFEXA_DEPLOYMENT_TARGET=production`, låser Auth till Trafexas produktionsursprung. Den kända produktionsdatabasen kräver detta uttryckliga val före klient-I/O. En servernyckel får aldrig heta `NEXT_PUBLIC_…`.

`CONTRACT_EMAIL_ENABLED=false` är separat från vanliga transaktionsmejl. `UPLOADED_PDF_LINK_SECRET` ska vara en stabil, separat serverhemlighet per miljö (`openssl rand -hex 32`). Befintliga PDF-länkar kan vara bundna till den tidigare tjänstenyckeln: inventera och verifiera sparade länkar före ändrad hemlighet; att ändra nyckeln återsignerar inte gamla länkar. Låt inte en ny installation återanvända produktionsnycklar. Kontoinbjudningars krypteringsnycklar och rotation dokumenteras separat i transaktionsmejlguiden.

## Testprofiler och CI

`npm run test:setup` installerar varje versionslåst testpaket under tests, inklusive äldre signeringsprov; det räcker inte att installera bara de två vanligaste PGlite-fixturerna. `npm test` kör flat-sviten med browserprov. `npm run test:database` kör underkatalogernas PGlite-/domänprov. `npm run test:native` skapar och städar egna isolerade PostgreSQL-kontainrar för underkatalogernas nativeprov och vägrar återanvända en redan existerande namngiven container. `npm run test:matrix` listar `.test.mjs`, filer som importerar node:test och äldre körbara schema/cross-layer/native-entrypoints med faktisk grupp och kommando. Statiska och dynamiska importer följs för att hitta Dockerkrävande hjälpare och exakta containeröverskrivningar. Hjälp-/fixturefiler körs inte som tomma testfall. `tests/signing-flow/verify-all.mjs` är en separat orkestrator (`npm run test:signing`) som avsiktligt inte körs en gång till av matrisen; dess underliggande testfiler finns redan i grupperna. Enstaka nativeprov körs via exempelvis `npm run test:native -- tests/paper-sales-db/native-concurrency.mjs`.

I `tests/crm-db/helpers.mjs` finns uttryckliga profiler:

- `migrations`: bara migrationskedjan, ingen godkännandetrigger eller extra dokumentgrant från fixturen.
- `established`: redan godkända testkonton och testets explicita tjänsterollsgrant.
- `historical`: kräver ett namngivet `throughMigration`-stopp; använd detta för äldre driftscheckpoints.
- `legacy`: kompatibilitetsstandard för befintliga domänsviter; gamla `approveEstablishedFixtures`-argument bevaras. `includeSigningArchive:false` representerar inte ett historiskt schema och accepteras endast som äldre kompatibilitet, inte som bevis på frånvarande arkiv.

PGlite och de vanliga PostgreSQL-fixturerna är inga ersättningar för lokal Supabase: de stubbar Auth/Storage och kan inte verifiera pg_cron-installationen. CI:s separata rena Supabase-jobb använder riktiga tjänster. Testernas offertdatum hämtas från samma Stockholm-datum som databasen, med regression vid svensk midnatt.

### Kontoinbjudningars nyckelrotation

`ACCOUNT_INVITATION_ACTIVE_KEY_ID` väljer en post i den serverhemliga JSON-mappen `ACCOUNT_INVITATION_ENCRYPTION_KEYS`. Varje värde är 32 slumpmässiga bytes i base64url (`node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"`). Använd egna värden per miljö och lägg aldrig verkliga nycklar i Git eller chatten. Behåll tidigare key-id-värden tills deras sparade utskick är avvecklade. `ACCOUNT_INVITATION_LEGACY_SECRETS` är en explicit JSON-lista över gamla v1-hemligheter för återhämtning av redan krypterade payloads; normal nykryptering använder keyringen. Saknad aktuell nyckel ska stoppa före verkligt utskick. En roterad Supabase-nyckel är inte en automatisk ersättning för en äldre payloads krypteringsnyckel.

## Verifieringsstatus 17 november 2026

Konfiguration, bootstrap och skrivskyddad readiness är versionerade, men en full ren Supabase-start hann inte verifieras i granskningsmiljön: bildhämtning från ECR nekades, GHCR-fallback nådde därefter ett diskutrymmesfel. Inga hostedmiljöer berördes. Kontroller av rena Auth-/Storage-/pg_cron-tjänster och aktuell officiell typgenerering ska därför fortfarande köras i den isolerade CI-miljön innan detta startflöde redovisas som godkänt. Den centrala typfilen är inte manuellt utfylld som ersättning för generering. Lokala CLI-kommandon får inte ändras till `--remote` för att kringgå detta.


## Skrivskyddad kontroll före publicering

Driftansvarig kan köra `npm run verify:reviewed-environment` med installerad `psql`, `TRAFEXA_READINESS_TARGET_URL` satt till exakt samma URL som `NEXT_PUBLIC_SUPABASE_URL`, servernyckel och en separat `TRAFEXA_READINESS_DATABASE_URL` för den granskade miljön. Kända Trafexa-produktionen kräver dessutom det uttryckliga produktionsmålet; inga skript väljer den automatiskt. Databaskommandot använder både en skrivskyddad transaktion och `default_transaction_read_only=on`, läser endast kontrakts-/schemakatalogen och loggar inte anslutningssträngar eller nycklar. SQL finns i `supabase/verification/runtime-contracts.sql` för operatörsgranskning. Kontrollen skapar inga användare, filer eller utskick och publicerar ingenting.

Detta operatörsprov är förberett men har inte körts mot produktion under granskningen. Ett vanligt HTTP 200 från inloggningssidan ersätter det inte. Saknade migrationskontrakt eller ett Auth-/Storage-avbrott ska blockera publicering tills driftansvarig har åtgärdat beroendet.
