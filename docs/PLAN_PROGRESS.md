# Planläge 15 oktober 2026

## Fortsättning 15 oktober: native originalarkiv

Från main `4fd3c5d`/PR #23 är ett privat originalarkiv för färdiga native avtal implementerat. Uttrycklig arkivering av aktuell ägare/administratör sparar ett unikt par med signerad PDF och JSON-evidens; ekonomi och kunden läser enligt sina befintliga gränser. Första registrerade par vinner. Före arkivering finns märkt genererad kopia; registrerade original återhämtas med hashkontroll eller ger fel utan ny rendering. Migration `20261015100653_native_contract_archive`, hosted rollback och riktade lokala DB-/app-/UI-prov passerar. PR #24:s main `a6a6c972` är integrerad; samlad helsvit 759/759 och produktionsbygge inklusive TypeScript passerar. Servernyckel saknas och ny arkivering stoppar före rendering/uppladdning tills enbart serverns `SUPABASE_SECRET_KEY` konfigurerats direkt i Vercel. Verklig hosted Storage-API-rundresa och publicering är inte verifierade. Separat Storage-backup, långtidsbevarande och återställningsprov återstår. Se [NATIVE_CONTRACT_ARCHIVE](NATIVE_CONTRACT_ARCHIVE.md) och [faktiska verifieringsgränser](IMPLEMENTATION_STATUS.md).

## Historiska fascheckpoints

Utgångspunkt: publicerad main `ecb0e2557979e5b481f1d18cc7668548a700881c`, PR #16. Status avser faktisk funktion och verifiering, inte antal menyval eller kodrader. Föregående slutförda checkpoint: direkt superadmininloggning, obligatoriskt kontogodkännande och privata inbytesförslag; 428 apptester, 75 databastestgrupper och 36 hosted migrationer. Ny leverans: granskad inbytesbilaga till offert/kundvy/PDF, 447 apptester, 55 berörda databastestgrupper samt fyra oberoende QA-grupper och 39 hosted migrationer verifierade. Nästa verifierade leverans är privat inköps-/skickunderlag med PDF: 477 apptester, 31 berörda databastestgrupper och 43 hosted migrationer. Avtalsleveransen har 514 verifierade unika apptestfall, 30 berörda DB-grupper och 49 hosted migrationer; aktiv signering återstår. Ingen procentandel eller leveranstid är fastställd; faserna är olika stora och flera kräver externa avtal.

| Fas | Byggt eller förberett | Återstår |
|---|---|---|
| 0 Produkt/partnerbeslut | Trafexas mål, resurser, roller och integrationernas gränser | Partneravtal, konkreta kanal-/signerings-/ekonomikontrakt och driftansvar |
| 1 Konton/företag | Konto, e-postverifiering, lösenordsåterställning, företagsväxling, roller, personalinbjudningar, superadmin med plattformsöversikt, webbansökningar, obligatoriskt kontogodkännande och versionshanterade kontomejlmallar | Authmallar och affärsmejlkö finns. Resend-domänens DNS är verifierad. Produktionsnyckel, separat Auth SMTP och faktisk leverans/återställning behöver slutverifieras. Filialer, ägaröverlåtelse, organisationens godkännande och full verifiering av inloggade produktionsflöden |
| 2 Lager/inköp | Lagerkort, CSV-import, kostnader, privata bilder, exakt fordonskalkyl, moms/VMB-underlag och privat versionshanterat inköps-/skickunderlag med PDF | Inköpsavtal, lagerintag vid faktiskt inbytesköp och avstämning |
| 3 CRM/affär | Kunder, leads, kontaktlogg, uppföljningar, reservationer, offertversion/PDF, kundens offertgranskning/accept/avböjande, kontrollerad avbrytning, internt versionsbundet inbytesunderlag och granskad offertkoppling till kundvy/PDF | Verkligt inbytesköp/avtal samt verklig samtidig reservationsverifiering |
| 4 Avtal/dokument | Granskade företagsmallar, privata avtalsutkast, selektiv DocuSeal-port, verifierad tvåpartssignering, signerad PDF/signeringsevidens samt privat originalarkiv med konfigurationsspärr | Serverkonfiguration, faktisk hosted Storage-API-verifiering, långtidsbevarande/backup/återställning och slutlig produktionsverifiering |
| 5 Köpfinansiering | Internt finansintresse och behörighetsgränser | Verklig partneransökan, komplettering, erbjudande, kreditbeslut och utbetalningsstatus |
| 6 Ekonomi/leverans | Fordonskalkyl, kostnadsunderlag samt verifierade unika annonsenheter, versionsbundna priser, granskning och låsta månadsunderlag med privat CSV | Fakturautställning, betalning, avstämning, bokföringsexport, leverans och ägarbyte |
| 7 Lagerfinansiering | Produktbehov identifierat | Limit, finansierade bilar, partneravstämning, lösen och frigivning |
| 8 Handlarnätverk | Informationsvy och gränser för privat data | Publicering, inköpsönskemål, matchning, bud och B2B-affär |
| 9 Drift/slutverifiering | Publicerade domäner, lokala browser-/actiontester och rollbacktest i hosted databas | Fulla inloggade produktionsflöden, återställningsprov, incident- och supportprocess |
| 10 Externa integrationer | Annonsutkast, bildval och förberedda inaktiva kanaladapters | Blocket/Wayke-partneråtkomst och färdiga leveranskontrakt; övriga adapters efter prioritering |

Fas 1–3 innehåller stora delar av den interna handlargrunden men är inte helt slutverifierade. Ingen hel fas redovisas som godkänd enbart därför att grundfunktioner finns. Externa integrationer kan förberedas parallellt; avtal och faktisk åtkomst måste finnas innan aktivering.

Arbetsordning för närmaste leveranser: inbytesköp och avtal för det versionsbundna inbytesunderlaget, återstående organisationsflöden, därefter dokument/avtal samt ekonomi/leverans. Faktiska partneravtal kan ändra ordningen för finansieringen.

Se [MASTERPLAN](MASTERPLAN.md) för fulla leveranskrav och [IMPLEMENTATION_STATUS](IMPLEMENTATION_STATUS.md) för aktuella tester och verifieringsgränser. Publik marknadsföring beskriver användbara funktioner; detta interna planläge beskriver även kvarstående arbete.

Aktuell parallell leverans: annonsstatistik och faktureringsantal är implementerade enligt per unik publicerad annons och kanal. Uppdateringar/återförsök och äldre redan publicerade annonser ger inga nya enheter. Kanalpriser och granskat låst månadsunderlag är nu implementerade. Nästa ekonomiarbete är faktisk fakturering och rättelser. Blocket/Wayke behöver externa leveransrevisioner och partnerbehörighet; bankkopplingarna behöver vald partner/produkt och verifierat kontrakt enligt BANK_PARTNER_REQUIREMENTS.md.

2026-10-15: superadmin kan ange framtida kanalpriser, uttryckligen granska tidigare oprissatta annonser och låsa avslutade månadsunderlag. Företaget kan läsa sina uppgifter. Den privata CSV-exporten visar låsta originalrader och exakta belopp exklusive moms. Nästa ekonomisteg är faktisk fakturautställning och rättelser; integrationer väntar fortsatt på partnerunderlag. Se ADVERTISING_BILLING_CONTRACT.md.

2026-10-15, rättelsefortsättning: separata granskade nedsättningar av låsta original och privat rättelse-CSV är byggda och verifierade inför publicering med 606 appfall, 32 berörda databasgrupper och separat hosted rollbackprov. Resend-domänens samtliga DNS-poster är nu verifierade enligt leverantörens återläsning. Produktionsnyckel, Auth SMTP och faktisk leverans är separata återstående driftkontroller; DNS-verifiering ensam bevisar inte mejlutskick.

2026-10-15: granskade rättelser publicerades via PR #23, med 680 verifierade appfall efter registerintegrering och READY-produktion på main 4fd3c5d. Nästa leverans bygger versionshanterade faktureringsuppgifter och privata fakturautkast/PDF. Bokföringssystem är ännu inte valt. Faktisk momsbedömning, utställning, betalning och bokföring återstår.

2026-10-15: faktureringsuppgifter och sparade privata fakturautkast/PDF verifierade inför publicering: 708 appfall, 43 berörda databasgrupper, TypeScript, produktionsbygge och sju nya hosted migrationer. Hosted rollbackprov och åtta nollställda efterkontroller passerar. Ingen faktura utfärdas eller skickas i detta steg.
