# Trafexa Dealer avtalsintegration

Denna leverans förbereder byggplanens fas 4 med ett serverbibliotek för DocuSeal och en ren domänmodell för signeringsuppdrag. Koden kan föras in i den befintliga Next.js-appen utan sourcing-tabellerna i PR #2. Den skickar inga verkliga uppdrag under testerna och ändrar ingen live databas.

## Befintlig plattform som integrationen ska använda

Supabase **Trafexa dealer**, projekt `buqdtssxrotkzndublrt`, har redan `companies`, `memberships`, `deals` och `documents`. Aktiva företag och medlemskap skyddas med RLS. Rollerna är `owner`, `admin`, `sales`, `finance`, `viewer`.

`documents` innehåller ID, företag, eventuell affär, namn, objektväg, dokumenttyp och tidsstämpel. Objektvägen börjar med företagets UUID. Dokumentinsert kräver `owner/admin/sales`. Tabellen saknar signeringsstatus, mallversion, checksumma och providerbindning. `deals.status` tillåter endast `draft/reserved/cancelled` i den verifierade grunden.

Använd dessa befintliga företag och behörigheter. Skriv inte `signed` till befintliga dokument eller affärer. Beständig signeringsdata behöver ett separat, granskat migrationskontrakt innan funktionen aktiveras i appen.

## Kodens ansvar

| Modul | Ansvar |
| --- | --- |
| `src/lib/documents/docuseal.ts` | Skapa submission från en befintlig mall, läsa providerstatus och verifiera/parsa signerade webhookar |
| `src/lib/documents/signing-state.ts` | Validera låst jobbsnapshot, dispatchutfall, providerbindningar och tillåtna domänövergångar |
| Main-appens kommande integration | Autentisering, RLS, persistent ledger/inbox, transaktioner, privata filer, HTTP-routes, UI och aktivering |

Modulerna skriver ingen databas eller appstatus. Importera dem bara från serverroutes eller workers. En Next.js-wrapper ska också använda `import 'server-only'` för att skydda gränsen vid bundling. Providerhemligheter får inte använda `NEXT_PUBLIC_`.

## Providertransport

`createDocuSealClient` behöver en betrodd HTTPS-API-basadress och serverlagrad API-nyckel. Moln-API använder `https://api.docuseal.com`; egen drift kan ha API-bas `https://<egen tjänst>/api`. Basadressen ska komma från serverkonfiguration, aldrig från formulär eller webhookmetadata.

`createSubmission` kräver dessutom uttryckligt `enabled: true`; skapa-anrop är avstängda som standard. `getSubmission` kan användas för läsande avstämning med korrekt konfiguration. Adaptern skickar `X-Auth-Token`, blockerar redirects och begränsar kroppsstorlek och svarstid.

Skapandet använder `template_id` och förväntade undertecknare. E-post och SMS är uttryckligen avstängda både för submission och signer. Denna leverans erbjuder inga notifieringsflaggor, slutförd-statusflaggor eller anrop som förmarkerar dokument som signerade.

POST-svaret är en lista med **submitters**, inte ett submissionobjekt. `submitter.id` identifierar en part; `submitter.submission_id` identifierar hela uppdraget. Adaptern kontrollerar att rätt roll, e-post och eventuellt externt ID återkommer, oberoende av arrayordningen.

Använd lokalt genererade, unika signer-ID:n som `externalId` i dispatchsnapshoten. DocuSeal garanterar inte unikhet för detta fält. Det är därför en korrelationshjälp, inte behörighetsbevis eller garanti för idempotens.

## Okända utskicksutfall

Det verifierade API-kontraktet ger ingen generell idempotensgaranti för POST. Adaptern gör därför inga automatiska retries.

Nätverksfel, timeout, 408, redirect, 5xx eller ett ofullständigt/motstridigt svar efter möjlig POST ger `DocuSealError` med kod `outcome_unknown`. Huvudappen ska behålla uppdraget i avstämningsläge och kontrollera leverantören innan ett nytt skapande tillåts.

Ett nytt försök med samma `externalId` hindrar inte ett dubbelt provideruppdrag. En timeout får alltså inte presenteras som ett definitivt misslyckande med en knapp som omedelbart skickar igen.

## Signerade webhookar

`verifyDocuSealWebhook` och `parseVerifiedDocuSealWebhook` använder:

- Header `X-Docuseal-Signature`, format `timestamp.hexsignature`.
- HMAC-SHA256 över tidsstämpel, punkt och **exakta råa bodybytes**.
- Hela `whsec_...`-hemligheten som UTF-8-nyckel; prefixet strippas inte och nyckeln avkodas inte från base64.
- Säkert heltal, högst fem minuters tidsavvikelse och konstanttidsjämförelse.

En route läser råbody före JSON-tolkning. Om den först parsar och sedan serialiserar om JSON kan legitima signaturer förstöras. Parsern lämnar endast kontrollerade händelsefält och provider-ID:n vidare; metadata bestämmer inte företag, affär, dokument eller behörighet.

`form.completed` gäller en part. `submission.completed` gäller hela uppdraget. En verifierad signatur gör inte okända provider-ID:n till lokalt godkända dokument. Giltiga callbacks inom tidsfönstret kan upprepas, så en persistent inbox och idempotent handläggning krävs fortfarande.

## Låst domänmodell

Ett signeringsjobb håller en serverkontrollerad snapshot: lokalt jobbs-ID, företag, dokument, eventuell affär, dokumentversion, källfilens SHA-256, mall-ID och förväntade signer-ID:n.

Grundkedjan är:

`prepared` → `dispatching` → `awaiting_signatures` → `awaiting_archive` → `completed`.

Ett oklart utskick går till `outcome_unknown`. Det får bindas till ett avstämt provideruppdrag, men får inte startas om som en ny dispatch utan ett separat, beslutat återhämtningsflöde. Avböjda eller utgångna uppdrag följer sina egna terminala tillstånd.

Providerbindningen kontrollerar den låsta kontexten och alla förväntade signer-ID:n. En delunderskrift registrerar högst den partens completion. Hela uppdragets completion väntar på arkivering; det färdigställs först när provider-ID, dokumentversion och källhash matchar och privat signerad PDF samt revisionsbevis har lagringsväg och checksumma.

Domänmodellen validerar struktur och bindningar. Den kan inte bevisa att en fil faktiskt ligger i en privat bucket eller att data har sparats. Dessa bevis ska komma från worker och lagringsintegration. Sena eller dubbla händelser ska inte backa ett färdigt jobb eller öka dess version utan en verklig ändring.

## Beständig integration som återstår i huvudappen

1. Kontrollera session, aktivt företag och dokumentroll med huvudappens befintliga serverkontext och RLS. Dokument och affär ska höra till samma företag, och dokumentradens `deal_id` ska matcha jobbets `dealId` exakt. Null-kopplingar kräver en beslutad dokumenttyp-/mallregel; bind inte dokumentet till en annan affär bara för att företaget matchar.
2. Frys dokumentversion, källfil och mallkontrakt. Skapa en företagsbunden dispatchledger och förväntade signerbindningar i databasen.
3. Ta uppdraget för dispatch med en atomär versionskontroll. Bara en worker får skicka det förberedda uppdraget.
4. Spara verifierat provider-ID och partbindningar; hantera okänt utfall genom avstämning, inte blind retry.
5. Verifiera webhooken, skriv till en beständig inbox och slå upp företaget via den lokala providerbindningen. Hantera okända submission-ID:n separat.
6. Spara domänövergången med compare-and-set på jobbets version. Bokför dubbla events utan dubbla effekter.
7. Hämta aktuell providerstatus och signerad PDF/revisionsbevis via betrodda provider-ID:n. Arkivera i privat företagslagring, verifiera sparandet och färdigställ därefter jobbet.
8. Koppla en rättvisande UI till sparade tillstånd och verifiera hela flödet i preview.

Returnerade signing-/download-URL:er kan bära åtkomsttoken och får inte loggas eller spridas till obehöriga. Download-URL:er kan vara kortlivade. Adaptern hämtar inte godtyckliga URL:er ur webhookpayload; en senare arkiveringsworker behöver egen betrodd downloadpolicy.

Bilköpeavtal och finanspartnerns kreditavtal hålls åtskilda. DocuSeal-signering bevisar inte BankID-identifikation och ger inget kreditbeslut.

## Verifiering

```sh
npm ci --prefix tests/docuseal
npm run typecheck --prefix tests/docuseal
npm test --prefix tests/docuseal
```

Providertransporten testas med kontrollerad fetch och riktiga kryptoberäkningar. Domänmodellen testas med giltiga och manipulerade bindningar, okända utskick, delunderskrifter, dubbla callbacks och arkiveringsbevis. Inga verkliga provideruppdrag, signermejl, live webhookar eller databasändringar ingår i testerna.

Den framtida huvudappsintegrationen ska dessutom testas med två företag och två affärer inom samma företag: fel dokument-/affärskoppling, även inom rätt företag, ska stoppas före provideranrop. Databas-/lagringstester ska bevisa privat arkivåtkomst och atomär CAS/inboxhantering.

## Officiella kontraktskällor

- [DocuSeal API](https://www.docuseal.com/docs/api).
- [Signerade webhookar](https://www.docuseal.com/resources/use-webhooks).
- [HMAC implementation och nyckelsemantik](https://github.com/docusealco/docuseal/blob/master/lib/webhook_urls/signatures.rb).
- [Submission-controller](https://github.com/docusealco/docuseal/blob/master/app/controllers/api/submissions_controller.rb).
- [API-autentisering](https://github.com/docusealco/docuseal/blob/master/app/controllers/api/api_base_controller.rb).
- [Provider-schema och external ID](https://github.com/docusealco/docuseal/blob/master/db/schema.rb).
- [OSS och Pro](https://github.com/docusealco/docuseal), [egen drift](https://www.docuseal.com/on-premises).
- [Hämta signerade dokument](https://www.docuseal.com/guides/download-signed-documents).

Basic API för submissions och webhooks finns i den verifierade OSS-källan. Moln, embedding och utökad mallfunktionalitet har egna kommersiella villkor. Kontrollera vald utgåva, licens och driftmodell innan produktionen aktiveras.
