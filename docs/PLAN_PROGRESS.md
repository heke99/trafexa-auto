# Planläge 14 oktober 2026

Utgångspunkt: publicerad main `ecb0e2557979e5b481f1d18cc7668548a700881c`, PR #16. Status avser faktisk funktion och verifiering, inte antal menyval eller kodrader. Föregående slutförda checkpoint: direkt superadmininloggning, obligatoriskt kontogodkännande och privata inbytesförslag; 428 apptester, 75 databastestgrupper och 36 hosted migrationer. Ny leverans: granskad inbytesbilaga till offert/kundvy/PDF, 447 apptester, 55 berörda databastestgrupper samt fyra oberoende QA-grupper och 39 hosted migrationer verifierade. Nästa verifierade leverans är privat inköps-/skickunderlag med PDF: 477 apptester, 31 berörda databastestgrupper och 43 hosted migrationer. Avtalsleveransen har 514 verifierade unika apptestfall, 30 berörda DB-grupper och 49 hosted migrationer; aktiv signering återstår. Ingen procentandel eller leveranstid är fastställd; faserna är olika stora och flera kräver externa avtal.

| Fas | Byggt eller förberett | Återstår |
|---|---|---|
| 0 Produkt/partnerbeslut | Trafexas mål, resurser, roller och integrationernas gränser | Partneravtal, konkreta kanal-/signerings-/ekonomikontrakt och driftansvar |
| 1 Konton/företag | Konto, e-postverifiering, lösenordsåterställning, företagsväxling, roller, personalinbjudningar, superadmin med plattformsöversikt, webbansökningar, obligatoriskt kontogodkännande och versionshanterade kontomejlmallar | Authmallar och affärsmejlkö finns. Ägaren har nu bekräftat att mejlleverantör saknas; Resend-domänen är förberedd. DNS, produktionsnyckel, separat Auth SMTP och faktisk leverans/återställning återstår. Filialer, ägaröverlåtelse, organisationens godkännande och full verifiering av inloggade produktionsflöden |
| 2 Lager/inköp | Lagerkort, CSV-import, kostnader, privata bilder, exakt fordonskalkyl, moms/VMB-underlag och privat versionshanterat inköps-/skickunderlag med PDF | Inköpsavtal, lagerintag vid faktiskt inbytesköp och avstämning |
| 3 CRM/affär | Kunder, leads, kontaktlogg, uppföljningar, reservationer, offertversion/PDF, kundens offertgranskning/accept/avböjande, kontrollerad avbrytning, internt versionsbundet inbytesunderlag och granskad offertkoppling till kundvy/PDF | Verkligt inbytesköp/avtal samt verklig samtidig reservationsverifiering |
| 4 Avtal/dokument | Granskade företagsmallar, privata avtalsutkast, selektiv DocuSeal-port, verifierad tvåpartssignering samt signerad PDF och signeringsbevis | Originalfilsarkiv, långtidsbevarande och slutlig produktionsverifiering |
| 5 Köpfinansiering | Internt finansintresse och behörighetsgränser | Verklig partneransökan, komplettering, erbjudande, kreditbeslut och utbetalningsstatus |
| 6 Ekonomi/leverans | Fordonskalkyl och kostnadsunderlag | Faktura, betalning, avstämning, bokföringsexport, leverans och ägarbyte |
| 7 Lagerfinansiering | Produktbehov identifierat | Limit, finansierade bilar, partneravstämning, lösen och frigivning |
| 8 Handlarnätverk | Informationsvy och gränser för privat data | Publicering, inköpsönskemål, matchning, bud och B2B-affär |
| 9 Drift/slutverifiering | Publicerade domäner, lokala browser-/actiontester och rollbacktest i hosted databas | Fulla inloggade produktionsflöden, återställningsprov, incident- och supportprocess |
| 10 Externa integrationer | Annonsutkast, bildval och förberedda inaktiva kanaladapters | Blocket/Wayke-partneråtkomst och färdiga leveranskontrakt; övriga adapters efter prioritering |

Fas 1–3 innehåller stora delar av den interna handlargrunden men är inte helt slutverifierade. Ingen hel fas redovisas som godkänd enbart därför att grundfunktioner finns. Externa integrationer kan förberedas parallellt; avtal och faktisk åtkomst måste finnas innan aktivering.

Arbetsordning för närmaste leveranser: inbytesköp och avtal för det versionsbundna inbytesunderlaget, återstående organisationsflöden, därefter dokument/avtal samt ekonomi/leverans. Faktiska partneravtal kan ändra ordningen för finansieringen.

Se [MASTERPLAN](MASTERPLAN.md) för fulla leveranskrav och [IMPLEMENTATION_STATUS](IMPLEMENTATION_STATUS.md) för aktuella tester och verifieringsgränser. Publik marknadsföring beskriver användbara funktioner; detta interna planläge beskriver även kvarstående arbete.
