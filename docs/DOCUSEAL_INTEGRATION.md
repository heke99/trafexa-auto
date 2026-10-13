# Trafexa Dealer avtalsintegration

Denna leverans bygger serverdelen för byggplanens fas 4: autentiserad förberedelse, beständig signeringsledger, DocuSeal-worker, verifierade webhookar och privat arkivering. Koden kan föras in i den befintliga Next.js-appen utan sourcing-tabellerna i PR #2. Inga verkliga signeringsuppdrag eller live databasändringar ingår i denna leverans.

## Koppling i huvudappen

Modulerna från avtals-PR #3, commit `86bbce9`, är nu införda i huvudappens `src/lib/signing/`. Applikationskod importerar `@/lib/signing/server`, där både `createTrafexaDocuSealClient` och `createTrafexaSigningWorker` tvingar skapande till `enabled:false`, även för en otypad `enabled:true`-parameter. Migrationen har ett nytt CLI-genererat namn efter huvudappens åtta redan applicerade migrationer; den äldre migrationsfilen från PR #3 ska inte appliceras dessutom.

Offertarkivet beskrivs i [OFFER_DOCUMENT_ARCHIVE](OFFER_DOCUMENT_ARCHIVE.md). Det kopplar sparade offertversioner till faktisk privat lagring och autentiserad nedladdning. Offert-PDF behåller `document_type=offer` och dokumentet registreras som `kind=other`; det är aldrig en godkänd signeringskälla eller ett signerat köpeavtal. Arkivregistrering kräver separat servernyckel och verifierat underlag. Providercredentials, godkända avtalsmallar, signeringsroutes, webhookroute och workerdrift behöver fortfarande kopplas före aktivering.

## Befintlig plattform som integrationen ska använda

Supabase **Trafexa dealer**, projekt `buqdtssxrotkzndublrt`, har redan `companies`, `memberships`, `deals` och `documents`. Aktiva företag och medlemskap skyddas med RLS. Rollerna är `owner`, `admin`, `sales`, `finance`, `viewer`.

`documents` innehåller ID, företag, eventuell affär, namn, objektväg, dokumenttyp och tidsstämpel. Objektvägen börjar med företagets UUID. Dokumentåtkomst kräver nu `owner/admin/finance` enligt de verifierade policyerna. Tabellen saknar signeringsstatus, mallversion, checksumma och providerbindning. `deals.status` tillåter endast `draft/reserved/cancelled` i den verifierade grunden.

Använd dessa befintliga företag och behörigheter. Skriv inte `signed` till befintliga dokument eller affärer. Den additiva migrationen `supabase/migrations/20261013165650_signing_ledger.sql` tillför egna signerings-, dokumentversions-, mall- och inboxtabeller. [Databaskontraktet](../supabase/README_SIGNING.md) beskriver exakta RPC-argument, grants, RLS och övergångar. Migrationen ska ingå i huvudappens migrationsflöde innan funktionen aktiveras.

## Kodens ansvar

| Modul | Ansvar |
| --- | --- |
| `src/lib/signing/docuseal.ts` | Skapa submission från en befintlig mall, läsa providerstatus och verifiera/parsa signerade webhookar |
| `src/lib/signing/signing-state.ts` | Validera låst jobbsnapshot, dispatchutfall, providerbindningar och tillåtna domänövergångar |
| `src/lib/signing/signing-user.ts` | Verifiera Supabase-användare, läsa behörig företagskontext och förbereda jobb från servergodkänt renderunderlag |
| `src/lib/signing/signing-store.ts` | Servertransport till ledger/RPC, strikt svarskontroll och stöd för moderna secret-nycklar |
| `src/lib/signing/signing-worker.ts` | Verifiera faktiska käll- och mallbytes, atomär dispatch, beständig webhookhantering och arkivkontroll |
| `src/lib/signing/signing-storage.ts` | Privat Supabase-lagring, tillåtna providerdownloads och verifierad återläsning av signerad PDF/revisionsbevis |
| Main-appens integration | Godkänt offertrenderunderlag, faktisk providermalläsare, serverwrappers/routes, workerdrift, UI och aktivering |

Transporten och worker skriver till signeringsledgern; de ändrar inga dokument-, affärs- eller kreditstatusar. Importera modulerna bara från serverroutes eller workers. En Next.js-wrapper ska också använda `import 'server-only'` för att skydda gränsen vid bundling. Providerhemligheter och Supabase service/secret-nycklar får inte använda `NEXT_PUBLIC_`. Moderna `sb_secret_`-nycklar skickas som `apikey`, inte som JWT i Authorization; en verifierad användares access-token används vid förberedelse.

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

Ett signeringsjobb håller en serverkontrollerad snapshot: lokalt jobbs-ID, företag, dokument, eventuell affär, dokumentversion, källfilens SHA-256, mall-ID/version/hash och förväntade signer-ID:n. Det fullständiga signer-/fältpayloadet fryses separat mot den servergodkända dokumentversionen. En klient får inte ändra pris, parter eller andra renderfält efter godkännandet.

Grundkedjan är:

`prepared` → `dispatching` → `awaiting_signatures` → `awaiting_archive` → `completed`.

Ett oklart utskick går till `outcome_unknown`. Det får bindas till ett avstämt provideruppdrag, men får inte startas om som en ny dispatch utan ett separat, beslutat återhämtningsflöde. En säker provideravvisning blir terminal `dispatch_failed`. Avböjda eller utgångna uppdrag följer sina egna terminala tillstånd. Även en utgången dispatchlease spärrar omsändning. Unik dokumentversion hindrar dubbla uppdrag även om klienten genererar en ny idempotensnyckel.

Providerbindningen kontrollerar den låsta kontexten och alla förväntade signer-ID:n. En delunderskrift registrerar högst den partens completion. Hela uppdragets completion väntar på arkivering; det färdigställs först när provider-ID, dokumentversion och källhash matchar och privat signerad PDF samt revisionsbevis har lagringsväg och checksumma.

Domänmodellen validerar struktur och bindningar. Den kan inte bevisa att en fil faktiskt ligger i en privat bucket eller att data har sparats. Dessa bevis ska komma från worker och lagringsintegration. Sena eller dubbla händelser ska inte backa ett färdigt jobb eller öka dess version utan en verklig ändring.

## Koppling som återstår i huvudappen

1. Applicera den granskade migrationen mot befintlig Dealer-grund, och behåll `owner/admin/finance` för dokumentåtkomst. Integrera inte PR #2:s separata företagsmodell.
2. Koppla `TrustedApprovedRenderReader` till den befintliga offertens godkända, oföränderliga renderunderlag. PDF, parter och DocuSeal-fält ska produceras från samma snapshot. Reader måste kontrollera faktiska privata bytes och underlagets SHA-256. Kopiera aldrig requestfält till servergodkännandet. `purchase` får sakna affär; `contract` kräver exakt dokumentkopplad affär.
3. Registrera företagets godkända provider-mall och dess version/hash genom service-RPC efter kontroll av owner/admin. Koppla workerns `TrustedTemplateSource` till faktiska, betrodda provider-mallbytes och fältschema. `hashSigningTemplate` binder kanoniskt fältschema och längdmarkerade PDF-bundlebytes; använd samma metod i registrering och läsning. SQL kan inte bevisa att en provider renderar semantiskt identiskt med offertunderlaget.
4. Anropa användargränsen med verifierbar bearer-token och endast företag, dokument, dokumentversion, mall-ID och idempotensnyckel. Service-nyckeln får inte användas för att ersätta användarens RLS-kontroll. Återförberedelse av ett historiskt jobb ska bevara dess ursprungliga mallbindning.
5. Koppla workerdrift och webhookroute: läs råbytes och `X-Docuseal-Signature`; ta emot till beständig inbox innan bearbetning. Lägg ett explicit avstämningsflöde runt `outcome_unknown` och quarantined events. Skapa aldrig nya uppdrag som automatisk återhämtning.
6. Injicera serverns Supabase Storage-client i `createPrivateSigningStorage`. Bucket ska vara `dealer-documents` och privat. Konfigurera exakta godkända HTTPS-origins för providerfiler; standardvärdet tillåter inga downloads. Signed URLs får inte skickas till loggar eller obehöriga. Redirects blockeras och arkivobjekt skrivs med `upsert:false`; återförsök kräver exakt återlästa bytes.
7. Koppla UI till sparade tillstånd och verifiera riktiga användarsessioner, privat lagringsåtkomst och providerflöde i preview före aktivering. Biblioteket och worker behöver uttryckligt `enabled:true`; låt integrationen vara avstängd tills dessa kopplingar finns.

Returnerade signing-/download-URL:er kan bära åtkomsttoken och får inte loggas eller spridas till obehöriga. Download-URL:er kan vara kortlivade. Arkivering hämtar endast filer från aktuell kontrollerad providerstatus; webhookmetadata styr aldrig downloads.

Bilköpeavtal och finanspartnerns kreditavtal hålls åtskilda. DocuSeal-signering bevisar inte BankID-identifikation och ger inget kreditbeslut.

## Verifiering

```sh
npm ci
npm ci --prefix tests/signing-ledger
npm run typecheck
npm run test:signing
```

Providertransporten testas med kontrollerad fetch och riktiga kryptoberäkningar. Ledgern körs i lokal PGlite med riktiga PostgreSQL-roller, RLS, grants, triggers, transaktioner och RPC. Flödestester kopplar den faktiska service-transporten och worker till dessa SQL-funktioner genom en testadapter; provider och Storage SDK är kontrollerade fixtures. Inga verkliga provideruppdrag, signermejl, live webhookar eller hosted databasändringar ingår i testerna.

Tester omfattar företagsisolering, dokument-/affärskoppling, signer-/prisförfalskning, mallbyte, deduplicering, konkurrerande workers, okänt utskick, delunderskrift, beständig inbox/CAS och privata filer med faktisk hashkontroll. Hosted Storage RLS och användarflödet i huvudappens webbläsare ska fortfarande verifieras vid integrationen.

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
