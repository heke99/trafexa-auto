# Privat arkiv för sparade offertversioner

Denna integration utgår från huvudappens PR #4, commit `4037761`, och signeringsmodulerna i PR #3, commit `86bbce9`. Den kopplar en redan sparad, oföränderlig offertversion till en faktisk privat PDF och ett dokument i samma företag. Dokumentet får `kind=other`; offertarkivering innebär varken ett godkänt köpeavtal, signering eller kreditbeslut.

## Användarflöde

Ägare, administratör och ekonomi kan välja **Spara i dokumentarkivet** i offertpanelen. Servern verifierar aktuell autentisering, aktivt företag, aktivt medlemskap och dokumentroll. Säljare och läsroller kan läsa offerter enligt befintliga policyer men får inte denna arkivåtgärd. Demoläget kan inte arkivera.

Servern hämtar den sparade offertversionen genom användarens RLS och renderar PDF med samma befintliga offertgenerator. Pris, parter och villkor hämtas aldrig från arkivrequesten eller senare kund-/fordonsrader. Requesten innehåller endast företag, offert-ID och en stabil begäransreferens.

PDF skrivs med `upsert:false` till `dealer-documents` under:

`<company>/offers/<offer>/v<version>/<pdf-sha256>.pdf`

Den privata lagringen kontrolleras via smala RPC-kvitton från aktuell bucketkatalog. Servern återläser filen och verifierar faktiska bytes innan registrering. Registrerings-RPC:n är **service-only**: en användare kan inte registrera ett annat PDF-innehåll direkt som en verifierad offert. Den namngivna aktören kommer från serverns verifierade användare; SQL kontrollerar dess aktiva medlemskap och dokumentroll på nytt.

Ett nytt klick eller ett borttappat svar skapar inte ett nytt dokument för samma offert. En unik företags-/offertbindning bevarar den första verifierade filen, dess dokument-ID, version och hash. Återförsök läser originalfilen och kontrollerar dess bytes och aktuella privata lagring. UI behåller begäransreferensen vid fel och ignorerar sena svar från ett tidigare företag.

Efter verifierad registrering visas **Hämta arkiverad PDF**. `/api/documents/[documentId]/pdf` använder användarens session och företag, läser arkivbindningen och kontrollerar filhash samt privat lagring före och efter nedladdningen. Svaret innehåller PDF-bytes och `private, no-store`; inga åtkomstbärande lagringslänkar lämnas ut. Generella finansdokument eller oregistrerade filer hämtas inte genom denna route.

## Migrationer och serverkonfiguration

De två nya migrationerna är lokala, additiva migrationer efter huvudappens åtta verifierade migrationer:

1. `20261013165650_signing_ledger.sql` inför signeringsledgern och dokumentets företagsbundna unika referens.
2. `20261013165726_offer_document_archive.sql` inför offertarkivets bindningar och smala RPC:er.

Använd dessa migrationsnamn i huvudappens migrationsflöde. Applicera inte dessutom den äldre signing-ledgerfilen från PR #3. Inga nya hosted migrationer har applicerats genom denna leverans. De befintliga, livegenererade databastyperna ändras inte; ett separat typat RPC-overlay beskriver den nya migrationen.

Servern behöver `SUPABASE_SECRET_KEY`, alternativt en äldre `SUPABASE_SERVICE_ROLE_KEY`, för registreringen. Den får aldrig vara `NEXT_PUBLIC_` eller nå klienten. Saknad eller ogiltig konfiguration stoppar en ny arkivering före rendering och upload. Redan registrerade arkiv kan fortfarande verifieras med användarens läsbehörighet. Moderna `sb_secret_`-nycklar skickas endast i `apikey`; äldre service-role JWT använder även Authorization. Ingen hemlig nyckel hämtas eller publiceras genom denna leverans.

| RPC | Anropare | Syfte |
| --- | --- | --- |
| `get_offer_archive_source(p_company_id,p_offer_id)` | Verifierad användare med dokumentroll | Oföränderligt offertsnapshot, databashärledd snapshot-hash och faktiskt privat bucketkvitto |
| `get_offer_document_archive(p_company_id,p_offer_id)` | Samma användargräns | Originalbindning för återförsök |
| `get_offer_archive_by_document(p_company_id,p_document_id)` | Samma användargräns | Arkivbindning och privat bucketkvitto för nedladdning |
| `register_offer_document_archive` | Endast serverns service-roll | Registrera verifierad PDF med företag, offertversion, PDF-/snapshothash, objektväg, begäransreferens och verifierad aktör |

SQL använder snapshotens deterministiska JSONB-representation för snapshot-hashen; servern använder den returnerade hashen utan att blanda in JavaScripts JSON-nyckelordning. Registreringen återkontrollerar offertidentitet, version, aktör, bucket, objektväg och filmetadata. PDF-bytes och renderingens innehåll verifieras i servergränsen, inte av SQL. Arkivmetadata och den länkade dokumentidentiteten är oföränderliga.

## Signeringsgränsen

Den beständiga signeringsdelen finns nu i `src/lib/signing/`. `@/lib/signing/server` tvingar både providerklient och workerdispatch till avstängt läge. Offertarkivet registrerar inga `signing_document_versions`, inga godkända signerfält och inga providerbindningar. `kind=other` nekas av signeringsförberedelsen även om samma företag och affär matchar.

Nästa avtalskoppling behöver ett godkänt köpeavtalsunderlag och en godkänd providermall med faktisk version/hash och fältmappning från samma oföränderliga snapshot. Se [signeringskontraktet](../supabase/README_SIGNING.md) och [integrationsguiden](DOCUSEAL_INTEGRATION.md). BankID och finanspartnerns kreditavtal har separata kontrakt.

## Lokal verifiering

```sh
npm ci
npm ci --prefix tests/signing-ledger
npm ci --prefix tests/offer-archive-db
npm run typecheck
npm test
npm run test:signing
npm test --prefix tests/offer-archive-db
npm run build
```

Offerarkivets databasfixture kör hela huvudappens migrationsordning i lokal PostgreSQL/PGlite, med Supabase Auth-/Storage-kataloger som fixtures och riktiga roller, RLS, grants och transaktioner. Browserharness kör de verkliga React-komponenterna i Chromium med mockade serveråtgärder och blockerad extern HTTP. Arkivåtgärder och downloadroute testas med verklig render-/hashkod och kontrollerade SDK-/transportgränser. Detta ersätter inte hosted migration, faktisk Storage-CRUD, autentiserat produktionsflöde eller verklig signeringsleverans.
