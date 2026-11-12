# Konto, ansökan, företagsstart och CRM – simulering 12 november 2026

Bas: main `32add2dfe75ab1e11c1c7ebfb64665f7e2bfb950`. Isolerad lokal körning; inga produktionsdata eller riktiga mejl ändrades. Arbetskopian innehåller även parallella rättningar från den samlade granskningen.

| Prov | Utfall | Omfattning |
| --- | --- | --- |
| Befintliga browserfall | **83/83 PASS**, 0 fail/skip, exit 0 | Kontosidor, aktivering, onboarding, butiksprofil, team/inbjudningar, CRM samt faktisk webbansökan → API → migrerad SQL |
| Extra viewportprov | **10/10 PASS** | Login, glömt lösenord, aktivering, nytt lösenord och företagsgranskning vid 320 och 1440 px |
| Ny sammanhängande controllerresa | **PASS**, sju kontrollpunkter | Ansökan till konto, företag, butik, kund, andra företagets isolering och teamets läsbehörighet |

Browserfallen kontrollerar bland annat aktuella roller, byte av användare/företag, okänt svar, identiskt återförsök, dubbelklick, granskning och fokus. Viewportproven verifierar tangentbord/Enter, vänteläge och blockerade dubbla anrop; inga JavaScriptfel eller riktiga POST-anrop observerades.

## Sammanhängande resa och lagrat utfall

1. Faktiskt ansöknings-API anropas två gånger med samma request-ID. **En ansökan**, en `application_received` och en `application_admin` sparas. Själva ansökan skapar inget konto.
2. Superadmin får läsa och godkänna ansökan; en vanlig godkänd användare nekas. Faktisk inbjudningsåtgärd binder **en Auth-identitet** och registrerar **en syntetisk leverantörsacceptans**.
3. Det inbjudna, ännu inte e-postverifierade kontot får inte skapa företag. Faktisk aktivering kontrollerar inbjudan/godkännande, ändrar lösenord och loggar ut. Loginåtgärden leder därefter den godkända handlaren till arbetsytan.
4. Första företagssvaret förloras efter SQL-commit. Identiskt återförsök återfår samma underlag: **ett företag, ett ägarmedlemskap och butiksprofil version 1**, med behörig efterläsning.
5. Kundsvaret förloras också efter commit. Återförsök skapar ingen dubblett: **en kund** finns i företaget.
6. En annan aktör skapar **ett andra riktigt testföretag och en andra kund**. Förfalskat företagsval ger inte första aktören profilåtkomst eller rätt att skapa kund där. Direkt SQL-läsning med den autentiserade rollen och RLS returnerar **noll främmande kunder**.
7. Det andra företagets ägare accepterar en läsbehörighetsinbjudan till det första företaget genom faktiska teamåtgärder och SQL. Personen får inte skapa kund eller läsa ägar-/administratörsskyddad butiksprofil i det företaget. **Varje företag behåller en kund**; ägarrollen i företag B ger ingen högre roll i företag A.

## UI-bedömning

Inget ytterligare blockerande konto-/butiks-/CRM-fel reproducerades i dessa prov. Juridiskt företagsnamn skiljs från butikens publika kontaktuppgifter, företagsskapande har separat granskning och representationsbekräftelse, och kontoaktivering kräver personlig inbjudan och uttrycklig villkorsbekräftelse. Kontroller och texter ryms i de uppmätta vyerna. Företagsgranskningen är texttät på mobil; kortare hjälptext är en förenklingsmöjlighet.

Skärmbilder av företagsgranskning och kontoaktivering vid 320 px har även öppnats och granskats visuellt. Övriga bilder har layout-/fokusassertioner men har inte samtliga granskats visuellt.

## Verifierade och anpassade gränser

**Faktiskt körda:** React-komponenter och formulär, API Request/Response, serveråtgärder och validering, aktuell godkännande-/rollkontroll, migrerad PGlite-SQL, utskickskö, sparade kvitton och efterläsning.

**Anpassade:** Auth-leverantörens identitets-/token-/lösenordsoperationer, utgående inbjudningstransport samt företagsval/cookies. Browserfallen och controllerresan använder separata adaptrar; detta är inte en enda autentiserad produktionssession. Verklig mejlleverans, juridisk efterlevnad och externa partnerflöden verifieras inte här. PGlite ersätter inte native PostgreSQL-samtidighetsprov.

Den första browserkörningen stoppades av miljöns nekade Linux-processanrop. Omkörningen med den avsedda kommandobehörigheten passerade; den första hook-kaskaden räknas inte som produktfel. Controllerprobens inledande adapterfel rättades utan produktändringar.

## Underlag och städning

- Browserlogg: `/tmp/trafexa-simulation-accounts-ui-unsandboxed.log` (53,656 sekunder).
- Controllerprobe och maskerat utfall: `/workspace/scratch/trafexa-simulation-accounts/controller-chain.{mjs,json}`.
- Viewportutfall och tio PNG-filer: `/workspace/scratch/trafexa-simulation-accounts/ui-viewport-probe.json` och samma katalog.

Sökvägarna avser den lokala körmiljön och är inte beständiga GitHub-artefakter. Browser och PGlite stängdes, miljövariabler återställdes och inga produktionsposter finns att städa. Denna simuleringsagent ändrade ingen produktkod.
