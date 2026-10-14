# Planläge 14 oktober 2026

Referens: publicerad main `3042d900ecc04dec5c3924011e9740b909d9fb36`, PR #11. Status avser faktisk funktion och verifiering, inte antal menyval eller kodrader. Ingen procentandel eller leveranstid är fastställd; faserna är olika stora och flera kräver externa avtal.

| Fas | Byggt eller förberett | Återstår |
|---|---|---|
| 0 Produkt/partnerbeslut | Trafexas mål, resurser, roller och integrationernas gränser | Partneravtal, konkreta kanal-/signerings-/ekonomikontrakt och driftansvar |
| 1 Konton/företag | Konto, e-postverifiering, lösenordsåterställning, företagsväxling, roller, personalinbjudningar, superadmin, webbansökningar | Filialer, ägaröverlåtelse, organisationens godkännande och full verifiering av inloggade produktionsflöden |
| 2 Lager/inköp | Lagerkort, CSV-import, kostnader, privata bilder, exakt fordonskalkyl och moms/VMB-underlag | Inköpsunderlag, skickbedömning och avstämning |
| 3 CRM/affär | Kunder, leads, kontaktlogg, uppföljningar, reservationer, offertversion/PDF, kundens offertgranskning/accept/avböjande och kontrollerad avbrytning | Inbyte samt verklig samtidig reservationsverifiering |
| 4 Avtal/dokument | Offert-PDF och avstängd signeringsgrund | Avtalsmallar, elektronisk underskrift, signerade filer/evidens och aktivt dokumentarkiv |
| 5 Köpfinansiering | Internt finansintresse och behörighetsgränser | Verklig partneransökan, komplettering, erbjudande, kreditbeslut och utbetalningsstatus |
| 6 Ekonomi/leverans | Fordonskalkyl och kostnadsunderlag | Faktura, betalning, avstämning, bokföringsexport, leverans och ägarbyte |
| 7 Lagerfinansiering | Produktbehov identifierat | Limit, finansierade bilar, partneravstämning, lösen och frigivning |
| 8 Handlarnätverk | Informationsvy och gränser för privat data | Publicering, inköpsönskemål, matchning, bud och B2B-affär |
| 9 Drift/slutverifiering | Publicerade domäner, lokala browser-/actiontester och rollbacktest i hosted databas | Fulla inloggade produktionsflöden, återställningsprov, incident- och supportprocess |
| 10 Externa integrationer | Annonsutkast, bildval och förberedda inaktiva kanaladapters | Blocket/Wayke-partneråtkomst och färdiga leveranskontrakt; övriga adapters efter prioritering |

Fas 1–3 innehåller stora delar av den interna handlargrunden men är inte helt slutverifierade. Ingen hel fas redovisas som godkänd enbart därför att grundfunktioner finns. Externa integrationer kan förberedas parallellt; avtal och faktisk åtkomst måste finnas innan aktivering.

Arbetsordning för närmaste leveranser: inbytesunderlag, inköps-/skickunderlag och återstående organisationsflöden, därefter dokument/avtal samt ekonomi/leverans. Faktiska partneravtal kan ändra ordningen för finansieringen.

Se [MASTERPLAN](MASTERPLAN.md) för fulla leveranskrav och [IMPLEMENTATION_STATUS](IMPLEMENTATION_STATUS.md) för aktuella tester och verifieringsgränser. Publik marknadsföring beskriver användbara funktioner; detta interna planläge beskriver även kvarstående arbete.
