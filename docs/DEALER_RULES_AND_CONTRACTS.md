# Trafexa Dealer: regler och integrationskontrakt

Fortsättningen den 15 oktober beskriver [beständiga återförsök, samlad dokumentöversikt, manuell avstämning, leverans och första opt-in-handlarnätverket](DEALER_NEXT_STEPS_20261015.md). Det uppdaterade kontraktet gäller dessa funktioner; tidigare fastexter nedan kan beskriva historiska checkpoints. Manuell avstämning är inte bankverifiering, och leverans av inbyte/skuldlösen är fortsatt spärrad.

Detta dokument anger gränserna som huvudappen, databasändringar och providerintegrationer ska följa. Det kompletterar [genomförandeplanen i plan-PR:n](https://github.com/heke99/trafexa-auto/blob/docs/trafexa-execution-plan-20261013/docs/IMPLEMENTATION_PLAN.md), [DocuSeal-integrationen](DOCUSEAL_INTEGRATION.md) och [signeringsledgerns RPC-kontrakt](../supabase/README_SIGNING.md). Datum: 13 oktober 2026.

Huvudbygget sker i den befintliga Next.js-appen på `codex/trafexa-dealer-continuation-20261013`. Målet är GitHub/Vercel **trafexa-auto**, Supabase **Trafexa dealer**, projekt `buqdtssxrotkzndublrt`, och `app.trafexa.com`. Sourcing-tabellerna från [utkast-PR #2](https://github.com/heke99/trafexa-auto/pull/2) är referensarbete och ska inte införas som en parallell företagsmodell.

## Vad underlaget bevisar

| Underlag | Vad som är känt | Begränsning |
| --- | --- | --- |
| Återhämtad originalplan, redovisad i genomförandeplanen | Faser 0–10 och produktområdena lager, kunder, affärer, avtal, köpfinansiering, ekonomi, lagerfinansiering och handlarnätverk | Dokumentet ersätter inte pilotbeslut eller partneravtal |
| Befintlig Dealer-databasmetadata, samordnarens färska audit 2026-10-13 | Företag, medlemskap, roller, grundtabeller och dokumentpolicyer; dokument read/insert är `owner/admin/finance` | Metadata bevisar inte fungerande UI, Storage-åtkomst eller genomförda kundaffärer; inga kundrader lästes |
| Lokala signeringsmoduler, migration och testspecifikationer | Ett additivt kontrakt för förberedelse, dispatch, inbox och arkivering finns | Lokal verifiering är inte hosted migration, faktisk providerleverans eller huvudappsintegration |
| Lokalt tillgänglig `origin/main` | Ref pekade vid denna läsning på `e37c57c18f0848368bc184e89aab0e587083df6a`, med den äldre statiska webbplatsen | Ref har inte hämtats om i denna granskning och är inte bevis på senaste remote HEAD eller produktionsversion |

Nedanstående regler är integrationskrav. De är inte en rapport om att hela appen redan uppfyller dem. Där grundschemat saknar ett tillstånd eller en integration behövs en granskad ändring och verifiering innan det kan visas som verkligt utfall.

## Företagskontext och roller

Varje serveroperation ska bära ett explicit `company_id`. Den verifierade användaren måste ha aktivt medlemskap i just det företaget, företaget måste vara aktivt och rollen måste tillåta operationen. Ett företag som valts i UI, en cookie eller ett requestfält är ett önskemål om arbetsyta; servern och RLS avgör åtkomsten. Använd aldrig första medlemskapet som tyst standard för en ändringsoperation.

Vid företagsväxling ska företagsbundna listor, cache, formulär och mutationskontext uppdateras tillsammans. En mutation som startades i företag A får inte vid ett senare UI-byte sparas i företag B. Servern ska kontrollera aktuellt medlemskap även om användaren hade rätt roll när formuläret öppnades. Spärrat företag eller medlemskap ska neka fortsatt åtkomst.

Rollerna är `owner`, `admin`, `sales`, `finance` och `viewer`. Befintliga per-tabell-policyer och grants ska återanvändas; rollnamnet i sig tilldelar inga nya befogenheter.

### Kontrollerad rollmatris 2026-10-15

Matrisen sammanfattar kontrakten efter RBAC-granskningen och användarens beslut att begränsa intern fordonsekonomi till ägare, administratör och finansansvarig. Den ger inga nya skrivrättigheter till finansrollen. Aktivt och godkänt konto, aktivt företag och aktuellt medlemskap krävs där respektive serverkontrakt anger det.

| Funktion | Ägare | Administratör | Säljare | Finansansvarig | Läsbehörighet |
| --- | --- | --- | --- | --- | --- |
| Läsa allmänna lageruppgifter och försäljningspris | Ja | Ja | Ja | Ja | Ja |
| Läsa inköpspris, inköpsmoms, interna fordonskostnader och vinstkalkyl | Ja | Ja | Nej | Ja | Nej |
| Registrera bil med inköpsuppgifter och importera lager | Ja | Ja | Nej | Nej | Nej |
| Ändra interna fordonskostnader och kalkylmetadata | Ja | Ja | Nej | Nej | Nej |
| Ändra utpris, kunder och affärer | Ja | Ja | Ja | Nej | Nej |
| Skapa finansintresseanmälan | Ja | Ja | Ja | Ja | Nej |
| Läsa privata avtal och signeringsunderlag | Ja | Ja | Nej | Ja | Nej |
| Hantera butik, personal och annonsanslutningar | Ja | Ja | Nej | Nej | Nej |
| Ändra annonser | Ja | Ja | Ja | Nej | Nej |
| Plattformens konto-/företagsadministration | Separat behörighet | Separat behörighet | Separat behörighet | Separat behörighet | Separat behörighet |

Finansärenden har en ytterligare läsgräns: säljaren läser sina egna ärenden, finansansvarig företagets ärenden. Ägarbyte följer det separata tvåpartsflödet; personaladministration och plattformsadministration får inte användas för att direkt tilldela en ägarroll.

Användaren har uttryckligen beslutat att säljare och läsare inte får läsa intern fordonsekonomi. Skyddet ska gälla direkta kolumnfrågor och relationsfrågor, register och valalternativ, serverrenderad data, dashboardsummor, kostnader och kalkylfunktioner. Dolda inköpsbelopp representeras med `null`, aldrig ett påhittat nollbelopp. Gränssnittet får inte montera privata ekonomipaneler för dessa roller. Lagerintag/import kräver inköpsuppgifter och begränsas därför till ägare och administratör; säljarens utpris, foton, annonser, kunder, affärer och finansintresseanmälan behålls.

Kundens avtalade försäljningsvillkor, inklusive inbytesvärde och mellanskillnad, bevaras i offerter och avtal. Ett inbytesvärde kan senare motsvara den nya lagerbilens inköpspris och därmed redan vara känt genom kundaffären. Policyn skyddar interna lager-/kostnadsfält; den förvanskar inte historiska kundavtal eller utlovar att redan kända affärsvillkor kan göras okända. Annonskanalens granskade publiceringsavgift och kundens finansieringsbelopp är egna försäljnings-/publiceringsvillkor och döljs inte som intern fordonskostnad.

Befintlig finansbehörighet i privata inköps-/skickunderlag behålls. Ekonomiläsning innebär inte ny generell skrivrätt i lager, CRM eller kalkylmetadata. Alla företagsroller är separata från plattformens privata administratörsregister.

Äldre formulär för ny bil, ny kund och finansintresseanmälan skickar nu `expected_company_id`. Servern jämför det med aktuell vald företagskontext före affärsskrivning. Saknat eller avvikande företags-ID avvisas; ett öppet formulär för A får inte efter företagsbyte skriva i B. RLS och serverns aktuella rollkontroll avgör fortsatt behörigheten till målföretaget.

Nästa steg i RBAC-arbetet är gemensamt namngivna rättigheter för UI och server, med tester som jämför dem mot SQL:s slutliga auktorisering. Separata plattformsroller för exempelvis support och ekonomi är ett nytt behörighetskontrakt och ingår inte i denna matris.

| Operation i avtalsdelen | Tillåten gräns |
| --- | --- |
| Läsa/införa grunddokument | `owner/admin/finance` enligt den färska metadataauditen |
| Läsa signeringsjobb, godkända dokumentversioner och företagsmallar | Aktiv `owner/admin/finance` inom samma företag |
| Förbereda signeringsjobb | Aktiv `owner/admin/finance` med verifierad användar-JWT; `sales/viewer/anon` nekas |
| Godkänna/registrera mallrevision | Serverns service-RPC efter kontroll av aktiv `owner/admin`; klienten skriver inte mallregistret |
| Registrera godkänd dokumentversion | Service-RPC efter verifiering av aktiv `owner/admin/finance`, dokumentkontext och faktiska privata bytes |
| Dispatch, providerbindning, inbox och arkivövergång | Serverworker med smala service-RPC:er; inga motsvarande direkta användarskrivningar |

Service/secret-nycklar och providerhemligheter stannar på servern. Service-åtkomst får inte ersätta användarens åtkomstkontroll. Metadata från klient, signer eller provider väljer aldrig företag, affär eller användarroll. RLS, grants och företagsbundna referenser ska verifieras med direkta API-/SQL-anrop, inte bara genom dolda UI-knappar.

**Acceptans:** två aktiva testföretag är isolerade; ett medlemsskap i A ger inte åtkomst till B; fel roll, spärrat medlemskap och spärrat företag nekas; en ändrad `company_id`, affärsreferens eller dokumentväg kan inte flytta data över företagsgränsen. Samma kontroller gäller för privata filer och signerade länkar.

## Affär, lager och reservation

Den verifierade grunden har `vehicles`, `stock_items`, `vehicle_costs`, `customers` och `deals`. `deals.status` tillåter `draft/reserved/cancelled`. Signering, kreditbeslut, leverans och avslut får inte skrivas som nya statusvärden utan schema- och domänkontrakt som huvudagenten först integrerar.

Kund, lagerpost, affär, offert och dokument måste bindas till samma företag. En referens som finns men ägs av ett annat företag ska behandlas som otillåten. Servern ska använda rätt lagerpost och affär, inte lita på ett klientvalt VIN, kundnamn eller pris som identitetsbevis.

Reservation ska avgöras atomärt i databasen. Två samtidiga förfrågningar om samma tillgängliga lagerbil ska ge högst en aktiv reservation. Ett lyckat UI-svar kräver att reservationen faktiskt sparats; en förlorad tävling ska ge ett kontrollerat konfliktutfall. Förlängning, utgång och frigörande måste kontrollera rätt reservation och aktuell version, så ett sent anrop inte frigör en senare reservation.

Innan reservation aktiveras ska affärsspåret fastställa giltighetstid, tidskälla, vilka roller som får förlänga/frigöra och vad avbokning gör med lagerstatus. Dessa värden är ännu inte specificerade av detta dokument. Nätverkets B2B-reservationer ska senare följa samma exklusivitet för den säljande handlarens lagerbil.

**Acceptans:** två samtidiga reservationer testas mot faktisk databastransaktion; dubbelreservation nekas; förlängning och frigörande från gammal version nekas; utgång kan återställa tillgänglighet utan att radera affärshistorik; företag B kan inte reservera en privat bil från A genom att gissa ett ID.

## Offertversion och godkänt avtalsunderlag

`offers` har positiv version och en `snapshot`. Huvudappen ska välja en exakt företags- och affärsbunden offertversion för ett godkänt renderunderlag. Snapshoten ska innehålla de uppgifter som faktiskt behövs för samma PDF och fältmappning: parter, fordon, priser, beloppsenhet/valuta, momsmodell, relevanta villkor och eventuell inbytesuppgift. Exakt fältmodell ägs av offert-/affärsspåret och ska dokumenteras innan godkännande aktiveras.

En godkänd version är oföränderlig. Ändrat pris, kund, bil, parter eller avtalsvillkor kräver nytt godkänt underlag och ny dokumentversion. Ett redan förberett jobb ska behålla sin ursprungliga dokument- och mallbindning. Offertversion, dokumentversion och signeringsjobbets CAS-version är olika räknare och får inte blandas ihop.

`TrustedApprovedRenderReader` ska läsa det servergodkända underlaget och faktiska privata källbytes. PDF och providerfält ska komma från samma snapshot. Godkännandet får inte byggas genom att kopiera renderfält från den request som begär signering. Faktisk SHA-256 för källbytes, dokumentväg, godkända parter och mall-ID/version/hash registreras med det service-only-kontrakt som ledgern anger.

**Acceptans:** ändring av signer, pris, underlag, mallrevision eller affär efter godkännandet nekas för samma version; ny avsiktlig signering kräver ny godkänd dokumentversion; historiskt identisk retry returnerar samma jobb. Ett PDF-hashvärde visar bytebindning, men bevisar inte ensamt att providerfält och offert har identisk affärsbetydelse. Den kopplingen ska granskas i renderintegrationen.

## Bilköpeavtal och signeringsgräns

Nuvarande `documents` har `purchase/contract/finance/other` men ingen signeringsstatus. Ledgern stöder endast `purchase` och `contract`. `contract` kräver exakt dokumentkopplad affär; `purchase` får sakna affär och en eventuell affär måste fortfarande exakt matcha dokumentet. Dokument av typen `finance` ska nekas i denna DocuSeal-förberedelse.

Signeringens tillstånd finns i den additiva ledgern, inte i grunddokumentet eller affärens befintliga status:

`prepared` → `dispatching` → `awaiting_signatures` → `awaiting_archive` → `completed`.

- Dispatch sparas och claimas atomärt före provider-POST. Utskick är avstängda tills huvudintegrationen uttryckligen aktiverar dem.
- Timeout, krasch, utgången dispatchlease och andra oklara POST-utfall blir `outcome_unknown`. De kan inte automatiskt dispatchas igen. Servern ska avstämma ett möjligt befintligt provideruppdrag innan någon ny process beslutas.
- `form.completed` gäller endast en part. `submission.completed` gäller hela uppdraget och leder till väntan på arkivering.
- `completed` kräver verifierad providerbindning, rätt dokumentversion/källhash och faktiskt privat lagrad signerad PDF plus revisionsbevis med vägar och checksummor.
- Provideravvisning, avböjande och utgång följer sina kontrollerade terminala tillstånd. Dubbla eller sena händelser får inte återöppna ett slutfört jobb.
- Webhookens HMAC verifieras över exakta råbytes före JSON-tolkning. Beständig inbox deduplicerar; okända provider-ID:n quarantinas för uttrycklig avstämning. Metadata är inte lokal dokumentbindning.

Den fullständiga RPC-signaturen, felkoderna, immutable-bindningarna och övergångarna finns i [README_SIGNING](../supabase/README_SIGNING.md). Integrationen får inte omtolka `40001`-konflikt eller `outcome_unknown` till blind providerretry.

**Acceptans:** bara en part klar visas inte som hela avtalet signerat; falsk/ogiltig callback, fel provider-ID och saknad arkivfil kan inte ge `completed`; en verifierad callback utan lokalt jobb får inte skapa affär eller signeringsbindning; arkiv kan inte läsas över företagsgränsen. UI visar okänt utfall och väntan på arkiv som egna tillstånd. DocuSeal-signering är inte bevis på BankID-identifikation.

## Kreditavtal och finanspartner

Bilköpeavtal och finanspartnerns kreditavtal är separata dokument- och beslutsprocesser. Ett signerat bilköpeavtal ger inget kreditbeslut, ingen utbetalning och ingen verifierad kreditsignatur. Finanspartnern är källa för kreditprövning, beslut, villkor och finansavtal. Huvudappen får inte härleda dessa från lokala formulär eller DocuSeal-jobb.

| Befintligt fält/tillstånd | Betydelse i integrationen | Vad det inte bevisar |
| --- | --- | --- |
| `finance_partners.unavailable` | Partnerprodukten är inte tillgänglig i plattformen | Fungerande ansökningskanal |
| `finance_partners.onboarding` | Partneranslutning förbereds | Aktiv produkt eller godkänd handlare |
| `finance_partners.active` | Partner kan användas enligt verifierad aktivering | Att varje handlare eller finansärende är godkänt |
| `dealer_approvals.pending` | Handlarens anslutning för exakt partner/produkt väntar | Kreditbeslut för kund eller lagerbil |
| `dealer_approvals.approved` | Handlaren får använda den uttryckliga produkten `purchase` eller `stock` enligt partnerunderlag | Godkänd kundkredit, beviljad lagerlimit, signerat kreditavtal eller utbetalning |
| `dealer_approvals.rejected/suspended` | Produkten är nekad/spärrad för handlaren | Rätt att fortsätta skicka nya ansökningar |
| `finance_applications.intake` | Lokala ansökningsuppgifter finns | Att partnern tagit emot dem |
| `finance_applications.awaiting_partner` | Ärendet väntar på partnerkanal/hantering | Kreditgodkännande |
| `finance_applications.submitted` | Ansökan har status inskickad; övergången måste ha verifierat partnerkvitto enligt kanalens kontrakt | Beslut, kreditavtal eller utbetalning |
| `finance_applications.withdrawn` | Ärendet har dragits tillbaka enligt det beslutade kanalflödet | Att ett redan utbetalt lån är återbetalt eller avslutat |

Den nuvarande ansökningstabellens fyra statusar representerar inte kreditbeslut. `approved` i `dealer_approvals` får aldrig visas som kundens "kredit godkänd". Partnerbeslut, komplettering, erbjudna villkor, kreditavtal, utbetalning och lagerfinansieringens lösen kräver ett eget dokumenterat kontrakt, källa och schema innan sådana utfall visas.

Köpfinansiering (`purchase`) av slutkunden och lagerfinansiering (`stock`) av handlaren är skilda produkter. Godkännande för den ena ger inte tillgång till den andra. Partnerns API, portal eller annan avtalad kanal måste vara verkligt bekräftad; sparad kontakt, mockat svar eller manuell flagga räcker inte som integrationsbevis.

**Aktiveringsvillkor:** aktivt företag/medlemskap, tillåten användarroll enligt finansmodulens verifierade policy, aktiv partner, giltigt handlargodkännande för exakt produkt och fungerande avtalad kanal. Partneravtalet ska klargöra ansvar, informationshantering, ersättning, återkrav och eventuellt garantiansvar. Detaljer om kreditstatus och kreditavtal beslutas tillsammans med partnern.

**Acceptans:** fel produktgodkännande och spärrad handlare nekas; timeout i ansökningskanalen ger ett kontrollerat avstämningsläge; dubbla kvitton/händelser ger inte dubbla ansökningar eller beslut; lokalt intake visas som sparad ansökan; UI visar inte kredit godkänd, kredit signerat eller utbetalt utan verifierat partnerunderlag.

## Faktiska beroenden och fasernas gates

Faser kan byggas parallellt men beroendena avgör när de kan aktiveras och räknas som klara. "Gate" betyder dokumenterat bevis från angiven miljö och commit, inte att en skärmbild eller adapter finns.

| Fas | Beroende för integration/aktivering | Gate och acceptans |
| --- | --- | --- |
| 0 Produkt/partnerupplägg | Återhämtad plan och pilot-/partneransvar | Pilot, första affärsflöde och importformat är fastställda. Partnerprodukter har verifierad kanal och ansvar innan aktivering; partneravtal kan fortsätta medan grundappen byggs |
| 1 Företag/åtkomst | Befintliga `companies/memberships` och rätt Supabaseprojekt | Explicit företagsval, aktivt medlemskap, roller och RLS är testade med två företag och spärrade aktörer. Detta blockerar företagsbundna modulers aktivering |
| 2 Lager/inköp | Fas 1, belopps-/momsmodell och importkontrakt | Import granskas före sparande; felrader/dubbletter hanteras; priser och kostnader bevarar enhet, valuta och momsmodell. Lagerdata har företag och spårbar källa |
| 3 Kunder/affärer | Fas 1–2 och fastställd reservations-/offertmodell | Kund och lagerbil binds till rätt affär/företag; konkurrerande reservationer är säkra; godkänd offertversion är oföränderlig |
| 4 Avtal/signering | Fas 1 och godkänt dokumentunderlag från fas 2–3 där affär krävs; additiv migration, privata filer, provider/licens | Renderreader, mallreader, serverroutes, worker, inbox, avstämning och arkiv är integrerade och preview-testade. Delunderskrift eller providercompletion utan privat arkiv ger inte färdig lokal signering |
| 5 Köpfinansiering | Fas 0 partneravtal, fas 1 åtkomst, relevant affär/kund/bil och exakt `purchase`-godkännande | Faktisk kanal, ansökningskvitto, komplettering/beslut och kreditavtal följer partnerkontrakt; okända/dubbla utfall är testade. Fasen är inte klar med enbart intake |
| 6 Ekonomi/leverans | Fas 2–4; fas 5 när affären faktiskt finansieras; dokumenterad betalnings-/bokföringskälla | Fakturaunderlag, betalningsläge, resultat och leverans kan spåras till rätt affär, kostnader och dokument. Tillstånd för leverans/avslut införs uttryckligen; signering betyder inte betalt |
| 7 Lagerfinansiering | Fas 0 och 1–2, partnerns `stock`-godkännande och särskilt limit-/lösenkontrakt | Verifierad limit, finansierade lagerbilar, kostnader och lösen; en såld bil löses inte dubbelt. `purchase`-godkännande ersätter inte `stock` |
| 8 Handlarnätverk | Fas 1–3 och kontrakt för publicering/åtkomst/B2B-reservation | Endast uttryckligt valda bilfält delas; kunddata, inköpspris och finansdokument förblir privata. Reservation mot samma lagerbil är exklusiv även över företag |
| 9 Pilot/lansering | Sammanhängande fas 1–6 samt de partner-/nätverksfunktioner som pilotens scope omfattar; körbar deployment | Affärskedjan bil → kund/offert → avtal/signering → leverans verifieras i samma miljö. Finansflöde måste verifieras om det ingår. Support, övervakning, återställning och säkerhetskontroller har bevis; ofärdiga integrationer hålls avstängda |
| 10 Vidare integrationer | Stabil grund och separat kontrakt per ny partner/dataleverantör/bokförings- eller dokumenttjänst | Varje integration har källägare, datamappning, åtkomst, dubblett-/felhantering och verkligt verifierat utfall. En installerad SDK räcker inte |

En finansieringsfri första affär kan integreras genom fas 1–4 och 6 medan partneravtalet färdigställs. Det betyder inte att fas 5 eller finanspilot är klar. Reservationsregler, moms/VMB, avtalsvillkor och partneransvar behöver aktuellt, faktiskt underlag; detta dokument fastställer inga egna juridiska eller kreditmässiga villkor.

## Överlämning och kvarstående bevis

Huvudagenten ansvarar för att sammanföra modulerna med samma företag, roller, affärer och lockfil i Next.js-appen. Denna dokumentleverans innehåller inga live databasändringar, utskick, kreditansökningar, DNS-ändringar eller produktionsaktivering.

Före signeringsaktivering återstår integration och verifiering av godkänd offertrendering, faktiska provider-mallbytes/fältschema, migrationsordning mot Dealer-grunden, användar-JWT/serverwrappers, workerdrift, beständig webhook-inbox, privat `dealer-documents`-bucket med Storage RLS, godkända downloadorigins och UI för alla tillstånd. Utgåva, driftmodell och providerlicens ska vara kontrollerade; BankID och notifieringar har egna kontrakt. DocuSeal-utskicken i denna leverans har e-post/SMS avstängda.

Före finansaktivering återstår partner-/handlargodkännanden per produkt, verklig kanal och kontrakt för kreditbeslut, kreditavtal, utbetalning och eventuell limit/lösen. Före lansering återstår reproducibelt huvudappsbygge, rätt preview/projektkonfiguration, webbläsarflöde, hosted RLS/Storage-kontroller och pilotens återställningsbevis.

Varje leveransrapport ska ange commit/PR, testmiljö, kontrollerade flöden och kvarstående gates. Lokala fixtures, rapporterade testresultat, katalogmetadata och faktisk provider-/pilotverifiering redovisas separat. Ingen fas markeras färdig genom enbart detta dokument.
