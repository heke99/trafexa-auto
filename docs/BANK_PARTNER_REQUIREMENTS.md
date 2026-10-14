# Underlag för bank- och finansieringskopplingar

Nuvarande finansieringsformulär registrerar ett internt intresseärende. Det skickar ingen bankansökan och visar inte ett partnerbekräftat kreditbeslut eller en utbetalning. Ingen bank, bankprodukt, partneranslutning eller skrivbehörighet har valts i denna leverans.

## Vad som behöver bestämmas

| Område | Underlag före faktisk anslutning |
| --- | --- |
| Partner och produkt | Namngiven bank/finanspartner, slutkundsfinansiering eller lagerfinansiering, avtalad roll för Trafexa och varje handlare. |
| Behörighet | Bankens verifierade API-kontrakt, testmiljö, servercredentials, produkt- och företagsbehörighet samt återkallelse. |
| Ansökan | Partnerns obligatoriska fält, identitetskontroll, information till sökanden, godkänd behandling och överföring av personuppgifter. Samla inte personnummer eller bankuppgifter innan syfte och krav är fastställda. |
| Livscykel | Separata partnerbekräftade tillstånd för mottagen ansökan, komplettering, erbjudande, beslut, avtal och faktisk utbetalning. Ett internt intresse eller godkänt beslut räknas inte som betalt. |
| Meddelanden | Verifierade statusanrop/webhooks, signaturkontroll där partnern stöder det, idempotens, händelseordning och avstämning av borttappade besked. |
| Belopp | Exakta heltalsöre, valuta, giltighet, kostnader och betalningsmottagare. Kreditlimit, tillgängligt utrymme och bokförd skuld kräver egna partnerkällor. |
| Åtkomst och spårbarhet | Färsk kontoapproval och företagsroll vid läsning och skrivning; versionsbundna ansökningar, begränsad datalagring och granskbar historik. |

När första partner är vald kan Trafexa bygga en konkret adapter och dess kontraktstester. Fram till dess kan UI för interna ärenden och kompletteringsbehov utvecklas med tydlig intern status. Ingen generell bankendpoint, påhittad API-nyckel eller simulerat kreditbeslut ska visas som en aktiv anslutning. PSD2-kontoåtkomst, kundfinansiering och lagerfinansiering är skilda kopplingar och kan inte ersätta varandras partneravtal eller API-kontrakt.
