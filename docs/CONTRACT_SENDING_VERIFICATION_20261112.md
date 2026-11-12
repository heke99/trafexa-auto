# Avtalsutskick och rättningar – 12 november 2026

## Verifierat utfall

Avtalsutskickets ordinarie kedja har verifierats med faktisk applikationskod, migrerad lokal SQL och Chromium. **97/97 riktade utskicksfall passerar.** Ett separat tydligt märkt diagnostikmejl skickades från `kundtjanst@trafexa.com`; mottagaren bekräftade uttryckligen att det kom till inkorgen.

Diagnostikmejlet skickades via den anslutna Resend-tjänsten och skapade ingen verklig affär, avtalsinbjudan eller signering i produktion. Det bevisar avsändar-/leverantörsvägen och mottagen leverans, inte att Vercels produktionsnyckel har använts i en autentiserad kundresa. Den sammanhängande appkedjan nedan provades med kontrollerad extern IO. Ett riktigt kundavtal i produktion påstås inte vara genomfört.

## Skickaflödet

`Granskat avtalsutkast → requestContractSigningAction → atomisk signeringspost + outbox → verifierad kölease/mottagare/dokument → krypterad personlig länk → providerförsök med stabil idempotensnyckel → sparad status → kundens dokumentvy`

Verifierade fall omfattar:

- rätt företag, dokument, mottagare och version genom hela kedjan,
- tokenbunden personlig länk utan krav på kundkonto eller lösenord,
- att länken rensas från URL och lagras i HttpOnly-cookie,
- oföränderliga mejlbytes och samma provider-idempotensnyckel vid återförsök,
- 429, saknad konfiguration och tappade bind-/provider-/kvittosvar,
- konservativ `unknown` och granskad återläsning i stället för blind omsändning,
- sena återförsök utanför det säkra providerfönstret,
- utgångna länkar och exakt generations-/dokumentbunden förnyelse,
- Chromium vid 320, 390 och 1440 px: mottagargranskning, vänteläge, behörighet och återhämtning,
- att UI skiljer provideracceptans från faktisk inkorgsleverans.

## Leverantör och produktionens konfiguration

Läst utan att hämta eller skriva ut hemlighetsvärden:

| Kontroll | Utfall |
| --- | --- |
| Resend-domänen `trafexa.com` | Verified, sending enabled |
| Avsändare | `Trafexa <kundtjanst@trafexa.com>` |
| Svarsadress | `info@trafexa.com` |
| `CONTRACT_EMAIL_ENABLED` | `true` i produktion |
| `TRANSACTIONAL_EMAIL_DOMAIN_VERIFIED` | `true` |
| Resend- och Supabase-servernycklar | Finns som känsliga miljövariabler; värden lästes inte |
| Appens Supabase-projekt | Matchar kodens avsedda projekt |
| Diagnostikmejl | Provider accepterade; mottagaren bekräftade inkorgen |

Provider-ID för detta enda diagnostikmejl: `01a1d16b-2760-7b52-8c44-de0bc5c5153e`. Ämnet var tydligt märkt TEST och ingen signering krävdes. Samma idempotensnyckel användes för att undvika dubbla provutskick. Mottagarens personliga adress och privata mejlinnehåll återges inte här.

Två befintliga Resend-webhooks observerades; Trafexas aktiva hook gäller fakturamejl. Verktyget rapporterade `sent` för diagnostikmejlet. Inkorgsleveransen styrks därför av mottagarens uttryckliga bekräftelse, inte av en påhittad app-/webhookstatus. Ingen webhook, spärrlista eller gammal kö ändrades.

## Rättningar i kod

### F11 – stoppa signering som inte kan ge ett användbart avtalsoriginal

Alla tre partsvägarna – handlare, kontokund och gäst – kontrollerar föreslaget signaturnamn och provrenderar hela det sparade avtalsunderlaget och tidigare underskrifter före signerings-RPC. Samma versionsbundna DejaVu-font används för kontroll och rendering; byte till annan font utan motsvarande täckningsversion stoppas.

En additiv SQL-migration skyddar även direkt-RPC mot nya oskrivbara signaturnamn och mot att komplettera en äldre oskrivbar partssignatur. SQL-guarden gäller namn. Appens preflight kontrollerar dessutom hela draften. Historiska underskrifter och arkivbytes skrivs inte om.

Vid ett känt valideringsfel får kunden ett begripligt meddelande och behåller sin inmatning. Namnet ändras inte genom translitterering. Detta inför inte full CJK-fonttäckning: namn som den nuvarande fonten saknar måste hanteras med framtida fontstöd, men de kan inte längre låsa ett nytt färdigsignerat avtal genom appflödet.

Riktat: **43/43 PASS** för font/SQL-paritet, direkt-RPC, äldre data, replay, drift, alla partsvägar, fulla vanliga avtalskedjor samt mobil-/desktopåterhämtning.

### F10 – samma kostnadsbegäran ger samma kvitto

Fordonskostnader skapas via en idempotent RPC med privat, oföränderlig request-/kvittojournal. Appens nya formulär och den äldre serveraction-adaptern använder samma protokoll. Företag, aktör, roll och hela kvittot kontrolleras; olösta försök behåller sin identitet. Ett verkligt nytt ärende kan fortfarande registrera samma belopp och beskrivning med ett nytt request-ID.

SQL/action-provet visar en kostnad, en kostnadsaudit och en versionsökning efter ett tappat commitsvar och identiskt återförsök. Behörighetsnekande i den nya sparvägen tömmer även den överordnade kostnads-/kalkylvyn och ignorerar sena lässvar. Tidigare F04 i den separata kalkylsparningen omfattas inte av detta påstående.

Riktat: **6 action + 3 SQL/action + 3 browserfall PASS**, samt anpassad företags-/rollsvit 13/13. Befintlig rå tabell-INSERT är en separat skrivoperation utanför detta requestprotokoll.

### F12 – återgå till vald adminundersida

Både proxygrinden och sidans färska Auth-kontroll bevarar vald adminundersida genom inloggningen. Externa redirectmål tillåts inte. **52/52** Auth-/routing-/lösenordsfall passerar, inklusive fyra nya regressioner. Den faktiska byggda Next-appen verifierades vid 320/1440 px: adminens fullständiga mål bevaras, kundkontraktets mål fungerar fortsatt och inga pageerrors eller overflow observerades på de sex kontrollerade vyerna.

## Gemensamma kvalitetsgrindar

| Kontroll | Resultat |
| --- | --- |
| Typkontroll | PASS |
| Produktionsbygge | PASS |
| Font i deployment-traces | 8/8 signerande actionworkers inkluderar exakt fontfil |
| Riktade prov ovan | PASS; grupperna överlappar och summeras inte till ett separat totalantal |
| Hela flat-sviten, slutlig samlad kod | **1991/1991 PASS**, 0 fel, 0 skip; 218 filer, 392.581 s |
| Diff-/syntaxkontroll | PASS |
| Faktisk inkorgsleverans av diagnostikmejl | Bekräftad av mottagaren |

Helsviten körs med samma uppsättning `tests/*.test.mjs` som projektets kanoniska script, men varje fil körs direkt i sin egen Node-process med tre samtidiga filer. Detta behåller processisolering och verkliga fallantal i den här Node 24.19-miljön, där standard-`--test` ibland bara redovisar filantal. Ingen testfil väljs bort på grund av fel.

React-komponenterna granskades för scopebunden state, hooks, läckande sena svar, vänteläge och label-/statuskoppling. SQL granskades för aktuell behörighet, privata tabeller, explicita grants, atomiskt kvitto och säker replay. PGlite-proven ersätter inte ett native PostgreSQL-samtidighetsprov.

## Publiceringsordning och avgränsning

Två nya migrationer behöver appliceras före den nya appkoden:

1. `20261112202207_contract_pdf_signature_guard.sql`
2. `20261112202358_vehicle_cost_creation_receipts.sql`

De är verifierade i lokal migrationsreplay men **inte applicerade hosted i detta arbete**. Ingen produktionsdeployment eller merge har gjorts. Vid metadata-/aggregatkontrollen fanns inga sparade konto- eller gästsignaturer i produktion; inga personuppgifter lästes för kontrollen.

Redan historiskt färdigsignerade dokument med oskrivbara tecken skulle behöva separat font-/återställningshantering. Övriga tidigare fynd och verkliga bank-/partnerflöden omfattas inte av denna rättning. En full GREEN-bedömning av hela systemets produktion görs därför inte här.

## Cleanup och bevis

Browserinstanser och tillfälliga lokala databaser stängs av proven; den lokala Next-testservern är stoppad. Endast det uttryckligen godkända diagnostikmejlet lämnade miljön. Inga riktiga affärer, avtal, kunder, annonser eller betalningar skapades.

Maskerad verifieringssammanfattning: [CONTRACT_SENDING_EVIDENCE_20261112.json](CONTRACT_SENDING_EVIDENCE_20261112.json). Tidigare reproduktionsskript i `verification/20261112-additional` gäller uttryckligen den äldre baslinjen `681df2d`; de ska inte användas som positiva regressioner mot den rättade branchen.
