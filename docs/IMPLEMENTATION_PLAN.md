# Trafexa Dealer genomförandeplan

Trafexa Dealer byggs som en gemensam plattform för svenska bilhandlare i GitHub- och Vercelprojektet **trafexa-auto**, med Supabaseprojektet **Trafexa dealer**. Den publika webbplatsen ligger på `trafexa.com` och handlarappen på `app.trafexa.com`. Varje företag har privata uppgifter; användare med medlemskap i flera företag kan växla arbetsyta.

Planen följer de återhämtade originaluppdragen och den tidigare fullständiga byggplanens elva faser. Arbetet fortsätter från den befintliga Next.js-appen. Den tidigare statiska sourcing-webbplatsen är arkiverad i `archive/website-before-dealer-20261013`.

Datum: 13 oktober 2026.

## Fastställd riktning och aktuella källor

- Användaren har angett Supabaseprojekt **trafexa dealer**, GitHub/Vercel **trafexa auto**, `app.trafexa.com` hos Strato och att den äldre webbplatsens kod får ersättas.
- Tekniken är Next.js/TypeScript och Supabase/Postgres med tydliga moduler. Gränssnittet ska vara ett genomarbetat arbetsverktyg för bilhandlare.
- De återhämtade uppdragen beskriver lager, kunder, affärer, avtal, köpfinansiering, lagerfinansiering, ekonomi och handlarnätverk.
- Grundsystemet byggs medan finanspartneravtal förbereds. Partnerprodukter aktiveras när verklig handlaranslutning, produktbehörighet och teknisk kanal är bekräftade.
- Ursprungligt planunderlag: byggchatten med ID `01a13504-1d80-7611-92e8-9076ccf7605d`, inklusive **Bilhandlarsystem_fullstandig_byggplan.docx** och användarens fortsättningsinstruktioner. Originaltexten har nu lästs direkt i denna chat.
- Pågående huvudbygge: **Fortsätt Trafexa Auto-planen**, arbetsgren `codex/trafexa-dealer-continuation-20261013`.

## Befintlig databas och gemensamma kontrakt

Verifierad katalogmetadata: Supabaseprojekt `buqdtssxrotkzndublrt`, **Trafexa dealer**, region `eu-north-1`. Kontolänken heter `kundexa`; projektets namn och ID avgör målprojektet.

| Del | Befintligt kontrakt | Konsekvens för fortsatt arbete |
| --- | --- | --- |
| Företag | `companies`, status `active/suspended` | Återanvänd samma företag i alla moduler |
| Medlemskap | `memberships`, roller `owner/admin/sales/finance/viewer`, status `active/suspended` | Aktivt företag och aktivt medlemskap krävs för åtkomst |
| Lager och kunder | `vehicles`, `stock_items`, `vehicle_costs`, `customers` | Företagsbundna resurser kopplas till affärer |
| Affärer | `deals`, status `draft/reserved/cancelled` | Nya steg som avtal och leverans kräver uttryckliga schemaändringar |
| Offerter | `offers`, positiv version och `snapshot` | Bevara versionsbundet affärsunderlag |
| Dokument | `documents`: företag, eventuell affär, namn, objektväg och kind `purchase/contract/finance/other` | Ingen befintlig status, dokumentversion, checksumma eller signaturbindning |
| Finanspartner | `finance_partners`, status `unavailable/onboarding/active` | Visa verklig anslutningsstatus |
| Handlargodkännande | `dealer_approvals`, produkt `purchase/stock`, status `pending/approved/rejected/suspended` | Separat godkännande per handlare, partner och produkt |
| Finansärende | `finance_applications`, status `intake/awaiting_partner/submitted/withdrawn` | Sparad förfrågan är inte ett kreditbeslut |

Alla verifierade public-tabeller har RLS. `private.has_company_role` kontrollerar användare, aktivt medlemskap och aktivt företag. Dokumentläsning och insert kräver nu `owner/admin/finance` enligt den senaste policykontrollen; dokumentets objektväg börjar med företagets UUID och affärsreferensen är företagsbunden.

Dessa uppgifter kommer från läsning av schema- och policykataloger, inte affärsrader. App- och databasändringar ska alltid följa samma verifierade kontrakt.

## Arbetsägare och parallella spår

| Spår | Ägare och leverans | Filgräns |
| --- | --- | --- |
| Huvudapp | Huvudagenten i **Fortsätt Trafexa Auto-planen** samordnar Next.js-app, UI, lagerimport och integration | Huvudappens arbetsgren |
| Behörigheter | Huvudagentens säkerhetsagent granskar och rättar plattformens RLS/roller | Befintligt handlar-schema och åtkomstkod |
| Affär och reservation | Huvudagentens affärsagent bygger säkra reservationer och affärsflöde | Affärsmodul och dess migrationer |
| Fordonskostnader | Huvudagentens kostnadsagent bygger registrering och summering per bil | Kostnadsmodul och tillhörande vyer |
| Granskning och dokumentation | Huvudagentens granskningsagent verifierar sammansatt app | Huvudappens tester och leveransunderlag |
| Avtalsflöde | Denna chats API-agent bygger autentiserad förberedelse och beständig DocuSeal-worker | `src/lib/documents/`, användar- och workertester |
| Signeringsdatabas | Denna chats schemaagent bygger additiv ledger och verifierar riktiga SQL-transaktioner | `supabase/migrations/*signing_ledger.sql`, ledger-/flödestester |
| Regler och acceptans | Denna chats kravagent dokumenterar regler, integration och färdigkriterier | `docs/DEALER_RULES_AND_CONTRACTS.md` i avtals-PR |
| Avtalsgranskning | Denna chats oberoende granskare kontrollerar adapter, okända utfall och händelsegränser | Läsning och testresultat |
| Samordning och driftunderlag | Denna chats huvudagent och driftagent håller plan, providerkontrakt och katalogmetadata aktuella | Plan-PR och integrationsdokumentation |

Huvudappen och detta stödarbete har separata arbetsgrenar; underagenter delar respektive arbetsyta med uttryckliga filägare. En integrationsändring i schema, API eller statusmodell delas i det gemensamma GitHub-underlaget innan beroende kod ändras. Huvudagenten äger sammansättningen av den verkliga handlarappen.

## Byggordning och färdigkriterier

| Fas | Leverans | Kriterium för färdigställande |
| --- | --- | --- |
| 0 Produkt och partnerupplägg | Pilothandlare, arbetsflöden, importbehov och partneransvar | Målgrupp, första flöde och pilotomfattning är fastställda; partnerprodukter och kanaler har verkligt underlag |
| 1 Företag och åtkomst | Registrering, inloggning, onboarding, personal, roller och företagsväxling | Två företag kan inte läsa eller ändra varandras privata data, även via direkta API-anrop; spärrade medlemskap och företag nekas |
| 2 Lager och inköp | Fordon, registreringsnummer/VIN, inköpsunderlag, bilder, skick, kostnader, priser, lagerdagar och import | Import kan granskas före sparande; ogiltiga rader och dubbletter hanteras; belopp och momsmodell bevaras |
| 3 Kunder och affärer | Kundkort, leads, offert, inbyte, reservation och uppföljning | Kund och bil tillhör rätt företag; samma bil kan inte dubbelreserveras; reservation kan förlängas, löpa ut och frigöras enligt beslutat kontrakt |
| 4 Avtal och signering | PDF-mallar, fältmappning, dokumentversion, signeringsuppdrag, påminnelser och arkiv | Ett låst underlag kopplas till rätt affär och parter; verifierade händelser och signerad PDF/revisionsbevis sparas; signeringsutfall visas korrekt |
| 5 Köpfinansiering | Första partnern, handlaranslutning, ansökan, komplettering, beslut och utbetalningsstatus | Handlare och produkt är godkända; verklig partnerkanal fungerar; dubbla partnerhändelser skapar inga dubbla ansökningar eller fel status |
| 6 Ekonomi och leverans | Fakturaunderlag, betalningsläge, bokföringsexport, resultat per bil och avslut | Bilaffären kan följas från underlag till leverans; kostnader och dokument går att spåra; belopp och status har verifierad källa |
| 7 Lagerfinansiering | Kreditlimit, finansierade lagerbilar, kostnader och lösen | Partnerbeslut och finansierade bilar stämmer; en såld bil kan hanteras för lösen utan dubbletter |
| 8 Handlarnätverk | Utvalda publicerade bilar, inköpsönskemål, matchning, bud och B2B-reservation | Endast valda uppgifter delas; kunddata, inköpspriser och finansdokument förblir privata; företag kan inte reservera samma bil samtidigt |
| 9 Pilot och lansering | Pilotdrift, support, övervakning, säkerhetskontroll och återställning | Ett komplett bilaffärsflöde och partnerflöde är verifierat med pilotdata; incident- och återställningsväg fungerar |
| 10 Vidare integrationer | Fler finanspartners, annonser, fordonsdata, bokföring och dokumenttolkning | Varje integration har eget dokumenterat kontrakt, behörighet, felhantering och verifierat resultat |

Den första kompletta affären ska följa importerad bil → kund och offert → avtal och signering → leverans. Finansiering kopplas in när första partnerns avtalade flöde finns. Faser kan utvecklas parallellt men får inte markeras färdiga genom mockade vyer eller enbart sparade intresseförfrågningar.

## Avtalsdelen som byggs nu

[Avtals-PR 3](https://github.com/heke99/trafexa-auto/pull/3) innehåller DocuSeal-adapter och ett tillhörande beständigt flöde mot befintliga Dealer-tabeller: additiv ledger, godkända dokument-/mallversioner, autentiserad användargräns, worker, webhook-inbox och privat arkivering. Koden verifieras lokalt; migration, godkänt offertrenderunderlag, faktiskt malläsning och worker/UI-koppling återstår i huvudappen. Providerutskick är avstängda tills integrationen aktiveras uttryckligt.

- Företag, affär, dokument, mallversion och förväntade parter ska bindas av huvudappens verifierade serverkontext.
- Bilköpeavtal och finanspartnerns kreditavtal hålls isär. Adaptern fattar inga kreditbeslut.
- En undertecknares `form.completed` är inte hela uppdragets `submission.completed`.
- Om ett POST-anrop kan ha nått leverantören men svaret försvinner måste utfallet hanteras som okänt. Inget automatiskt nytt signeringsuppdrag skickas.
- Beständig dispatchledger och webhook-inbox finns i avtals-PR:n. Dokumentversion/hash, hela servergodkända signer-/fältpayloadet samt mall-ID/version/hash binds oföränderligt. Unik dokumentversion hindrar dubbla signeringsjobb även med ny idempotensnyckel.
- Nuvarande `documents` saknar signeringsstatus. Adaptern får därför inte skriva `signed` till dokument eller affär.
- Faktiska käll-, mall- och arkivbytes kontrolleras; completed kräver privat signerad PDF och revisionsbevis med verifierad återläsning. Lokala fixtures är inte bevis på hosted Storage-policyer eller semantiskt identisk providerrendering.
- BankID, PDF-editor och provideraktivering följer sina separata integrations- och licenskontrakt.

DocuSeal, pdfme och pdf-lib kommer från originalplanens avtalsförslag. Exakt utgåva och driftmodell ska kontrolleras före aktivering; basic selfhost API och moln-/Pro-funktioner har olika villkor.

## Finansieringsgränser

Köpfinansiering av slutkundens bil och lagerfinansiering av handlarens fordon är två separata processer. Varje handlare behöver partnerns godkännande för den produkt som ska användas.

Plattformen förbereder och hanterar ärenden enligt avtal. Finanspartnern är källa för kreditprövning, kreditbeslut, finansieringsvillkor och finansavtal. Gränssnittet ska skilja sparad förfrågan, väntan på partner och faktiskt partnerbeslut.

Partneravtal ska precisera anslutning, ansvar, informationshantering, kanal, ersättning, återkrav och eventuellt garantiansvar. Kontakter och föreslagna samarbeten är inte aktiva integrationer. Regler, moms/VMB och avtalsvillkor ska baseras på aktuell dokumentation och verkligt upplägg.

## Verifiering och drift

Varje leverans knyts till commit, rätt testmiljö och konkret användarflöde. Tester för företagsisolering, roller, reservationer, pengar, dokumentbindning och dubbla integrationsevent prioriteras.

| Kontroll | Bevis |
| --- | --- |
| Typkontroll och bygg | Den valda Next.js-appen och dess lockfil bygger reproducerbart |
| Databastest | Verkliga queries verifierar RLS, grants, constraints och transaktioner |
| Webbläsartest | En användare genomför flödet; felvägar och återhämtning fungerar |
| Partner-/provideradapter | Kontrakt, autenticitet, dubbletter och okända utfall verifieras utan påhittade beslut |
| Körbar preview | Samma commit testas med rätt projekt, miljövariabler och skydd |
| Pilot | Riktig behörighet, verkliga partnerkanaler och återställning är kontrollerade |

Driftinventeringen tidigare den 13 oktober visade att Vercel är inställt på Next.js men dåvarande huvudgren saknade paket/lockfil; preview misslyckades med `missing_lock_file`. Huvudappens Next.js-kod och matchande lockfil är därför del av den nödvändiga leveransen. Produktionssidan var fortfarande den äldre statiska webbplatsen vid kontrollen.

Supabase, DocuSeal och andra providerhemligheter hålls på servern. SSO-/deploymentskydd bevaras. DNS för `app.trafexa.com` hanteras när en verifierad appdeployment finns.

## Tidigare referensarbete och överlämning

[Utkast-PR 2](https://github.com/heke99/trafexa-auto/pull/2) bevarar en isolerad sourcing-backend med 19 API-tester, 12 PostgreSQL-tester och 8 HTTP/databastester. Den byggdes innan originalplanen var åtkomlig och är referensarbete, inte den återhämtade handlarplattformens schema. Dess parallella företagstabeller ska inte migreras till **Trafexa dealer**.

Denna chats aktuella kodspår för avtal ligger i `feat/docuseal-adapter-20261013`. Huvudagenten integrerar användbara moduler i sin befintliga app och verifierar dem mot samma företag, roller och affärsflöde.

Kommunikation mellan chattarna sker här genom verifierade statusavläsningar och det gemensamma GitHub-underlaget. Ett publicerat underlag betyder inte automatiskt att den andra agenten har läst eller integrerat koden.
