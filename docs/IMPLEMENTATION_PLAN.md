# Trafexa Auto genomförandeplan utkast

Planen samordnar fortsatt arbete i `heke99/trafexa-auto` och stöder byggagenten i chatten **Fortsätt Trafexa Auto-planen**. Den anger arbetsägare, beroenden och kriterier för färdigställande. Den fullständiga tidigare produktplanen för ett nytt bilhandlarsystem måste först återhämtas innan dess funktioner kan räknas som beslutade.

Datum: 13 oktober 2026. Teknisk utgångspunkt: commit `e37c57c18f0848368bc184e89aab0e587083df6a`.

## Bekräftat nuläge

| Del | Nuläge | Källa |
| --- | --- | --- |
| Produkt | Offentlig B2B-webbplats för fordonsanskaffning, driven av Diversa Nordic AB | [README](../README.md), [webbplats](../index.html) |
| Implementering | Statisk HTML, CSS och JavaScript samt Vercelfunktionen `/api/inquiry` | [klient](../script.js), [API](../api/inquiry.js), [Vercelkonfiguration](../vercel.json) |
| Förfrågan | Företag, kontaktuppgifter, fordonskrav, antal, destination och samtycke | [formulär](../index.html), [API](../api/inquiry.js) |
| Avisering | API skickar förfrågan via Resend; webbplatsen visar alternativ kontaktväg vid fel | [API](../api/inquiry.js), [README](../README.md) |
| Affärsflöde | Förfrågan, sourcing, erbjudande samt bekräftelse och leveranskoordination beskrivs på webbplatsen | [processbeskrivning](../index.html) |
| Appfunktioner | Den kontrollerade utgångspunkten saknar databas, inloggning och digital ärendehantering | Filinventering av angiven commit |
| Arkiv | GitHub har grenen `archive/website-before-dealer-20261013` | [arkivgren](https://github.com/heke99/trafexa-auto/tree/archive/website-before-dealer-20261013) |

Arkivgrenens namn etablerar inte vilka funktioner den nya appen ska ha. Vercelinställningar eller nya miljövariabelnamn bevisar inte heller att en fungerande app är byggd.

## Arbetsdelning

| Arbetsägare | Leverans | Filansvar eller gräns | Status |
| --- | --- | --- | --- |
| Befintlig byggagent i **Fortsätt Trafexa Auto-planen** | Webbplats, robust formulär och API samt tillhörande tester | `index.html`, `script.js`, `styles.css`, `api/inquiry.js` och egna tester | Lokala fixar rapporterade klara; inget publicerat |
| Kravagent i denna chat | Återhämtade användarbeslut från tidigare Trafexa-chattar med källor | Läser historik; ändrar ingen kod | Undersökning klar; tidigare produktkrav kunde inte hämtas |
| Kartläggningsagent i denna chat | Teknisk inventering, luckor och acceptanskriterier | Läser projektet; ändrar ingen kod | Inventering klar |
| Samordnare i denna chat | Denna plan, prioritering och underlag för överlämning | `docs/IMPLEMENTATION_PLAN.md` | Planutkast |
| Framtida plattformsagent | Appgrund, konton och datalagring om produktplanen kräver detta | Separat gren; filansvar fastställs efter vald arkitektur | Väntar på produktkrav |
| Framtida verifieringsagent | Oberoende verifiering av den sammansatta leveransen | Tester och dokumenterade resultat | Startar när en körbar version finns |

De framtida rollerna är föreslagen arbetsdelning, inte startade agenter. Krav- och kartläggningsagenterna har arbetat parallellt med byggagentens befintliga arbete.

## Ordning och beroenden

1. Återhämta produktplanen och bevara byggagentens färdiga lokala formulärfixar som en separat leverans.
2. Lägg varje återhämtat krav i kravlistan nedan. Ange användarkälla, ansvarig och ett verifierbart resultat.
3. Välj appstruktur utifrån de beslutade kraven. Dela sedan upp plattform, användarflöden och integrationer i separata grenar med tydligt filansvar.
4. Integrera ett komplett första användarflöde och verifiera det från webbläsare till server och eventuell datalagring.
5. Bygg resterande beslutade flöden mot samma kontrakt och kontrollera dem i preview.
6. Slutför driftkontroller, produktionskonfiguration och leveransredovisning före lansering.

Samordnaren äger integrationsordningen. Två agenter ska inte ändra samma fil samtidigt. Ett ändrat API- eller datakontrakt ska föras in i planen och meddelas berörda byggagenter innan deras beroende kod ändras.

## Prioriterad kravlista

| ID | Krav eller beslutspunkt | Ansvar | Beroende | Kriterium för färdigställande |
| --- | --- | --- | --- | --- |
| P0 | Återhämta den fullständiga tidigare produktplanen | Kravagent och samordnare | Åtkomlig historik eller planen från användaren | Varje beslutat flöde, användarroll och integration har en angiven källa; osäkra funktioner är avskilda som förslag |
| P1 | Slutför pågående klientfixar | Befintlig byggagent | Nuvarande webbplats | Uppgifter behålls vid fel; lyckat svar kräver API-bekräftelse; sändning kan inte fastna utan återhämtning; mobil och tangentbord fungerar |
| P2 | Slutför pågående API-fixar | Befintlig byggagent | Nuvarande API | Felaktig JSON och ogiltiga fält ger kontrollerade svar; samtycke valideras; leverantörsfel och timeout hanteras; testsvar innehåller inga hemligheter |
| P3 | Fastställ appstruktur och datakontrakt | Samordnare och framtida plattformsagent | P0 | Beslutade roller, resursägarskap, endpoints, lagring, migrationer och miljöer är dokumenterade; varje byggspår har separat filansvar |
| P4 | Bygg första kompletta beslutade användarflödet | Framtida byggagenter | P3 | En verklig användare kan utföra flödet; data och felhantering verifieras; behörighet kontrolleras på servern där det behövs |
| P5 | Bygg övriga beslutade flöden | Framtida byggagenter | P0, P3, fungerande P4 | Varje återhämtat krav har implementering, test eller dokumenterad manuell kontroll; inga krav markeras klara enbart genom mockade vyer |
| P6 | Verifiera sammansatt preview | Framtida verifieringsagent | Integrerade P1–P5 enligt vald produktscope | Resultat knyts till samma commit och preview; relevanta felvägar, länkar, mobilvyer och behörighetsgränser fungerar |
| P7 | Slutför drift och lanseringsunderlag | Samordnare och framtida plattformsagent | P6 | Konfiguration är kontrollerad för rätt projekt och miljö; domän och avsändare är verifierade om de används; återställningsväg och kvarstående hinder är dokumenterade |

P1 och P2 gäller den befintliga webbplatsen. De ersätter inte genomförandet av en ny produktplan. Om P0 visar att den gamla webbplatsen ska ersättas helt ska dessa fixar hållas avgränsade och prioriteten för fortsatt arbete följa den återhämtade planen.

## Beslut som behöver finnas i produktplanen

Samla svar från tidigare beslut innan nya antaganden görs:

- Vem använder systemet: intern personal, en egen bilhandel eller flera oberoende företag?
- Vilket är huvudflödet: sourcing, lager och försäljning, finansiering eller en annan beslutad process?
- Vilka roller får skapa, läsa, ändra och godkänna varje typ av ärende?
- Vilka uppgifter och dokument ska sparas och vem äger dem?
- Vilka externa system ingår i första leveransen?
- Vilka befintliga delar ska behållas, ersättas eller migreras?

## Förslag om ärendehantering ingår

Detta är ett möjligt första flöde, inte ett återhämtat produktkrav:

1. Förfrågan sparas med unikt ID och tidsstämpel.
2. Avisering skickas för den sparade förfrågan; ett aviseringsfel får inte radera ärendet.
3. Handläggare kan tilldela ansvarig och ändra status.
4. En extern kund kan följa egna ärenden och erbjudanden om kundinloggning ingår.
5. Statushistorik och behörighetsgränser kontrolleras.

Om flera företag delar systemet ska två testföretag inte kunna läsa eller ändra varandras data, även vid direkta API-anrop. Leverantörsportal, fordonslager, finansiering, betalningar, dokumentuppladdning och chatt ska prioriteras enligt den verkliga produktplanen; de är inte bekräftade krav i den nuvarande koden.

## Verifiering och leveransbevis

| Kontroll | Vad resultatet visar | Vad som behövs |
| --- | --- | --- |
| Statisk lokal visning | Layout, navigation och klientbeteende | Lokalt webbserverkommando i README |
| API-test med kontrollerad leverantörsmock | Validering, statuskoder, timeout och felvägar | Körbar Vercelfunktion eller motsvarande testharness |
| Körbar preview med API | Hela förfrågningsflödet från klient till backend | Rätt commit och miljökonfiguration |
| Leveranstest av e-post | Faktisk mottagning av en förfrågan | Verifierad avsändare, mottagare och en uttrycklig instruktion att skicka testmeddelandet |
| Behörighets- och datatest om appen kräver detta | Sparad data, rätt åtkomst och isolering | Beslutade roller, testdata och körbar app |

`python3 -m http.server` kör inte `/api/inquiry`. En snygg lokal formulärvy bevisar därför inte att förfrågningar skickas. Mockad e-post bevisar inte faktisk leverans. Konfigurerade variabelnamn bevisar inte att deras värden och behörigheter fungerar.

Varje leveransrapport ska ange commit eller PR, testmiljö, utförda kontroller och konkreta kvarstående hinder. Den andra agentens rapporterade tester ska hållas skilda från kontroller som verifierats oberoende i denna chat.

## Underlag för den andra byggagenten

1. Läs denna plan som samordningsunderlag och bevara de rapporterade lokala webbplats- och API-fixarna som en separat leverans.
2. För in den verkliga produktplanen under P0 och ersätt förslagen med dess beslutade flöden.
3. Dela därefter ut P3–P5 mellan byggagenter med separata grenar och ett gemensamt kontrakt.
4. Använd P6–P7 som färdigkriterier och redovisa vad som faktiskt är verifierat.

Denna plans existens betyder inte att den andra agenten har tagit emot den. Ingen direkt meddelandefunktion till den andra chatten är tillgänglig i denna session; det gemensamma GitHub-underlaget är överlämningsvägen.

## Källor och återstående avgränsning

- Repo: [heke99/trafexa-auto](https://github.com/heke99/trafexa-auto).
- Teknisk utgångspunkt: [commit e37c57c](https://github.com/heke99/trafexa-auto/tree/e37c57c18f0848368bc184e89aab0e587083df6a).
- Byggarbete: chatten **Fortsätt Trafexa Auto-planen**. Slutrapporten anger lokala formulär- och API-fixar samt 16 godkända API-tester och 19 godkända webbläsarkontroller. Inget är publicerat. Dessa testresultat är rapporterade av den andra agenten, inte omkörda i denna chat.
- Tidigare källor: **Edit trafexa-auto** och **Set up trafexa-auto** identifierades, men deras innehåll kunde inte hämtas under denna session. Läsning av tidigare ChatGPT-chattar svarade ”Too many requests”. Den fullständiga produktplanen är ännu inte återhämtad.

Planen är ett genomförandeunderlag med en blockerad produktavgränsning. Hela bilhandlarappen kan inte räknas som specificerad eller byggd förrän P0 och de relevanta leveranserna ovan är klara.
