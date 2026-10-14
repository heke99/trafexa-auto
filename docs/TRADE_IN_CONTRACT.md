# Inbytesunderlag

Under Affärer öppnas Inbytesunderlag först när användaren väljer panelen. Företag, aktuell användare, roll, affär och affärsstatus bestämmer panelens åtkomstkontext. Ägare/admin/säljare kan skapa versioner efter granskning; ekonomi/läsroller kan granska befintliga versioner. Demo skickar inga anrop.

Underlaget innehåller registreringsnummer, märke/modell/modellår, mätarställning i kilometer, skick/skador, utrustning, inbytesvärde, skuldens känd/okänd-status och valfri kreditgivare. Försäljningspriset läses från affären av servern och sparas i versionen. När skulden är känd beräknas exakta heltalsören:

- Nettoinbyte = inbytesvärde − skuld.
- Belopp att betala = affärens försäljningspris − nettoinbyte.

Negativt netto betyder att skulden överstiger värderingen. Negativ mellanskillnad visas som möjligt belopp att återbetala enligt underlaget. Okänd skuld ger inga beräknade totalsummor; explicit noll är skilt från saknat underlag. Ingen kreditgivarkontroll eller betalning genomförs.

Sparandet skapar en oföränderlig privat version och aktörbundet auditkvitto. Exakt återförsök använder samma begärans-ID; senaste versionsnummer och förväntat försäljningspris kontrolleras med affären låst. Företag/kund/aktör härleds och verifieras på servern. Historiska kvitton ersätter inte färsk läsning av den aktuella versionslistan. Historik hämtas med högst 50 versioner per sida i fallande versionsordning. Andra användares Auth-ID/e-post skickas inte som författaruppgift: Du/Kollega visas.

Nya versioner tillåts bara för utkast/reserverad affär utan accepterad offert. Förslag ändrar inte offert, kundaccept, skuld, utbetalning, momsmodell, lager eller bilägande. Ett verkligt inbytesköp, dess avtal och eventuella nya offertversion är separata kommande steg. Kontogodkännande och faktisk företagsbehörighet krävs enligt plattformens åtkomstregel. Inga externa meddelanden, providers eller jobb aktiveras.
