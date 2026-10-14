# Implementationsstatus

## Kontaktlogg och kunduppföljningar, 14 oktober 2026

Fortsättning från main `b05ec029c6d6bb608985dc8a58781e87ea52fc8a`: kunder kan öppnas från kundtabellen eller företagets uppföljningar. Kontaktloggen registrerar telefon, e-post, möte eller anteckning med kontaktdatum, sammanfattning och valfritt uppföljningsdatum. Fler­radsanteckningar stöds; historiken sorteras på kontaktdatum även när äldre kontakter läggs in senare. Författare visas som Du/Kollega utan andra användares Auth-e-post.

Översikten och kundvyn hämtar företagets väntande uppföljningar med dagens datum i Europe/Stockholm och filter för förfallna/dagens, kommande och alla väntande. Databasfrågan omfattar hela företaget, inte arbetsytans 500 kundrader. Datum-/ID-baserad paginering och klick till en kund utanför tabellurvalet är verifierade. Granskad klar-/avbrottsmarkering kräver motivering och versionskontroll; orsaken och oföränderligt kvitto lagras i privat audit. Ett kvitto ersätter inte en färsk läsning av aktuell status.

Färsk Auth, faktisk företagsstatus och aktivt medlemskap kontrolleras före och efter serveråtkomst. Ägare/admin/säljare skriver, ekonomi/läsroller läser. Företags-/kundbyte, återkallad åtkomst och versionskonflikt hanteras utan att gammal kontaktdata används för en ny ändring. Inga e-post-, SMS-, partner- eller schedulerutskick aktiveras.

Verifiering: **340/340 apptester**, inklusive tio nya actiontester, fyra faktiska CRM-browsergrupper och dealer-integrationens kundval/nekad åtkomst/företagsbyte. Produktionsbygge och TypeScript passerar. **7/7 PostgreSQL/PGlite-grupper** kontrollerar faktisk migrationskedja, två företag/roller, datum, flerradssammanfattning, privata tabeller, återförsök, CAS och kronologisk paginering över 503 poster.

Hosted applicerat: `20261014094251_crm_contact_storage`, `20261014094301_crm_contact_reads`, `20261014094310_crm_contact_mutations`. Hosted rollbacktest PASS för kontakt, exakt återförsök, företagsgemensam förfallen uppföljning och auditerad färdigmarkering. Efterkontroll: noll kvarvarande testidentiteter/företag/kunder/kontakter/auditposter. Advisors har inga nya säkerhetsvarningar; avsiktliga privata RLS-listor och tidigare lösenordsskyddsvarning skiljs från denna leverans. Inloggad produktionsbrowser och verklig multi-connection-låsväntan är fortsatt separata verifieringsgränser.

## Webbansökningar och integritet, 14 oktober 2026

Fortsättning från main `74b0e9b7df559ced10229775025c1008107b6abb`: webbansökan kräver kontaktens namn, e-post, telefon, företagsnamn, svenskt organisationsnummer med kontrollsiffra, sökta tjänster och beskrivning. En omarkerad bekräftelse av läst integritetsinformation sparar policyversion och serverns mottagningstid. Den är inte ett generellt dataskydds- eller marknadsföringssamtycke. Stabilt begärans-ID och exakt kvitto förhindrar dubbletter och falsk framgång vid återförsök.

Superadminens **Inkomna ansökningar** visar alla uppgifter, äldre ofullständiga förfrågningar, status och historik. Behörighet bygger på faktisk verifierad Auth och det privata UUID-registret. Statusändring och uttryckligen granskad radering använder versionskontroll. Radering tar bort ansökarens uppgifter och ärendehistorik; ett begränsat pseudonymiserat tekniskt kvitto förhindrar återskapande vid sena återförsök. Ingen ansökan skapar automatiskt konto, kreditbeslut eller utskick till partner.

Cookiepolicy och integritetspolicy beskriver faktiska uppgifter, rättsliga grunder, lagringskriterier, rättigheter och leverantörsöverföringar. Endast nödvändiga cookies används; informationsrutan är inget samtycke till spårning och blockerar inte ansökan. Policybekräftelsen kan återöppnas och glömmas utan att autentiseringscookies raderas. Trafexa Nordic AB, 556855-4884, och kontaktadressen info@trafexa.com är bekräftade av ägaren. [WEB_PRIVACY_OPERATIONS](WEB_PRIVACY_OPERATIONS.md) beskriver verksamhetens återstående rutiner och avtalskontroller; policytext certifierar inte full GDPR-efterlevnad.

Verifiering: **325/325 apptester**, produktionsbygge och TypeScript PASS. **12/12 PostgreSQL/PGlite-grupper** passerar den faktiska migrationskedjan. Hosted rollbacktester verifierar obligatoriska fält, privat åtkomst, exakta återförsök, superadmindetaljer, status-CAS, radering och spärr mot återskapande. Efterkontroll: noll kvarvarande testkonton, ansökningar och raderingskvitton.

Hosted applicerat: `20261014075213_web_application_schema`, `20261014075229_web_application_submission`, `20261014075241_web_application_admin`, `20261014075445_web_application_erasure`. Migrationsverktygets requestState-fel löstes genom att dela samma testade förändring i mindre beroendeordnade migrationer. De gamla inkompletta submit-RPC:erna är stängda. Äldre pending signering/arkiv är inte applicerade. Inga nya säkerhetsvarningar; tidigare avstängt läckt-lösenordskydd kvarstår. Full inloggad produktionsbrowser verifieras separat från rollback och lokala UI-fixtures.

Färsk kontroll visar att `hekmat.h@trafexa.com` har aktiv förgodkänd reservation men ännu inget Auth-konto eller aktiverat UUID-registry. Ägaren registrerar adressen via `/register?next=/admin`, verifierar e-post och aktiverar den förgodkända åtkomsten i `/admin`. Detta skickar inga kontomejl från agenten.

13 oktober 2026 • aktuell leverans på `feat/vehicle-ads-and-calculations-20261013`, från main `0604605c9a96ca02c1a5d874e3d69b6288d4ed0b`; tidigare checkpoints redovisas nedan

## Annonskonto, privata fordonsbilder och kalkyl, 13 oktober

Implementerat lokalt: Annonskonto med faktiska lagerbilval, pris från servern, versionsbundna utkast/klarmarkering, bildval, registreringsnummeropt-in, granskningssteg och explicit bekräftade kanalutskick. Högst 50 poster per sida; roller och aktuell användare/företagskontext läses på servern. Ägare/admin begär kanalanslutning med icke-hemlig kontoreferens; säljare hanterar annonser, finans/läsroller läser. Historiska kvitton används inte som aktuell status: ny serverläsning krävs och återkallad åtkomst rensar UI-data. Okänt nätverksutfall behåller samma begärans-UUID.

Privat bilduppladdning och återläsning är implementerade med JPEG/PNG/WebP, 10 MiB/20 bilder, avkodning, orienteringsnormalisering och återkodning till samma format utan metadata. Registrering sker efter objektuppladdning och verifieras mot aktuellt Auth/företag igen. Ett privat orphan-objekt kan bli kvar om SQL-registrering nekas eller utfallet är okänt. Ingen användar-DELETE eller automatisk städning tillåts; det undviker register/delete-race och bevarar identiska retries. Fotoarkivering ändrar nya bildval men bevarar tidigare annonsversioners underlag. Retention/avstämning är en kvarstående driftuppgift, inte en påstådd schemalagd funktion. Supabases globala Storage-UPDATE-grant innebär inte overwrite i denna bucket: det saknas UPDATE/ALL-policyer och uppladdningen använder `upsert:false`.

Exakt fordonskalkyl använder serverhämtade decimalsträngar i heltalsören och `BigInt`, versionsbundna momsunderlag och separata värden för okänt (`null`) och bekräftat nollavdrag. Individuell VMB utgår från positiv försäljning-minus-inköp; andra kostnader minskar inte VMB-marginalen. Vanlig moms använder bekräftat inköps-/kostnadsavdrag. Saknad momsmodell eller underlag ger inget påhittat resultat efter moms. Företagets totalsummor och bilkalkyl är intern analys, inte bokföring, momsdeklaration eller förenklad VMB.

**Providergräns:** användaren har bekräftat att partneråtkomst saknas. Blocket/Wayke och workerdrift är förberedda/inaktiva. Ingen annons har skickats, ingen offentlig testannons skapats och inga credentials eller heartbeat-jobb aktiverats i denna lokala leverans. `requested` är en anslutningsförfrågan; `verified` kräver separat betrodd bindning. Köning kräver dessutom färsk dispatcher-readiness. `queued`, `submitted` och `published` är separata tillstånd och publicering kräver leverantörsbevis. Publicerad annons behöver inte ha en URL; en eventuell länk kommer från verifierad providerdata och konstrueras aldrig från gissningar.

Blocketprototypen stoppar senare annonsversioner, inklusive det verkliga första klarmarkerade utkastets version 2. Beständig extern leveransrevision, CREATE/UPDATE och request-korrelerat bevis är återstående aktiveringskrav. Waykes DMS-/medie-/publiceringskontrakt återstår. Implementerad exportbridge i `src/lib/vehicle-photos/export-media.ts` normaliserar faktiska privata bytes, lagrar utan overwrite separat i `ads-export-media`, återläser/hashverifierar och kontrollerar privata bucketar före eventuell länkutfärdning; `ads-vehicle-photos` signeras aldrig direkt externt. Bridgen är avstängd som standard och läser inga credentials: aktivering kräver betrodd injicerad serverklient. Länkgiltighet är normalt 48 timmar och minst 24 timmar ska återstå vid överlämning. Tidskravet är lokal policy inför partnerbekräftelse, inte ett verifierat providerlöfte. Exportobjekt städas inte automatiskt när länken går ut. Samma-format-normalisering är inte WebP→JPEG-konvertering och Blocketval med WebP spärras. [Integrationsunderlaget](ADVERTISING_INTEGRATIONS.md) beskriver providerkrav och driftgräns.

| Kontroll i den aktuella leveransen | Bevis och gräns |
| --- | --- |
| Faktisk annons- och kanal-UI med faktisk privat Gallery | PASS 6/6 Chromiumfall i `tests/advertising-ui.test.mjs`, inklusive 390 px, Strict Mode, snapshot-/kanalbekräftelse, okänd transport med samma UUID, köad kontra publicerad, saknad anslutning, WebP-spärr och återkallad åtkomst. Actiontransport är kontrollerade fixtures och alla page-HTTP-anrop blockeras |
| Annonsactions och DTO-gränser | API-agenten rapporterar PASS 19/19 actual-moduleloader-fall; detta är lokal serverkontraktsverifiering, inte hosted RPC eller partneråtkomst |
| Faktisk exportnormalisering och privata filbytes | PASS 9/9 via `node --test --test-isolation=none tests/advertising-export-media.test.mjs`: riktig JPEG/PNG/WebP-avkodning/metadata-rensning, faktisk filåterläsning/hash, oföränderligt återförsök, falskt scope/MIME, privata bucketar och exakt betrodd länk. Storage-transport är fixtures; inga hosted exportfiler eller partnerlänkar skapas |
| Samlad rootverifiering | PASS 305 appbeteenden efter riktad omkörning av den uppdaterade returvägsregressionen, inklusive faktisk Chromium-UI, 18 bildflödestester och 9 exporttester. Produktionsbygge och TypeScript passerar. Separat PASS 11/11 annonsdatabasgrupper och 7/7 kalkyldatabasgrupper mot faktisk migrationskedja; hosted rollbackkontroll av RPC-/Storage-gränser passerar. Inloggad produktions-CRUD och externa leverantörsflöden ingår inte i detta bevis |
| TypeScript och dokumentationskontroll | `npm run typecheck` och `git diff --check` PASS efter Gallerykoppling och uppdaterade kontrakt |
| Hosted migration/readback | Samordnaren bekräftar applicerade `20261013212215_vehicle_calculations` och `20261013212229_advertising`, privata bild-/exportbucketar samt noll verifierade kanalanslutningar och noll dispatchers. Appdeployment/autentiserat hosted UI-flöde verifieras separat; kanaler och workers är inaktiva |

## Personal och inbjudningar, 13 oktober

Personalpanelen har företagsbunden teamlista, roll-/statusadministration, privata e-postbundna inbjudningar och återkallelse. Mottagarsidan `/invitations` fungerar utan befintligt företagsmedlemskap. Inbjudningar gäller sju dagar och accepteras uttryckligen efter verifierad Auth. Ingen ägarroll eller superadminroll kan delas ut; avstängda medlemskap reaktiveras inte genom inbjudan. Inga utgående inbjudningsmejl eller hemliga delningslänkar används. [COMPANY_TEAM](COMPANY_TEAM.md) beskriver användarflödet och kontrakten.

Färsk verifiering: 210 appbeteenden passerar, inklusive 20 servergränstester, 13 navigationstester och åtta riktiga Chromiumfall för team/mottagare, mobilvy och Strict Mode. 13 PostgreSQL/PGlite-grupper kontrollerar faktisk migrationskedja, behörigheter, utgång, återförsök och fristående hosted-grund utan pending signering/arkiv. Bygge och TypeScript passerar. Shared Auth-radlås och slutlig väggklockekontroll skyddar acceptans; verklig multi-connection-låsväntan är fortsatt inte bevisad av PGlite.

Hosted `20261013192237_company_team` är applicerad efter verifierad migrationshash `11e5b2c9b051f2c3f136edf75ce0bb16eaf4ffd697348aa24585076e3a49cddf`. Hosted rollbacktest verifierar RPC-/tabellgränser, normaliserad inbjudan, identiskt återförsök och ägarskydd. Efterkontrollen visar noll testkonton/företag och noll kvarvarande testinbjudningar eller auditposter. Advisors visar avsiktliga privata RLS-listor utan direkt användarpolicy; inga nya säkerhetsvarningar. Det tidigare avstängda [läckta-lösenordskyddet](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection) och informationsnotiserna om nya oanvända index kvarstår.

Verifierad föregående main/produktion efter [PR #6](https://github.com/heke99/trafexa-auto/pull/6): `4711726afe1591e50a1e0b9551be0c55eb25db5c`, deployment `dpl_8dZBvac1KYRqhpZGAadyr2cnfNzG`, `READY`, target production, `arn1`, app/www/apex-alias. Native fetch av publik webb gav 200 med rätt kontaktadress utan synlig pilottext; `/admin` gick till login med `next=/admin` och registrering bevarade samma returväg. Den nya personalleveransens release verifieras separat i PR/deployment. Full autentiserad produktions-CRUD är fortfarande inte verifierad.

## Produktpresentation och plattformsadministration, 13 oktober

Publika texter och handlararbetsytans synliga pilotmarkeringar är ersatta med Trafexa Dealer och tydliga beskrivningar av lager, CSV-import, kalkyl, CRM, offerter, reservationer och privata dokument. Företagets kontaktadress är `info@trafexa.com`. Fiktiva exempel och verkliga krav på externa anslutningar är fortsatt tydliga. Produktgodkännanden visas som sådana, utan att påstå att en finanskanal är aktiv.

`/admin` är en separat plattformsportal med företagsöversikt, inkomna kontakter och granskade, motiverade statusändringar. Den kräver verifierad Supabase Auth och en privat UUID-lista; företagsägare har ingen automatisk global åtkomst. Registrering, inloggning och bekräftelselänk behåller den säkra lokala returvägen till admin. Sidvisning aktiverar aldrig behörighet.

Hosted Supabase har nio applicerade migrationer, inklusive `20261013184149_platform_admin`. Live katalogkontroll bekräftar invoker-wrapper, privata definerfunktioner med låst sökväg och inga execute-grants till anon/service_role. Nekad åtkomst har kontrollerats med rollback. Den användargodkända adressen `hekmat.h@trafexa.com` har en aktiv, oanvänd privat reservation. Kontot finns ännu inte i Auth och ingen UUID-superadmin har därför skapats. Kontoägaren registrerar sig, verifierar adressen och aktiverar den förgodkända åtkomsten själv.

Färsk lokal verifiering: 169 appbeteenden passerar, inklusive tre Chromiumkontroller av verklig admin-UI och åtta tester av authnavigation. Fyra PostgreSQL/PGlite-tester verifierar den faktiska migrationskedjan och admin även utan de två ännu pending signerings-/arkivmigrationerna. Bygge och TypeScript passerar. PGlite serialiserar anslutningar; verklig samtidig lockväntan över flera databasanslutningar och inloggad produktions-CRUD är inte verifierade. Se [adminflöde och drift](PLATFORM_ADMIN.md).

Advisors efter DDL: privata adminregister och revisionslistor har avsiktligt RLS utan användarpolicyer, med all direkt klientåtkomst indragen. [RLS-lintens beskrivning](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy). Auths befintliga [läckta-lösenordskydd](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection) är avstängt; detta är inte ändrat i denna leverans. Oanvända index är informationsnotiser vid denna nya databas och tas inte bort utan faktisk lastmätning.

## Hur historisk status ska läsas

Bygggrunden är återhämtad från originalarbetet och fortsättningen har lagt till finansåtkomst, företagskontext, reservationsutgång, import, kostnader, CRM, offertversion/PDF och ett avstängt signeringsbibliotek. PR #4:s 107/107 beteenden, 11/11 filsviter, 7/7 live-SQL-regressioner och PDF-fonttrace behålls som historisk verifiering. Efterföljande PR #5/main `7fc833f` har färsk rootkörning PASS 137/137 och bygge inklusive TypeScript, 14 sidor, ny dokument-PDF-route och fonttrace. Alla åtta migrationer har verifierats genom live-readback och databastyper har regenererats efter CRM. Tidigare lokal produktionsbrowser passerade 31/31 och samlad utvecklings-/mock-/produktions-QA 182/182; dessa är historiska resultat och har inte räknats om efter slutfixarna. PR #4 är faktiskt mergad till `main` med verifierad checkpoint `db7143` och identiskt tree med den testade implementationen. Historiska previewbevis bevaras. Historisk PR #4-produktion är verifierad `READY` och aktuell PR #5-produktion anges separat nedan; full auth och autentiserad CRUD genom produktionsgränssnittet är ännu inte verifierad.

Den tidigare statiska Trafexa-sajtens formulärkontroller hör till en annan kodbas och är inte verifiering av denna Next.js-/Supabase-app.

## Bekräftade resurser och auktorisation

| Resurs | Aktuell kunskap |
|---|---|
| Repository | `heke99/trafexa-auto`; denna branch fortsätter dealerappen som ersätter gamla sajten. |
| Vercel | Projekt `prj_zWks8Qd6m9ijWdu3tzid9RJlGgGE`, team `team_e3htkJPyBNSw3Ix1KQLlf180`; källkonfiguration Next.js och `arn1`. |
| Supabase | Trafexa Dealer, `buqdtssxrotkzndublrt`, Stockholm / `eu-north-1`; livekontroll bekräftar `ACTIVE_HEALTHY`. |
| Migrationer | Personalcheckpointen hade tio applied-versioner: team `20261013192237`, plattformsadmin `20261013184149`, tre grundmigrationer samt finansåtkomst `20261013151347`, reservationsutgång `20261013151355`, lagerimport `20261013152832`, offertversioner `20261013154317` och CRM `20261013160452`. Den aktuella annons-/kalkylleveransens två tillägg är verifierat applicerade enligt ovan. |
| Domäner | Readback bekräftar `trafexa.com`, `www.trafexa.com` och `app.trafexa.com` som verifierade i Vercel. Ingen DNSmutation; appens faktiska HTTP-/authflöde kontrolleras vid publicering. |
| Uppdrag | Originalchatten `01a13504-1d80-7611-92e8-9076ccf7605d`, användarturn `01a13554-497f-7729-abd7-e91341e8105c`, godkänner ersättningen av gamla sajten och byggandet i befintliga Trafexa Auto-resurser. |

## Historiskt verifierad main-merge: PR #4

| Referens | Faktisk status |
|---|---|
| Godkännande | Användaren instruerade ”fortsätt då och lägg in det på main”. |
| Pull request | [PR #4](https://github.com/heke99/trafexa-auto/pull/4), mergad till `main`. |
| Main-commit | `db7143cd633a2cee07457295fac8a75132e7352d` |
| Tree | `c12c75a8ce303aa7c26428334ad40dc7f00fe3b1`, identisk med testad implementation `403776131d3680e6f42aee566627fc2f9ab7f976`. |
| Lokal avstämning | Historisk PR #4-checkpoint; arbetskopian står därefter på den historiska main-checkpointen `7fc833f`. |
| Produktion | `dpl_8Z69TvzBVQVeVeKDwrUfAYjJUzWY`, `READY`, target `production`, rätt projekt och `arn1`, för ovanstående commit/tree. |
| Deployment-URL | [trafexa-auto-6uva9o390-div3rsa.vercel.app](https://trafexa-auto-6uva9o390-div3rsa.vercel.app) |
| Produktionsalias | `app.trafexa.com`, `www.trafexa.com` och `trafexa.com`. |
| Verifierad webb | Native fetch av [www.trafexa.com](https://www.trafexa.com/) gav 200, ”Mer bilaffär. Mindre administration.” och exakt deployment-ID. |
| Verifierad login | Native fetch av [app.trafexa.com/login](https://app.trafexa.com/login) gav 200, ”Välkommen tillbaka.” och exakt deployment-ID. |
| Canonical redirect | `trafexa.com/` gav 308 till `https://www.trafexa.com/`; beviset innehåller ingen shareparameter. |
| Täckningsgräns | Full auth/remote CRUD är inte verifierad och inga verkliga authmejl skickades. |

## Historisk main/produktion efter PR #5

Historisk main-checkpoint efter [PR #5](https://github.com/heke99/trafexa-auto/pull/5) är `7fc833f643a488b8af34bb950df22769e99be32b`, tree `89d9774a25c13f3197c5b9d09668baa05dbbe50f`. Produktion `dpl_6vcexX8f1Jw5mWPyYLzpFSd6g1sS` är `READY`, target `production`, rätt projekt/`arn1` och alias app/www/apex: [deployment](https://trafexa-auto-h8cvlrqe0-div3rsa.vercel.app). Native lagerdemo gav 200, ”Fordonslager” och exakt detta deployment-ID. Extern browseranslutning blockerades med CONNECT 403 före appkontroller: noll genomförda checks. Färsk rootkörning av denna main passerar 137/137 beteenden och produktionsbygge inklusive TypeScript, 14 sidor och ny dokument-PDF-route. Fonttrace PASS omfattar offert-PDF, demo- och dealer-page samt nya archive-actionens användning. Sex lokala Chromium-harnessfall ingår i totalsviten och är inte extern produktionsbrowser.

Vid PR #5 bekräftade livekontrollen åtta applicerade migrationer. PR #5:s två nya lokala migrationer är inte hosted-applicerade och servicekey för ny arkivregistrering saknas. Signeringsprovider och workerdispatch förblir tvingat `enabled:false`; hosted arkivering/signering är inte aktiverad. PR #5:s egna integrationsunderlag och verifieringar bevaras separat och testsummorna adderas inte som unika fall.

## Verifierade preview-checkpoints

| Artefakt | Bekräftad referens/status |
|---|---|
| Pull request | [PR #4](https://github.com/heke99/trafexa-auto/pull/4), då draft och attached till uppdraget; nu mergad enligt ovan. |
| Branch | `codex/trafexa-dealer-continuation-20261013` |
| Commit | `cf953d4078c047efefe3da1674a989ad571eea52` |
| Tree | `a204d647a4d81fa5d6f26f67c57165afa3ac1d0c`; avstämd mot den publicerade checkpointen `cf953d4`. |
| Deployment | `dpl_GveGscnZV3szkXC3xwgYKJNbtkst`, automatiskt skapad preview, `READY`. |
| URL | [trafexa-auto-304mxzp8h-div3rsa.vercel.app](https://trafexa-auto-304mxzp8h-div3rsa.vercel.app) |
| Mål | Preview i `prj_zWks8Qd6m9ijWdu3tzid9RJlGgGE`, team `team_e3htkJPyBNSw3Ix1KQLlf180`, region `arn1`. |
| Remote installation/bygge | Byggloggar för denna deployment visar `Running install command npm ci`, 73 installerade paket på sex sekunder, sedan `npm run build` och `READY`. |
| Skyddad fetch | HTTP 200 för lagerdemo, kunddemo/CRM och login via det native åtkomstverktyget. |
| Produktionspåverkan | Ingen ersättning av `main` eller produktion genom denna preview. |

Remote PDF-anrop utan appsession rapporterade HTTP 401, men åtkomstverktyget klassade det som `deploymentAuthRequired` och returnerade inte body. Det resultatet räknas därför inte som bevis för appens PDF-behörighetsgräns eller autentiserad remote PDF-CRUD. Appgränserna har passerat lokalt; faktisk remote PDF-hämtning återstår.

Den senare verifierade Node-checkpointen är:

| Artefakt | Bekräftad referens/status |
|---|---|
| Commit | `69ed849af1afe19c1c637f71940ec70384f1ce46` |
| Tree | `f9de92c9198e49135bb7fac2326dcd384f50e168` |
| Deployment | `dpl_EgM71HipZpPg2XVMzxefqFzt6vTx`, `READY`. |
| URL | [trafexa-auto-qv9b55c4h-div3rsa.vercel.app](https://trafexa-auto-qv9b55c4h-div3rsa.vercel.app) |
| Avstämning | Native readback verifierar projekt och commit; rätt projekt/team och `arn1`. Lager- och kunddemo gav 200 med förväntat gränssnitt. |
| Node.js | Manifest och lockfil låser `24.x`; lokal verifieringsmaskin kör `24.19.0`. |

Den tredje historiskt verifierade checkpointen är:

| Artefakt | Bekräftad referens/status |
|---|---|
| Commit/tree | `aed26dff099fc552687c29182d9a895da28ddd28` / `b36d0d668c9365df592001ffbd980b31ec28dd4a` |
| Deployment | `dpl_62td1ULZfX4FVG8WxrepwNvUrerC`, `READY`. |
| URL | [trafexa-auto-cvhiuxi96-div3rsa.vercel.app](https://trafexa-auto-cvhiuxi96-div3rsa.vercel.app) |
| Avstämning | Native readback matchar rätt projekt, commit och `arn1`; lager- och kunddemo gav 200 med deployment-ID. |
| Täckningsgräns | Den nya återställningsfixen tillkom senare och ingår inte i denna checkpoints verifierade resultat. |

Dessa är historiskt verifierade checkpoints. PR #4 är nu mergad; efterföljande main-pushar följs i Vercels deploymentstatus med respektive commit. Checkpointresultat överförs inte till senare kodversioner.

Efter Node-checkpointen tillkom två lokalt verifierade korrigeringar: beloppsvisningen i lager/affärer bevarar ören i stället för att avrunda till hela kronor, och pilot-API:t accepterar den specifika `VERCEL_BRANCH_URL`-originen. Andra Vercelhosts nekas fortfarande med 403. Två SSR-beloppsregressioner och en produktions-originregression ingår i de senaste 107 beteendetesterna. Därefter härdades återställningsförfrågan med fem regressioner för bekräftat svar och säkra SDK-/klient-/nätverksfel, utan verkliga authmejl.

## Återhämtad och fortsatt implementation

| Område | Vad som finns i kod/schema | Kvarstående omverifiering eller funktion |
|---|---|---|
| Webbgrund | Next.js App Router, React, TypeScript, Supabase SSR, Node `24.x`, låsta beroenden och Vercelkonfiguration. Databastyper regenererade; lokala kontroller PASS. Tre verifierade preview-checkpoints `READY`. | PR #4/main och produktion är verifierade; full auth och autentiserad remote-CRUD återstår. |
| Publik sida | Ny svensk Trafexa-hemsida, demo, integritet/villkor och mobilmeny. Lokal produktionsbrowser PASS. | Produktionssidan gav 200 och apex gav verifierad 308 till www; övriga produktgränser kvarstår. |
| Konto | Registrering, bekräftelsecallback, inloggning/utloggning och återställning. Återställning visar villkorlig framgång endast efter SDK-svar utan fel; SDK-/klient-/nätverksfel ger generiskt fel. Fem authregressioner PASS isolerat och i fullsviten, utan verkliga authmejl. | Komplett authflöde/redirects/cookies i avsedd miljö återstår. |
| Företag | Företagsskapande, företagsväxling och fem roller. Gemensam kontext verifierar användare, aktuellt medlemskap och aktivt företag; stale/ogiltigt val väljer inget annat företag automatiskt. SQL-isolering och tolv permanenta kontexttester PASS. | Autentiserat browserflöde mot produktionsgränssnitt, inbjudningar och filialer återstår. |
| Lager | Manuell registrering, sök/filter/sortering, pris/kostnader och CSV-import samt nya privata bilder och exakt fordonskalkyl. Beloppsvisning bevarar ören; SSR-, server-/SQL- och mockade UI-regressioner PASS. | Autentiserad produktions-CRUD och samtidighet; ny appdeployment och autentiserad bild-/kalkylverifiering, inköpsunderlag och full skick-/kostnadsspårning återstår. |
| Kunder/CRM | Kundkort/sök samt behovsladdad förfrågningspanel. Atomiskt kontakt-/lead-intag, sjudagars UUID-retry, sidindelning och statusbyte med kontroll av tidigare status. Action-, live-SQL- och mockade UI-kontroller PASS. | Autentiserad produktions-CRUD, full kontakt-/aktivitetshistorik och bredare kunduppdatering återstår. |
| Affärer | Affärsutkast, reservation/frigivning/utgång och offertversionering med prisbekräftelse/återförsöksskydd. SQL samt lokala/mockade kontroller passerade. | Autentiserad produktions-CRUD, två samtidiga anslutningar, kundaccept, inbyte och leverans återstår. Ingen scheduler aktiv. |
| Finansiering | Internt `intake` med skärpt RLS: ägare/admin/finans ser företagets intag; säljare ser sitt eget. SQL för läs-/skrivgräns passerade. | Ingen bankadapter, kreditbedömning, utbetalning eller lagerkredit är aktiv. |
| Dokument/offert-PDF | Företagsanknutna metadata/privat bucket, oföränderligt offertsnapshot och sessions-/företagskontrollerad PDF-route. PDF-tester, fonttrace och lokala/mockade kontroller passerade. | Autentiserad PDF-hämtning genom produktionsflödet, mallbyggare, kundaccept, signering, evidens och hämtning av arkiverade dokument återstår. |
| Signeringsbibliotek | Slutlig adapter, domänmodell, ledger/store/user/worker/inbox/storage från PR #3, commit `86bbce9`, finns nu i appen. Server-wrapper tvingar provider och dispatch till avstängt läge. 106 lokala signeringsfall passerar. | Additiv migration, verkligt godkänt avtalsrenderunderlag, providermall/credentials, signeringsroutes, webhookdrift och hosted flöde behöver fortfarande aktiveras och verifieras. Se [integrationsguiden](DOCUSEAL_INTEGRATION.md). |
| Nätverk | Informationsvy inför kontrollerad pilot. | Publicering, inköpsönskemål, matchning, bud och B2B-affär återstår. |
| Ekonomi | Exakt individuell fordonskalkyl med vanliga moms-/VMB-referensregler, registrerade kostnader och explicit avdragsunderlag. Okänt underlag ger inget färdigt resultat efter moms. | Ingen full ekonomimodul, förenklad VMB, momsdeklaration, faktura, betalningsavstämning eller bokföringsexport. |
| Annonskonto | Versionerade annonsutkast, bildval, pris från lager, registreringsnummeropt-in, privat media och granskat kanalflöde är implementerade lokalt. | Hosted migration är applicerad; ny appdeployment och autentiserad driftkontroll redovisas separat. Blocket/Wayke saknar partneråtkomst och är inaktiva, med kvarstående revisions-/skrivkontrakt enligt ovan. |
| Demo-/pilotförfrågan | `POST /api/demo-requests`, ursprungskontroll inklusive specifik `VERCEL_BRANCH_URL`, JSON/storleksgräns, honeypot och privat intag. Produktionsregression tillåter avsedd branchorigin och nekar andra Vercelhosts med 403. | Komplett browser/API/databasflöde; förfrågningar sparas, automatiska aviseringar ingår inte. |
| Audit/integritet | RLS, företagsreferenser, kontrollerade mutationer och audittriggers. Sju live-SQL-regressioner med rollback passerade, inklusive CRM:s statuskolumn/grants och audit. | Aktuellt företags-/sessionsflöde och samtidiga anslutningar behöver ytterligare browser/integrationskontroll. |

## Migrationer och återhämtningsluckor

| Fil | Bekräftad applied-version |
|---|---|
| `supabase/migrations/20261013130218_dealer_foundation.sql` | `20261013130218` |
| `supabase/migrations/20261013130603_dealer_integrity_hardening.sql` | `20261013130603` |
| `supabase/migrations/20261013130654_explicit_data_api_grants.sql` | `20261013130654` |
| `supabase/migrations/20261013151347_finance_access_scope.sql` | `20261013151347` |
| `supabase/migrations/20261013151355_reservation_expiration.sql` | `20261013151355` |
| `supabase/migrations/20261013152832_stock_import.sql` | `20261013152832` |
| `supabase/migrations/20261013154317_offer_versions.sql` | `20261013154317` |
| `supabase/migrations/20261013160452_customer_leads.sql` | `20261013160452` |

De återhämtade arbetsförsöken för finansåtkomst och reservationsutgång har granskats och fortsatts med de bekräftade liveversionerna ovan. Lokala namn har synkroniserats till dessa versioner. Offertapply och live-readback är bekräftade; fullständiga databastyper har regenererats efter schemats fortsättning.

SQL-regressioner finns nu för `tenant_isolation`, `public_and_storage`, `finance_access_scope`, `reservation_expiration`, `stock_import`, `offer_versions` och `customer_leads`. Samtliga sju har passerat mot det bekräftade projektet med syntetiska fixtures och rollback. CRM-testet täcker båda företag, alla roller, sjudagars återförsök, 1000-kvittonsgräns, audit, statuskonflikt och begränsade kolumngrants, utöver övriga sviters företags-/lagrings-/reservations-/import-/offertgränser.

Livekörningen av offerttestet utelämnade det simulerade legacyfallet med ogiltiga källdata för att undvika ändring av tabellconstraints i liveprojektet. Hela offertsviten, inklusive tolv kontroller av källdatagränser, har i stället passerat i isolerad PGlite. Sex PDF-testfall ingår i de passerade Node-testerna. Denna skillnad i miljö och täckning är avsiktligt redovisad; isolerade legacyfall är inte liveändringar.

## Schemaläggning och kvarstående advisory

Ingen scheduler är aktiv. Reservationsutgång sker i den applicerade RPC-kedjan när ny affär skapas eller bil reserveras. Det bevarar gamla reservationsposter och frigör affär/lager atomiskt. En utgången post kan ligga kvar med reserverad liststatus tills nästa sådan operation.

Automatisk godkännandegranskning avvisade `20261013153335_reservation_expiry_schedule`: åtgärden skulle installera permanent `pg_cron` och utföra minutvisa mutationer i produktionsdatabasen. Förslaget är flyttat till [proposals/reservation_expiry_schedule.sql](proposals/reservation_expiry_schedule.sql), utanför `supabase/migrations/`. Ett andra aktiveringsförsök avvisades eftersom main-instruktionen inte tydligt godkände detta separata permanenta minutjobb. Ingen förändring applicerades. En ny explicit godkännandefråga är obesvarad; main-mergen genomförs utan scheduler. Livekontroll efter avslag bekräftar `pg_cron_exists = false`.

Koordinerande agents senaste security-advisor-kontroll rapporterar endast att skydd mot läckta lösenord är avstängt. Den inställningen är inte ändrad av dokumentationsarbetet; den kvarstår som en uttrycklig driftåtgärd. Detta advisoryresultat ersätter inte egna åtkomst- och browserregressioner.

Originalplanens innehållsförteckning 1–22 och fulla fas 0–10 återhämtades, men inte hela originaltexten eller samtliga ursprungliga tester. [MASTERPLAN](MASTERPLAN.md) redovisar den rekonstruerade fortsättningen och källfragmentens begränsningar.

## Verifieringsprotokoll i denna fortsättning

| Kontroll | Nuvarande bevis/status |
|---|---|
| Projekthälsa och migrationlista | Bekräftat live av koordinerande agent: aktivt och friskt projekt, åtta applied-versioner enligt ovan med full readback. |
| Security advisor | Endast advisory om avstängt skydd mot läckta lösenord, enligt koordinerande agents senaste kontroll. |
| Node.js | Lokal verifieringsmaskin `24.19.0`; manifest/lockfil låser `24.x` i verifierad `READY`-checkpoint `69ed849`. |
| Remote `npm ci` och bygge | PASS i första checkpointen `dpl_GveGscnZV3szkXC3xwgYKJNbtkst` / `cf953d4078c047efefe3da1674a989ad571eea52`: 73 paket på sex sekunder, följt av `npm run build` och `READY`. |
| `npm run typecheck` | PASS efter CRM-typregenerering samt belopps-/originfixar; senaste byggning inklusive TypeScript PASS efter authfix, bekräftat av koordinerande agent 13 oktober 2026. |
| PR #4: `node --test --test-isolation=none tests/*.test.mjs` | Historiskt PASS 107/107: 44 routing-/validerings-/demo-/import-/PDF-fall, 32 DocuSeal-fall, 12 företagskontextfall, 12 CRM-actionfall, två SSR-beloppsfall och fem authåterställningsfall. Provider-/authtransport och serverberoenden mockas där respektive svit kräver det. |
| PR #4: `npm test` | Historiskt PASS 11/11 filsviter efter authfix, via exakt package-script. Nodedefault rapporterar filsviter; de enskilda beteendena är 107 enligt kommandot ovan. |
| Företagskontext | Tolv permanenta regressioner i `tests/company-context.test.mjs` PASS efter gemensam verifierad session och hantering av stale cookie. |
| Lösenordsåterställning | PASS 5/5 i `tests/auth-recovery.test.mjs`, isolerat och i fullsviten: bekräftat villkorligt svar, SDK-fel, nätverksfel, klientinitialiseringsfel och ogiltig e-post. Auth-SDK är mockat; inga verkliga authmejl skickade. |
| PR #4: `npm run build` | Historiskt PASS efter authfix, inklusive TypeScript och 14 sidor/API/SSR/proxy med Next.js 16.4/Turbopack. Senaste `route.js.nft.json` innehåller `DejaVuSans.ttf`; fonttrace PASS. |
| SQL-regressioner | PASS 7/7 mot `buqdtssxrotkzndublrt` med rollback, inklusive CRM. Offertens simulerade legacyfall utelämnat live; hela offertsviten inklusive tolv källdatagränser PASS i isolerad PGlite. |
| Reservationskonkurrens/utgång | Lazy expiry applicerad; schema/testunderlag finns. Separata samtidiga anslutningar och bakgrundsscheduler är olika kontroller. |
| Lokal produktionsbrowser | Historiskt PASS 31/31 mot port 3010, noll POST-anrop och noll JavaScriptfel. Detta är lokal produktionskontroll, inte autentiserad produktions-CRUD. De senare belopps-/originfixarna har separata regressioner ovan. |
| Samlad browser/QA | Tidigare PASS 182/182 över utveckling, mockade UI-actions och lokal produktion. Mockad UI-harness bevisar användarbeteenden men ingen verklig produktionsmutation. |
| Riktad browserkontroll efter slutfixar | PASS 9/9 för berörda lager-/affärsvyer, kostnadsdialog och behovsladdad CRM vid 320/1280 px mot produktionsbygget på port 3011. Noll POST-anrop och JavaScriptfel. Historiska 182/182 räknas inte om som ny full körning. |
| Mobil och tillgänglighet | Lokala QA-kontroller av förbättrade mobilmenyer/åtkomst passerade; remote efterkontroll återstår. |
| Remote preview | `READY`-checkpoints `cf953d4`, `69ed849` och `aed26df`, rätt projekt/team och `arn1`. Skyddad fetch verifierar respektive demo/loginyta; ingen autentiserad remote CRUD eller PDF-CRUD verifierad. Senare pushar följs via PR/Vercelstatus. |
| Produktionsrelease/domäner | Historisk PR #4/main `db7143` och aktuell PR #5/main `7fc833f` har verifierade produktionsdeployments. Äldre www/login/apexbevis tillhör `dpl_8Z69...`; aktuell lagerdemo matchar exakt `dpl_6vce...`. |

Uppdatera detta protokoll med faktiskt kommando, miljö, resultat och begränsning. Räkna inte partnerfunktioner som verifierade genom mockade beslut eller genom att en intern intresseanmälan går att spara.

## Prioriterad fortsättning

1. Bevara historisk main-/produktionscheckpoint `db7143` och aktuell `7fc833f`; efterföljande main-pushar följs i Vercelstatus med respektive commit.
2. Komplettera remote font-/domän-/auth-/PDF-kontroller; de åtta migrationerna är redan applicerade och cronförslaget förblir separat med obesvarad godkännandefråga.
3. Komplettera ännu ej verifierad autentiserad browser-CRUD för två syntetiska företag och separata samtidiga reservationsanslutningar.
4. Följ upp advisory om läckta lösenord samt faktisk driftåtkomst för publikt intag och dokument.
5. Följ upp verifierad produktion i avsett projekt och dokumentera enbart bekräftade efterföljande artefakter/driftresultat.
6. Fortsätt fas 1–3:s återstående personal-/filial-, inköps-/bild-, CRM-/kundaccept- och inbytesarbete, därefter dokumentfasen och de partnerberoende faserna.

Ingen finanspartner, signeringstjänst, BankID-underskrift, bokföringsadapter eller fordonsdataadapter är aktiverad av dokumentationen eller den återhämtade bygggrunden.

Arbetsytans grundsnapshot begränsar lager, kunder och affärer till de 500 senaste posterna per företag. Importens dubblettkontroll använder hela företagets lager, men full sidindelning, sökning och dashboardtotaler för större register återstår före bredare produktionsbruk.

## Tillägg: privat offertarkiv och beständig signeringsgrund

Integrationsgrenen `feat/offer-signing-integration-20261013` utgår från PR #4, commit `4037761`. Den inför PR #3:s slutliga signeringsmoduler, commit `86bbce9`, i huvudappens `src/lib/signing/`, plus privat offertarkivering och autentiserad hämtning. Providerklient och workerdispatch förblir tvingat avstängda via applikationens server-wrapper.

Arkivering gäller befintliga oföränderliga offertversioner, `kind=other`, för owner/admin/finance. Servergenererade PDF-bytes återläses och hashkontrolleras före service-only registrering. Direkta användaranrop kan inte förfalska arkivregistreringen. En ny offert registreras högst en gång; historiska kvitton behåller första dokument, fil, aktör och begäransreferens. UI ignorerar sena svar efter företagsbyte och bevarar referensen vid retry. Downloadroute `/api/documents/[documentId]/pdf` verifierar faktisk filhash och privat bucket före och efter fil-I/O.

| Kontroll i denna integrationsgren | Resultat och gräns |
| --- | --- |
| `npm run typecheck` | PASS efter appintegrationen |
| `node --test --test-isolation=none tests/*.test.mjs` | PASS 137/137 beteenden, inklusive 15 arkiv-/server-action-/servicefall, 8 downloadfall och 6 browserfall. Provider och SDK-gränser är kontrollerade fixtures |
| `npm run test:signing` | PASS 106 fall i adapter/domän/store/worker/user/storage samt 8 flödesfall mot lokal PostgreSQL/PGlite. Delvis överlapp med huvudappens tester; summorna ska inte adderas som unika fall |
| `npm test --prefix tests/offer-archive-db` | PASS: hela huvudappens migrationsordning körs lokalt före arkivets SQL-rollbackassertioner med faktiska roller, RLS, grants, privata Storage-kataloger, oföränderlighet och service-only registrering |
| Chromium-komponentflöde | PASS 6/6 med verkliga DealOffers/DealerWorkspace, mockade serveråtgärder och blockerad HTTP. Next HTTP/RSC-transport och hosted CRUD ingår inte |
| `npm run build` | PASS för Next 16.4/Turbopack och Node 24, inklusive den nya dynamiska dokument-PDF-routen |

Nya migrationer är `20261013165650_signing_ledger.sql` och `20261013165726_offer_document_archive.sql`. De är lokala, CLI-namngivna additiva migrationer efter de åtta redan applicerade migrationerna. Hosted applicering har inte gjorts. Den äldre signing-ledgerfilen från PR #3 ska inte appliceras dessutom. Databastyperna från liveprojektet bevaras; ett lokalt RPC-overlay beskriver arkivmigrationen.

`SUPABASE_SECRET_KEY` eller äldre `SUPABASE_SERVICE_ROLE_KEY` behöver konfigureras enbart på servern för ny arkivregistrering. Saknad konfiguration stoppar före render/upload. Verklig lagrings-CRUD, godkänt köpeavtalsunderlag, faktiska providermallar, signeringsroutes/webhookdrift och användarens produktionsflöde återstår. Detta tillägg är kod och lokala verifieringar; det ersätter inte PR #4:s tidigare preview eller någon produktionsdeployment. [OFFER_DOCUMENT_ARCHIVE](OFFER_DOCUMENT_ARCHIVE.md) anger RPC- och driftkontraktet.
