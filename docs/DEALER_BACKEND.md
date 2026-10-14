# Sparade Trafexa förfrågningar

Backenddelen ger inloggade företagsanvändare ett sparat ärende med ID, versionskontroll och statushistorik. Den byggdes som ett avgränsat förslag innan den ursprungliga handlarplanen blev åtkomlig och bevaras som integrationsunderlag i utkast-PR #2.

Den återhämtade handlarplattformen använder redan `companies`, `memberships` och rollerna `owner`, `admin`, `sales`, `finance`, `viewer` i Supabase-projektet **Trafexa dealer**. Applicera inte detta underlags parallella företags- och medlemskapstabeller där. Om sourcing ska ingå behöver funktionen anpassas till den gemensamma modellen och Next.js-appens befintliga autentisering först.

## Användare och företagsåtkomst

Varje anrop skickar `Authorization: Bearer <Supabase access token>`. Servern verifierar användaren med Supabase Auth och skickar samma session vidare till Data API. Företagsmedlemskap styr åtkomsten i PostgreSQL med RLS; användarens redigerbara metadata används inte som behörighetskälla.

| Roll inom företaget | Läsa ärenden och historik | Skapa förfrågan | Ändra status |
| --- | --- | --- | --- |
| `viewer` | Ja | Nej | Nej |
| `member` | Ja | Ja | Nej |
| `manager` | Ja | Ja | Ja |

En användare kan ha medlemskap i flera företag. Medlemskap provisioneras av en betrodd administratör; ingen klient kan skapa företag, höja sin roll, flytta ärenden mellan företag eller skriva audit-händelser. Anonyma klienter har ingen tabellåtkomst.

## API

| Anrop | Resultat |
| --- | --- |
| `GET /api/dealer-requests?companyId=<uuid>&limit=50` | `{ok: true, requests: [...]}`; högst 50, nyast först |
| `POST /api/dealer-requests` | `{ok: true, request: {...}}`; `201` vid sparande, `200` vid identisk omsändning |
| `GET /api/dealer-request?id=<uuid>` | `{ok: true, request: {...}, events: [...]}`; historik i versionsordning |
| `PATCH /api/dealer-request` | `{ok: true, request: {...}}`; kräver aktuell version och managerroll |

POST och PATCH använder `Content-Type: application/json`. Alla svar är `Cache-Control: no-store`. Fält som skaparidentitet, status vid skapande och versionsnummer kan inte anges i POST.

### Skapa en förfrågan

```json
{
  "companyId": "10000000-0000-0000-0000-000000000001",
  "idempotencyKey": "30000000-0000-0000-0000-000000000001",
  "name": "Kontaktperson",
  "email": "buyer@example.com",
  "country": "Sweden",
  "buyerType": "Dealer / reseller",
  "brand": "BMW",
  "model": "X5",
  "year": "2026 / 2027",
  "quantity": 2,
  "condition": "Either",
  "destination": "Sweden",
  "consent": true
}
```

Klienten skapar en UUID med exempelvis `crypto.randomUUID()` när en ny förfrågan påbörjas och behåller nyckeln vid retries. Samma företag, användare och nyckel ger samma sparade ärende om innehållet är identiskt efter API-normalisering. Ändrat innehåll med samma nyckel ger `409`. En ny avsiktlig förfrågan får en ny nyckel. Framgång rapporteras först när databasen har bekräftat en sparad rad.

API:t validerar obligatoriska fält, samtycke, UUID, enumvärden och mängdgränser. `year` är text så att befintliga värden som `2026 / 2027` fungerar. Antal är 1–1000. Servern sätter `created_by` från den verifierade sessionen. Databasen sätter ID, status `submitted`, version `1` och tidsstämplar samt sparar den första historikhändelsen atomärt.

### Uppdatera status

```json
{
  "id": "<sparat ärende UUID>",
  "version": 1,
  "status": "sourcing"
}
```

Tillåten ordning är `submitted` → `sourcing` → `offered` → `confirmed` → `closed`. Varje aktiv status kan också gå direkt till `closed`. Att ange samma status är en oförändrad uppdatering: versionen och historiken ökar inte.

Statusändringen och audit-händelsen sparas i samma databastransaktion. Ett uppdateringsfilter med `id` och `version` hindrar att en äldre klient skriver över senare arbete. Klienten ska läsa in ärendet igen vid `409`. Statusen `confirmed` är en intern ärendemarkering; den ersätter inte de affärsdokument som webbplatsens villkor kräver.

### Fel och återhämtning

| Kod | Hantering |
| --- | --- |
| `400`, `413`, `415` | Rätta data, kroppsstorlek eller innehållstyp |
| `401` | Logga in eller förnya sessionen |
| `403` | Företagsmedlemskap eller rätt roll saknas |
| `404` | Ärendet saknas eller är inte synligt för användaren |
| `409` | Omsändning med ändrade uppgifter, gammal version eller otillåten statusgång |
| `502`, `503`, `504` | Tjänstefel, saknad konfiguration eller timeout; behåll innehåll och samma förfrågningsnyckel vid retry |

Listning för ett företag som användaren inte tillhör returnerar en tom lista. Detaljanrop röjer inte att ett annat företags ärende finns. Råa leverantörsfel och autentiseringsvärden skickas inte till klienten.

## Konfiguration och integration

Servern använder `SUPABASE_URL` och `SUPABASE_PUBLISHABLE_KEY`, med befintliga `NEXT_PUBLIC_SUPABASE_URL` och `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` som alternativ. Endast publishable key accepteras. Vanliga användaranrop behöver ingen service-role-nyckel.

1. Integrera kodgrenen i den valda appstrukturen. De två filerna i `api/` är Vercel Node-handlers; kärnlogiken i `lib/dealer/handlers.mjs` är avgränsad för återanvändning. Om appspåret väljer Next.js App Router behövs dess route-adapter innan dessa endpoints räknas som integrerade.
2. Anpassa först företags- och rollkontraktet till handlarplattformens befintliga schema. Migrationen i detta underlag är en lokalt testad referens, inte en migrationsinstruktion för **Trafexa dealer**. Läs [databasunderlaget](../supabase/README.md) för referensmodellens roller och provisionering.
3. Provisionera autentiserade testanvändare, två testföretag och deras medlemskap med en betrodd administratör.
4. Verifiera en körbar preview med riktig Auth och Data API innan frontendflödet kopplas in eller koden lanseras.

Driftinventeringen den 13 oktober 2026 visade Next.js som Vercelframework, medan huvudgrenens kod fortfarande var statisk. Dagens preview misslyckades med `missing_lock_file` och `npm ci`. App-/driftspåret behöver en konsekvent appstruktur, paketdefinition och lockfil. Backendspåret ändrar inga liveinställningar.

E-postavisering och kopplingen från det offentliga formuläret till företagskonton ingår i ett senare integrationssteg. Ett sparat ärende ska behållas om en framtida avisering misslyckas. Denna backend skickar inga e-postmeddelanden.

## Verifiering

```sh
npm ci --prefix tests/dealer-db
node tests/dealer-api/handlers.test.mjs
npm test --prefix tests/dealer-db
node tests/dealer-flow/flow.test.mjs
```

API-sviten testar Auth-verifiering, validering, idempotens, felhantering och versionskontroll med kontrollerade upstream-svar. Databassviten kör migrationen i PGlite, en lokal PostgreSQL-motor, och verifierar riktiga policies, grants och triggers.

Flödessviten går genom HTTP-handlern, dess transport och en testadapter för PostgREST till samma riktiga PostgreSQL-schema. Den kontrollerar sparande, omsändning, två företags isolering, roller, statushistorik och konfliktvägar. Loopback-HTTP måste vara tillåtet för detta test.

Supabase Auth är stubbat och PostgREST ersatt av testadaptern i de lokala testerna. Live Auth, faktisk PostgREST, deployment och webbplatsens nya användarflöde är därför separata kvarstående verifieringssteg.
