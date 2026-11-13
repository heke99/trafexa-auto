# Full E2E Verification Report — inbyte till avslutad affär

## Release verdict

Full produktionsverifiering har en blockerad P0-kedja: agenten saknar inloggad appsession för ett verkligt avtalsutskick och en verklig kundunderskrift. Ett påstående om full produktionsverifiering är därför RED. Det är en åtkomstgräns, inte ett konstaterat fel i de lokala flöden som verifieras nedan.

## Execution identity

- Repository: `heke99/trafexa-auto`, `/workspace/trafexa-simulation`.
- Utgångspunkt: main `7fdac192b2f82216674919bde810fec1142db110`.
- Datum: 13 november 2026, Node 24, Next 16.4.3, Chromium och PostgreSQL 17.12.
- Lokalt: fullmigrerad isolerad SQL, faktiska actions/routes/PDF-renderare, testadaptrar för Auth/Storage/SMTP. Ingen extern bankadapter.
- Produktion: befintligt Trafexa-projekt/app.trafexa.com. Aggregerad baseline: tre affärer, noll signeringar, PDF-källor, betalningsposter, inbytesunderlag, förvärv och leveranser.

## Resulting business flow

Affären kan förberedas med kund och överenskommet pris. Handlaren registrerar ett inbytesunderlag och väljer uttryckligen dess version i direktavtalet. Ett nytt pris räknar om mellanskillnaden i den nya granskningen; ursprungligt inbytesvärde/skuld/version bevaras. Säljare kan förbereda; endast behörig ägare/admin godkänner och skickar. Kunden granskar och signerar den frysta källan via personlig länk. Ingen offert eller offertaccept fabriceras.

Efter signering registreras faktiskt inbytesköp, mottagen bil, inköps-/skuldunderlag och lagerintag. Inbytesbilens inköpspris är hela inbytesvärdet, medan momsmodellen vid intag är ej klassificerad. Kreditgivarens betalning minskar inte inköpspriset. Bankutdrag stäms sedan av i separata kategorier. Först efter exakt avstämning, verifierat inbytesförvärv och aktiv reservation kan såld bil levereras och affären avslutas.

## Calculation contract

All beräkning och jämförelse sker med heltalsören. S är bilens signerade försäljningspris, V inbytesvärde och D känd signerad skuld. C = S − V + D. Kundinbetalning är max(C, 0), kundutbetalning max(−C, 0), separat betalning till kreditgivare är D. Invarianten är kundin − kundut − kreditgivare = S − V. Okänd skuld blockerar, medan faktiskt nollbelopp är tillåtet. C kan vara 13 öresiffror trots att varje originalbelopp är högst 999999999999 öre.

| S, kr | V, kr | D, kr | Kund in | Kund ut | Kreditgivare |
|---:|---:|---:|---:|---:|---:|
| 500 000 | 250 000 | 50 000 | 300 000 | 0 | 50 000 |
| 100 000 | 160 000 | 20 000 | 0 | 40 000 | 20 000 |
| 100 000 | 120 000 | 20 000 | 0 | 0 | 20 000 |

Varje manuell post kräver referens från bankunderlag, bokföringsdatum, notering/underlagsreferens och uttrycklig granskning. Belopp får inte överskrida återstående mål för kategorin. Återföring behåller ursprunglig kategori och källa. Detta är bokförda attestuppgifter i appen, inte verifierad bankleverans eller överföring av pengar.

## Scenario matrix and P0 evidence

| ID | Priority | Trigger / actor | Expected outcome / environment |
|---|---|---|---|
| TRADE-01 | P0 | Ägare väljer inbyte och ändrar överenskommet pris | Faktisk direct action/SQL fryser rätt id/version/V/D och ny C; gammalt underlag skrivs inte om |
| TRADE-02 | P0 | Säljare godkänner, kund signerar | Faktisk native signatur, PDF/evidens, privat arkiv; noll offert-/acceptrows i direktkedjan |
| TRADE-03 | P0 | Faktiskt inbytesköp registreras | Faktiska actions/SQL för lagerintag, separat inköps-/skuldattest, rätt fulla inköpspris och momsstatus |
| TRADE-04 | P0 | Kundin/kundut/kreditgivare + återföring | Sex matematikfall inklusive noll/negativt/0-skuld/maxgräns/−1 öre; exakta saldon, överbetalning och falskt noll blockeras |
| TRADE-05 | P0 | Två samtidiga betalningar eller leveranser | Två verkliga PostgreSQL-anslutningar observerar radlåsväntan; CAS stoppar andra betalningen och bara en leverans skapas |
| TRADE-06 | P0 | Fel roll, annat företag, förlorat svar, fel källa | Åtkomst nekas/rensas, beständigt request-id och signerad hash binder återförsöket; inga dubbla poster |
| TRADE-07 | P0 | Leverans före mottagen bil / återstående kategori | Nekas tills rätt faktisk acquisition finns och alla kategorier är exakt avstämda; därefter sold/completed + frigjord reservation |
| TRADE-08 | P1 | Chromium 320/1440, känt/okänt utfall | Tydliga separata betalningar, läsbar granskning, namngivna knappar, parentnavigation låst även efter osäkert write-resultat |
| TRADE-09 | P1 | Befintlig affär utan inbyte / gammalt offertavtal | Bakåtkompatibla RPC/kvittokedjor, vanliga beloppsgränser och historiska signerade hashvärden bevaras |
| LIVE-01 | P0 | Verklig inloggad produktionssignering | BLOCKED: appsession saknas. Användaren har tillfrågats om en befintlig testaffär för läsbar uppföljning |

Bevis: `TRADE_IN_SETTLEMENT_20261113.md`, `verification/20261113-trade-settlement/native-proof.json` och slutlig samlad regression. Browserkedjorna använder faktiska åtgärder och SQL; fixture-Auth/transport är inte en faktisk produktionssession eller inkorgsleverans.

## Security, migrations and persistence

Inga nya direktåtkomliga tabeller öppnas. Befintliga privata immutable betalningsposter får kategorier; gamla poster får korrekt standardkategori kundinbetalning. Ny direkt acquisition har fryst sourceKind/draft-id med uttryckligt IS TRUE-check som även nekar saknade JSON-nycklar. Nya RPC har unika namn för att undvika PostgREST-overload. Definerfunktioner har tom search_path och roll-/företagskontroller. Nya helpers har explicita EXECUTE-revokes.

Ägare/admin får ändra; finance läser; andra roller, främmande företag och ej godkända konton nekas. PDF/avtalskälla visar inte interna bankreferenser eller noteringar. Leverans kräver samma signerade dokumenthash, trade-id/version, värde/skuld och faktiskt förvärv. Tidigare original/underskrifter/avstämningsposter muteras inte.

Säker publiceringsordning: den nya bakåtkompatibla appen publiceras först, därefter tillämpas direktavtal/förvärv och sist avstämningsutökningen. Den äldre appens strikta DTO-parser accepterar inte nya kategori-/settlementfält. `trade-in-rollout-compat.test.mjs` bevisar därför den nya appens faktiska actions mot gamla schemat och därefter mot samma databas efter båda migrationerna. Efter aktivering ska appen inte rullas tillbaka till den äldre DTO-parsern; behåll den kompatibla appversionen och åtgärda framåt. Äldre öppna flikar kan behöva laddas om. Migrationerna skapas och replayprovas lokalt före hosted tillämpning, med direktavtal/förvärv före avstämningsutökning. Lokal filversion ska följa den faktiskt tilldelade hosted-versionen. Migrationshistorik skrivs inte om.

## Remaining boundaries and cleanup

Inga riktiga avtal, underskrifter, fakturor, banköverföringar eller externa mejl skapas av proverna. Egen PostgreSQL-container körs med nätverk none och städas efter samtidighetsproven; övriga tester stänger sina databaser/HTTP-servrar/browserkontexter. Blocket/Wayke, vald bankpartner och extern backupplats har fortfarande externa förutsättningar och är inte aktiverade här. Full verklig produktionssignering återstår tills en autentiserad användarresa finns att verifiera.

Slutlig lokal regression: 2 158/2 158 fall i 235 testfiler och ett separat rollout-kompatibilitetsfall, totalt 2 159/2 159 utan fel eller överhoppade fall. Två separata PostgreSQL-samtidighetsfall PASS. Typkontroll och produktionsbygge PASS. Testresultaten räknas en gång; riktade delmängder adderas inte.

## Publicerad app och aktiverat databasschema

PR #66 är sammanslagen som `d7862a2d7634446ac7d88caddd1946a0a32ab863`. Produktion `dpl_AotJ1uKVADsQgznJzQx5WYdQSg5f` var READY och domänens deploymentmarkör verifierad före SQL-aktivering. Hosted migrationer är `20261113135352_direct_trade_in_acquisition` och `20261113135403_trade_in_manual_settlement_final`. Lokala filnamn matchar dessa tilldelade versioner; SQL-bytes är oförändrade. Ingen hosted migrationshistorik skrivs om.

Efterkontroll: samma tre befintliga affärer och noll signeringar, inbytesunderlag, förvärv, betalningar och leveranser. Privata tabellers RLS/grants, anonym RPC-spärr och validerad source-kind-constraint är kontrollerade. Inga nya advisor-kategorier eller antal tillkom. Befintliga [SECURITY DEFINER-notiser](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable) är oförändrade och den tidigare [leaked-password protection-varningen](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection) kvarstår.
