# Granskat inbytesköp och lagerintag

Etappen 15 oktober 2026 på `codex/trafexa-trade-in-intake-20261015` är implementerad. Migration `20261015105239_trade_in_acquisition` är applicerad och hosted rollbackprovet passerar. Koden är lokalt verifierad i väntan på PR/publicering; slutlig helsvit och byggning redovisas separat i [IMPLEMENTATION_STATUS](IMPLEMENTATION_STATUS.md).

## Exakt fryst källa

Intaget utgår från inbyteskopian i en exakt accepterad offertversion och en färdig native försäljningssignering av samma offert. Företag, affär, offert-ID/version, inbytes-ID/version, kund och signering binds till ett serverläst källunderlag med kontrollsumma. Ett nyare internt inbytesförslag ersätter inte den accepterade offertens frysta uppgifter. Säljaridentiteten hämtas från den frysta offerten även om det levande kundkortet ändrats. Ofärdig signering, saknat accepterat inbyte eller ändrad källa stoppar nytt intag.

Den färdiga native signeringen avser försäljningsavtalet. Inbytesköpet kräver en separat referens till ett externt inköpsavtal; denna etapp skapar eller signerar inget nytt native inköpsavtal. Referensen är en uppgift som handlaren granskar, inte en filuppladdning eller ett bevis på att Trafexa har verifierat det externa avtalet.

## Manuell granskning

Aktuell godkänd ägare eller administratör måste uttryckligen intyga att inköpet är genomfört, bilen mottagen, skuldunderlaget kontrollerat och hela intaget granskat. Datum för inköp/intag, inköpsavtalsreferens samt skuldens bekräftelsedatum och underlagsreferens sparas. Intygen använder version `2026-10-15` och registrerar ett redan granskat förlopp; de verkställer det inte.

| Uppgift | Källa och innebörd |
|---|---|
| Fordonsidentitet och inbytesvärde | Den accepterade offertens frysta inbyteskopia |
| Inköpspris | Inbytesvärdets bruttobelopp, inte värde minus skuld eller kundens mellanskillnad |
| Bekräftad skuld | Måste exakt motsvara offertens frysta skuld, inklusive uttryckligt noll |
| Skuldunderlag | Separat obligatorisk referens och bekräftelsedatum även när skulden är noll |
| Drivmedel och växellåda | Uttryckligt manuellt val; saknas i den frysta inbyteskopian och får inte gissas |
| Begärt försäljningspris | Uttryckligt nytt belopp för lagerposten |
| Momsmodell | `unknown`; intaget fastställer inte vanlig moms, VMB eller avdragsrätt |

Pengar hanteras som exakta heltalsören. Inköps-/begärt pris är 1..999999999999 öre och skuld 0..999999999999 öre. Inköps-/intagsdatum och skuldbekräftelsedatum ska vara giltiga datum från 1900 till aktuell arbetsdag i Europe/Stockholm. Känd nollskuld är inte saknat eller okänt underlag. Skulden dras inte av från lagerpostens inköpspris. Även skuld större än bruttovärdet bevaras som eget underlag och ändrar inte lagerbilens bruttokostnad. Lösen, betalning, avstämning och eventuellt belopp tillbaka till kunden kräver separata verkliga åtgärder.

## Behörighet och atomiskt intag

Ägare och administratör skriver; ekonomiansvarig har privat läsåtkomst. Övriga företagsroller, kund och anonym användare nekas denna inköpsgräns. Aktuell verifierad identitet, kontogodkännande, aktivt företag och medlemskap kontrolleras på servern och i databasen, med ny kontroll efter IO. Klientens företagsval eller användarmetadata ger ingen egen behörighet.

En lyckad transaktion skapar fordonsidentitet, en tillgänglig lagerpost och privat proveniens tillsammans. Proveniensen bevarar exakt källunderlag, de manuella uppgifterna och granskningen. Ett fel återställer hela transaktionen. Aktörsbundet begärans-ID och oförändrad payload möjliggör identiskt återförsök utan fler fordon/lagerposter; ändrat underlag ger konflikt och kräver en ny granskning/begäran. Identiskt historiskt återförsök kontrolleras efter aktuell behörighet men före rörliga datum-, affärsstatus-, käll- och dubblettvillkor. Samma kvitto kan därför återhämtas efter senare avbrytning eller lagerarkivering utan nya fordon. Historiskt kvitto ersätter inte aktuell åtkomstkontroll.

Alla redan befintliga kanoniska registreringsnummer i företagets fordonsregister blockerar nytt intag, även om motsvarande lagerbil är såld eller arkiverad. Det är ingen automatisk återuppläggning av en tidigare bil. Återintag/restock behöver ett separat senare flöde. Kanoniskt nummer är versaler med blanktecken borttagna; bindestreck behålls. Kontrollen omfattar hela företagsregistret och stöds av databasens unika normaliserade identitet, även vid konkurrens med manuell registrering, import eller direkt RLS-skyddad skrivning.

## Produkt- och driftgränser

Läs-/skrivflödet använder den aktuella autentiserade klienten och kräver ingen servernyckel. Försäljningssigneringens privata originalarkiv behåller sin separata konfigurationsspärr och sina läsregler. Intag kräver inte att originalparet redan har arkiverats.

Ingen automatisk betalning, skuldlösen, kreditgivarkontakt, ägaröverföring eller bokföring sker. Inget nytt native inköpsavtal, extern provider, mejlutskick eller jobb aktiveras. Det befintliga interna [inbytesunderlaget](TRADE_IN_CONTRACT.md), den [frysta offertkopian](TRADE_IN_OFFER_CONTRACT.md) och [native försäljningssigneringen](CONTRACT_SIGNING_CONTRACT.md) har skilda uppgifter och bevaras.

## Implementation och verifiering

`src/components/deal-trade-in-purchase.tsx` är den behovsladdade inköpspanelen i Affärer. `src/lib/data/trade-in-acquisition-actions.ts` exponerar `getTradeInAcquisitionAction` och `recordTradeInAcquisitionAction`; delad kontext, validering och DTO finns i `src/lib/trade-in-acquisition/`. Publika invokerwrappers `get_trade_in_acquisition` och `record_trade_in_acquisition` använder privata behörighetskontrollerade funktioner. Proveniens sparas i `private.trade_in_acquisitions` och aktörsbundna kvitton i `private.trade_in_acquisition_audit`; direkt tabellåtkomst och ändring/radering av historik är spärrade.

Migrationen finns i [20261015105239_trade_in_acquisition.sql](../supabase/migrations/20261015105239_trade_in_acquisition.sql). Hosted [rollbackprovet](../supabase/tests/trade_in_acquisition.sql) passerar med noll kvarvarande fixtureanvändare, företag, fordon, lagerposter, intag, kvitton och approvals. Native PostgreSQL 17.6-prov verifierar verkliga samtidiga sessioner, båda ordningarna mot manuell/import/direkt RLS-skrivning, två intag, läsare, återkallad behörighet och atomisk rollback. Separata TS→SQL-prov använder PGlite med faktisk kontext/approval/validering och nya RPC:er; SDK-IO har adaptrar.

PGlite-korslagrets reproduktion:

```bash
npm ci --prefix tests/crm-db --ignore-scripts
node tests/trade-in-acquisition-db/cross-layer.test.mjs
```

Exakta delresultat och helsvit redovisas i statusprotokollet utan dubbelräkning. Lokala Chromium-harnessar och native Vercel-access är inte Supabase-användarinloggning. Autentiserad produktions-CRUD är ännu inte verifierad. Ingen PR, merge eller deployment för denna etapp påstås innan separat release-readback.
