# Ekonomi- och annonssimulering, 12 november 2026

Baslinje: publicerad main `32add2dfe75ab1e11c1c7ebfb64665f7e2bfb950`, med den lokala F04-rättningen för nekad kalkylåtkomst. Ingen produktionsdata, bank, partner eller verklig mejlmottagare användes.

Den sammanhängande lokala simuleringen passerade **8 av 8 kontrollpunkter**:

| Kontrollpunkt | Faktiskt kontrollerat utfall |
| --- | --- |
| Bil registreras | Riktig `create_stock`-RPC skapar bilen med 100 000 kr inköp och 150 000 kr försäljningspris inklusive moms. |
| F10-kostnad | Riktig action och migrerad SQL registrerar 1 250,50 kr service. Första commitsvaret kastas avsiktligt bort; identiskt återförsök ger samma kvitto och exakt en kostnadsrad. |
| Moms och kalkyl | Riktig läs-/sparaction och SQL sparar 20 000 kr inköpsmoms och 250,10 kr kostnadsmoms. Kostnad 1 250,50 kr, utgående moms 30 000 kr och kalkylresultat 38 999,60 kr verifieras som exakta heltalsören. |
| Annonspris och publicering | Riktig quote-/sendaction och SQL accepterar 125 kr exklusive moms. Trots senare kanalpris 550 kr behålls accepterade 125 kr. Samma sändningsbegäran köar en gång. Ett simulerat verifierat publiceringssvar ger en unik publicering och ingen extra avgift vid återförsök. |
| Statistik | Faktisk SQL räknar en ny unik publicering för kanalen och månaden. |
| Låst månad och faktura | Efter uttrycklig historisk tidsfixtur låses september. Faktureringsprofiler, moms och nummerserie granskas genom riktiga SQL-API:er. Faktura blir 125 + 31,25 = 156,25 kr. Verklig PDF genereras och beloppet läses med `pdftotext`. |
| Betalningsavstämning | Manuellt syntetiskt underlag registreras: 100 kr delbetalning lämnar 56,25 kr. Samma request återförsöks utan ny post; ytterligare 56,25 kr ger avstämd faktura med noll kvar. |
| Kredit | Faktisk helkreditering och kredit-PDF bevarar originalets innehåll/hash. Fordran blir noll och mottagna 156,25 kr visas som överskott att hantera separat. Ingen bankåterbetalning påstås ha skett. |

## Reproduktion och bevis

Från repositoryroten, efter miljöförberedelserna i [TEST_ENVIRONMENT.md](TEST_ENVIRONMENT.md):

```sh
node docs/verification/20261112-simulation/finance-system-simulation.mjs
```

- [Reproducerbart simuleringsskript](verification/20261112-simulation/finance-system-simulation.mjs).
- [Resultat med tidsstämplade kontrollpunkter](verification/20261112-simulation/finance-system-simulation-result.json).
- PDF-filer skapas tillfälligt under `/tmp/simulation-ad-invoice.pdf` respektive `/tmp/simulation-ad-credit.pdf`; de är syntetiska lokala provdokument.

## UI och F04

F04 reproducerades först i faktisk Chromium vid 320 och 1440 px: nekad sparning lämnade gamla privata belopp och momsformuläret kvar. Rättningen skiljer åtkomstnekande från ett korrigerbart valideringsfel, tömmer kalkylens källa och momsuppgifter vid nekad/okänd eller otillräckligt verifierad sparning och förhindrar samtidiga dubbla sparningar. Ett bekräftat `access_denied` från både läsning och sparning meddelas även till kostnadspanelens befintliga rensning.

Riktade prov:

- Kalkylens actions: 10/10 PASS, inklusive verklig Auth-/medlemskaps-/godkännandekod över kontrollerad IO och återkallelse efter RPC.
- Kalkylens verkliga komponent: 11/11 PASS, med appens riktiga CSS, 320/1440 px, bevarade fält vid tydligt momsvalideringsfel och rensning vid nekad läsning/sparning.
- F10-kostnads-UI och förälderns nekad-kalkyl-signal: 4/4 PASS. Kostnadsbegärans stabila nonce och återförsök är fortsatt separata från momsmetadata.

UI-proven verifierar den verkliga kalkylkomponentens callback och den verkliga förälderns rensning via dess kontrollerade dynamiska komponentadapter. Det är inte ett påstående om en sammanhängande autentiserad Next/RSC-resa i produktion.

## Exakta IO-gränser

- **Riktig kod:** fordonskostnadsaction, kalkylens läs-/sparactions, annonsens quote-/sendactions, parsers, ekonomiska SQL-funktioner och PDF-renderare.
- **Riktig lokal databas:** hela migrationskedjan återspelas i PGlite, med rollkontext och syntetiska användare/företag. Supabase-klienttransporten och det valda företagets cookie ersätts av en lokal adapter; Auth-användare, medlemskap och godkännande läses från den lokala SQL-fixturen.
- **Kontrollerad extern publicering:** inget Blocket-/Wayke-anrop görs. En syntetisk serviceidentitet lämnar det verifierade publiceringssvaret till den riktiga SQL-statusfunktionen. Detta bevisar enhets-/prislogik, inte partnerns synliga annons.
- **Historisk period:** endast de lokala syntetiska publicerings-/trackingdatumen placeras i september 2026 för att prova en redan avslutad månad. Det är en testförberedelse, ingen tillgänglig backdateringsåtgärd i appen.
- **Manuellt bankunderlag:** syntetiska transaktionsreferenser används; ingen bankverifiering, överföring, bokföring eller återbetalning utförs.
- **Separata browserprov:** riktiga komponenter och klick, med externa browseranrop blockerade. Ingen hosted inloggning eller riktig kundsession används.
- **Städning:** databasen stängs efter simuleringen. Inga hosted poster skapas och inga produktionsflaggor ändras.

Resultatet styrker den lokala kedjans tillstånd och belopp. Verklig partnerleverans, bankkoppling, mottagen e-post och native PostgreSQL-samtidighet kräver separata prov.
