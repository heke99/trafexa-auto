# Kompletterande systemgranskning – 12 november 2026

## Release verdict

**RED för ett nytt godkännande av hela systemet.** Tre nya fel har reproducerats utöver F01–F09 i föregående rapport. Ett återförsök kan dubblera en fordonskostnad, ett accepterat signaturnamn kan låsa ett färdigsignerat avtal utan användbar PDF, och återinloggning tappar adminens valda undersida. Detta är en granskning; produktfelen har inte rättats.

## Execution identity

- Repository: `heke99/trafexa-auto`; appbaslinje `main`, commit `681df2dbbbc884218cd2d58b03c2ae037446c84c`.
- Lokal arbetskopia: `/workspace/trafexa-review-next`, skapad separat från den gamla lokala branchen. Ren före granskningen.
- Miljö: ordinarie managed Codex Cloud fungerar nu för terminalarbete, Node 24.19.0. Nätåtkomst och lokal lyssningsport krävde verktygets vanliga godkända eskalering.
- Target: lokalt produktionsbyggd Next-app på loopback, syntetisk Supabase-konfiguration, migrerade lokala PGlite-databaser. Ingen hosted databas ändrades.
- Deployment: lokal byggd baslinje; produktionsdeploymentens identitet lästes inte om i denna delgranskning.
- Start: 12 november 2026 kl. 19:43 Europe/Stockholm (den aktuella arbetskopian skapades 18:43 UTC). Slut: kl. 19:53 Europe/Stockholm. Exakta test-/browserutfall finns i den maskerade evidensfilen.
- Arbetet delades mellan konto/återhämtning, ekonomi, dokument och lager/kostnader. Inga produktionsutskick eller verkliga användarsessioner användes.

## Quality gates

| Gate | Resultat | Bevis och gräns |
| --- | --- | --- |
| Låst installation och `test:setup` | PASS | Projektets låsfil och båda PGlite-fixturerna |
| `npm run pretest` | PASS | Main-versionens kontroll, inte PR #60:s utökade kontroll |
| `npm run typecheck` | PASS | Ny körning mot baslinjen |
| `npm run build` | PASS | Nytt lokalt produktionsbygge |
| Befintliga riktade testfall | **127/127 PASS**, 0 skip | 48 konto/återhämtning + 41 ekonomi + 16 CSV-import + 6 kostnadsläsning + 13 företagskontext + 3 fullständiga avtalsflöden |
| Nya felreproduktioner | Tre bekräftade | Faktiska actions/proxy, migrerad SQL, PDF-renderare och kundens PDF-route |
| Faktisk Next/Chromium | Sex sid-/viewportprov | 320/1440 px; adminmålet tappas, kundkontraktets mål bevaras, glömt lösenord renderas; inga pageerrors eller overflow på dessa sidor |
| Full flat-testsvit | Inte omkörd i denna delgranskning | Föregående 1 966/1 966-resultat avser PR #60:s testklocka och den tidigare sandboxen |
| Native PostgreSQL/samtidighet och hosted Auth/Storage | NOT RUN | Lokala SQL-/IO-adaptrar ersätter inte dessa gränser |

Node-testköraren redovisade här ibland bara filantal under standardisolering, trots att callbacks kördes och fel propagerade. Fallantalen ovan kommer därför från direkt körning per fil eller `--test-isolation=none`, där de faktiska underfallen syns. Filpass räknades inte som enskilda verksamhetstestfall.

## Scenario summary

| ID | Prioritet | Aktör och trigger | Resultat |
| --- | --- | --- | --- |
| A01 | P0 | Företagsägare registrerar en kostnad; svaret tappas efter commit; identiskt återförsök | **FAIL – F10**, två rader från samma avsedda registrering |
| A02 | P0 | Kund och handlare signerar; kundens namn kräver tecken som PDF-fonten saknar | **FAIL – F11**, completed men PDF/arkiv/leverans blockeras |
| A03 | P1 | Superadmin öppnar en specifik avtalsprogramsida utan aktiv session | **FAIL – F12**, login-next blir `/admin` |
| A04 | P1 | Kund öppnar kontraktslänk utan aktiv session | PASS inom lokal Next/proxy; kontraktsmålet bevaras |
| A05 | P0 | Vanliga signeringsordningar, originalarkiv, manuell betalningsattest, leverans och länkförnyelse | 3/3 PASS med faktisk SQL/actions/rendering och kontrollerad extern IO |
| A06 | P0 | Moms, exakta pengar, betalningssaldo, journal/export och återkallad åtkomst | 41/41 PASS i granskade isolerade gränser |
| A07 | P1 | Lagerimport, företagsval och paginerad kostnadsläsning | 35/35 PASS; ingen produktionsimport |
| A08 | P0 | Aktivering, kontogodkännande och lösenords-/sessionsåterhämtning | 48/48 PASS med kontrollerad Auth; ingen riktig mottagen mejllänk |
| A09 | P0 | Verklig bank-, Blocket/Wayke- och mejlleverans | BLOCKED/NOT RUN, samma externa förutsättningar som i föregående rapport |

## P0 evidence and failures

### F10 — P1: återförsök dubblerar fordonskostnaden

- **Aktör:** verifierad ägare i ett syntetiskt företag. Faktisk action och komplett migrerad SQL med authenticated/RLS; företagskontexten och transportavbrottet är kontrollerade adaptrar.
- **Trigger:** skicka samma formulär till `createVehicleCostAction` två gånger. Första SQL-inserten committas, men dess svar kastas bort. Det andra anropet är ett avsiktligt återförsök efter felmeddelandet.
- **Observerat:** en avsedd kostnad på **1 250 kr** blir **två rader, totalt 2 500 kr**. Första åtgärden redirectar till fel, andra till framgång. Ingen separat andra kostnad valdes.
- **Orsak:** [actions.ts:144](https://github.com/heke99/trafexa-auto/blob/681df2dbbbc884218cd2d58b03c2ae037446c84c/src/lib/data/actions.ts#L144) gör en ny INSERT för varje anrop. Formuläret i `dealer-workspace.tsx:232` saknar beständig requestidentitet och sparningskvitto.
- **Konsekvens:** kostnadsunderlaget dubbleras och kan påverka fordonskalkylen. Detta prov påstår inte att en faktisk kundfaktura redan ändrats.
- **Åtgärd:** frys request-ID och payload, spara ett beständigt kvitto och återläs samma kvitto vid återförsök. En verkligt separat kostnad måste fortsatt kunna registreras med ett nytt ID, även om belopp/beskrivning är lika.
- **Regression:** rättning NOT RUN; reproduktionen passerar när felet finns. Ingen generell dubbelklicks- eller autentiserad browserresa påstås vara verifierad av serverprovet.

### F11 — P1: accepterat signaturnamn låser ett färdigsignerat avtal utan PDF

- **Trigger:** signera det faktiska avtalsflödet med kundnamnet `李文`, och lägg till bolagets signatur.
- **Observerat i faktisk actions/SQL-kedja:** båda signaturerna sparas; `status=completed`, revision 3. Verklig PDF-renderare avvisar tecknen. Kundens faktiska PDF-route svarar **503**, arkiveringen ger `unavailable`, leveransen blockeras av `original_required`, och inga lagringsobjekt skapas.
- **Orsak:** [guest-customer-actions.ts:20](https://github.com/heke99/trafexa-auto/blob/681df2dbbbc884218cd2d58b03c2ae037446c84c/src/lib/data/guest-customer-actions.ts#L20) och [contract-signing-actions.ts:80](https://github.com/heke99/trafexa-auto/blob/681df2dbbbc884218cd2d58b03c2ae037446c84c/src/lib/data/contract-signing-actions.ts#L80) accepterar namnet före definitiv signering. PDF-fontens kontroll görs först i [contract-pdf.ts:77](https://github.com/heke99/trafexa-auto/blob/681df2dbbbc884218cd2d58b03c2ae037446c84c/src/lib/documents/contract-pdf.ts#L77), när namnet skrivs vid rad 129.
- **Konsekvens:** ett normalt accepterat namn kan göra det färdigsignerade avtalet oanvändbart i nästa steg. Den frysta signaturen kan inte korrigeras genom det vanliga signeringsflödet.
- **Åtgärd:** säkerställ stöd för accepterade namn i PDF-fontkedjan och verifiera renderbarhet innan signeringen låses. Byt inte tyst ut eller förkorta personens namn.
- **Gräns:** verklig renderer/route/SQL och lagringskatalog, men Auth, Storage och mejl-API är lokala adaptrar. Inget faktiskt kunddokument eller mejl skapades i produktion. Felet är inte en RLS-bypass; den befintliga glyphkontrollen stoppar säkert, men för sent i verksamhetsflödet.
- **Regression:** reproduktion 1/1 bekräftar felet; oförändrade normala fullständiga avtalsflöden 3/3 passerar. Produktfix NOT RUN.

### F12 — P2: återinloggningen tappar superadminens undersida

- **Trigger:** öppna `/admin/annonsprogram/{companyId}?result=saved` utan giltig session.
- **Observerat:** den verkliga Next-appen går till `/login?next=%2Fadmin` vid både 320 och 1440 px. Företags-ID och undersida försvinner. Proxyprovet visar samma resultat.
- **Kontroll:** `/my-contracts?contract={id}` bevarar sitt fullständiga mål under samma prov.
- **Orsak:** [proxy.ts:33](https://github.com/heke99/trafexa-auto/blob/681df2dbbbc884218cd2d58b03c2ae037446c84c/src/proxy.ts#L33) ersätter varje adminmål med `/admin`.
- **Åtgärd:** bevara den tillåtna lokala undersidan genom inloggningen, med befintlig validering av säkra next-mål. En faktisk inloggad produktionsresa verifierades inte här.
- **Regression:** faktisk anonym browser/proxy-reproduktion; rättning NOT RUN.

## Security / tenancy

Ingen ny tenant- eller behörighetsbypass bekräftades. Tillåtna/nekade roller, scopebyte, exakta belopp och privata exportgränser ingår i de positiva provgrupperna. Authadvisors och npm audit lästes inte om här; tidigare Zod-fynd och andra kvarstående brister gäller enligt första rapporten tills de verifierats rättade.

**Separat evidensobservation:** kontoaktiveringens villkorscheckbox krävs, men den faktiska actionens verifierade IO-spår sparar inget eget policyversions-/tidskvitto; endast inbjudningsverifiering, cookierensning, lösenordsändring och utloggning observerades. Det är en avgränsad spårbarhetslucka i denna action, inte bevis på att ingen extern Auth-logg finns eller ett påstående om lagbrott.

## Database / migrations

Reproduktionerna använder projektets kompletta lokala migrationsfixturer. Kostnadsinserterna kördes som authenticated ägare med faktisk RLS. Avtalsprovet verifierade sparade signaturer, completed-revision, arkivgrind och leveransgrind. Lokal PGlite ersätter inte native PostgreSQL-lås, hosted migrationskontroll eller en produktionssession.

## External integrations

Inga riktiga mejl, annonser, bankanrop eller Storage-uppladdningar gjordes. CJK-provet fångar varje utgående HTTP-anrop i en kontrollerad transport. Ingen provideracceptans eller slutleverans påstås utifrån dessa lokala utfall. Partner- och andra ofärdiga flöden från föregående rapport återlistas inte som nya fynd.

## Performance observations

Det nya lokala bygget och riktade prov kunde köras. Inga nya lastprov, query plans eller produktionslatensmätningar gjordes. Browserkontrollen gav inga pageerrors eller horisontell overflow på de sex kontrollerade vyerna. Mobilens glömt-lösenord-sida inspekterades även visuellt; tidigare publika mobilfel kvarstår som separata redan kända fynd.

## Cleanup

Alla syntetiska PGlite-databaser och browserinstanser stängdes. Den lokala Next-servern stoppades efter kontrollen. Inga produktionsposter finns att städa. Projektets produktkod är oförändrad; tilläggen gäller rapport, maskerad evidens och fristående reproduktionsskript.

Bevis och körbara reproduktioner finns i [verification/20261112-additional](verification/20261112-additional/README.md). Exit 0 från ett sådant skript betyder att felet reproducerats, inte att det är rättat.

## Remaining blockers

1. Förhindra definitiv signering innan den accepterade informationen kan renderas till avtalsoriginal.
2. Gör kostnadsregistreringens återförsök idempotent med beständigt kvitto.
3. Bevara adminens valda undersida genom återinloggning.
4. Besluta hur kontoaktiveringens villkorsversion/tidpunkt ska kunna styrkas.
5. Rätta och verifiera tidigare fynd, och kör återstående riktiga Auth-/partner-/bank-/mejlgränser med avsedda testkonton innan full releasebedömning.

## Final conclusion

Tre nya flödesfel är belagda. 127 befintliga riktade testfall passerar, och den faktiska lokala browserresan bekräftar adminens navigeringsfel. Felen är dokumenterade med återkörbara prov; inga produktfixar eller produktionsändringar har utförts i denna granskning.
