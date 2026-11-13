# Direkt affär → kundunderskrift, 13 november 2026

## Nytt flöde

Säljaren väljer bil, befintlig eller ny kund och överenskommet totalpris. Nya kunduppgifter kan fyllas i direkt. Förberedelsen sparar en riktig affär och ett fryst direktavtalsutkast; den skapar **ingen offert, offertacceptans, underskrift eller mejlinbjudan**.

En befintlig kunds kompletteringar förbereds i det privata utkastet. De skrivs till kundregistret först när behörig säljare uttryckligen godkänner exakta kunduppgifter, pris och villkor. Kundens kontaktversion kontrolleras igen under lås; en annan ändring medför en konflikt i stället för en tyst överskrivning.

En godkänd företagsmall kan väljas. Om ingen valts skapas ett verkligt utkast till Trafexa-grundavtal. Säljaren ser den upplösta texten, anger sitt namn och godkänner den före utskick. Då godkänns även grundmallen med ett spårbart revisions-/hashbundet kvitto. Grundtexten påstås inte vara juridiskt certifierad.

`approveAndSendDirectDealAction` registrerar en **account/typed_name**-bekräftelse från en aktuell owner/admin och köar kundens befintliga kontofria signeringsinbjudan. Inget ritat namnteckningsspår fabriceras. Kunden skriver under via sin dokumentlänk. Båda bekräftelserna, exakt avtalsinnehåll och den signerade PDF:en binds med ordinarie hash-/bevis- och arkivflöde.

En redan skickad eller signerad affär återläses som befintligt avtal. Den skapar inte en andra inbjudan på grund av ny UI-nonce. Ändrat pris före utskick ger en ny fryst utkastversion; endast senaste kan godkännas. Vanliga offertbaserade avtal behåller sitt äldre flöde och sina oförändrade canonical-hashvärden.

Sales får skapa affär och identifierad kund samt granska sitt eget förberedda underlag. Owner/admin kan återuppta detta för godkännande. Sales får inte godkänna villkor, signera för företaget eller skicka avtalsinbjudan. Vanliga signerings-/PDF-behörigheter har inte breddats.

## Identitet och privata uppgifter

Namn, mejl och telefon krävs för aktuellt avtalsunderlag. Person-/samordningsnummer kontrolleras med datum och kontrollsiffra; organisationsnummer normaliseras och kontrollsiffran verifieras. Detta är inte kontroll mot folkbokföring, företagsregister eller BankID.

Identitetsnummer sparas i en privat tabell med RLS och utan direkta klient-/servicerättigheter samt i den privata, frysta avtalskällan. Vanliga kundlistor och options-kunduppgifter får endast `identityPresent`. Uppgiften syns i det avtal som den behöriga företagsrepresentanten respektive personliga dokumentmottagaren faktiskt granskar. Produktionskod lägger inte dessa uppgifter i browserstorage, loggar eller mejlinnehåll. Avtalsoriginal behandlas enligt projektets separata privata lagrings- och behörighetsregler.

## Betalning och leverans

Efter riktig kundunderskrift och registrerat original kan betalning och fysisk leverans hanteras i det befintliga avstämningsflödet. Direktkällan har `sourceKind=direct_deal`, `offerId=null` samt verkligt signing-ID och dokumenthash. Betalningsrader binds till den riktiga direktavtalssigneringen. Ingen falsk offert-FK används. Verkliga betalningsattester, reverseringar, reservation och leverans är separata uttryckliga åtgärder; avtalsutskicket utför dem inte automatiskt.

## Verifiering

- **8/8 backendfall PASS:** faktisk migrerad SQL, parsers och server actions, inlinekund, grundmall, återförsök, staged kontakt/CAS, scope-/behörighetsnekning, ogiltig identitet, färsk auktorisering efter commit samt rollseparering där sales förbereder medan owner/admin godkänner och skickar.
- En sammanhängande del av dessa fall kör förberedelse → explicit säljargodkännande → gästunderskrift → riktig PDF/evidens → lagrings-RLS och registrerat original → faktisk portabel TAR-export → separat offline-CLI och byteexakt återställning → actual fulfilment-actions för manuell betalning, reversering, ny betalning och leverans. Noll offert-/offertacceptansrader finns genom hela direktkedjan.
- **15/15 ytterligare arkivgrannar PASS:** native originalarkiv och portabelt arkivpaket. Den äldre evidensvalidatorn accepterar nu account/typed_name endast för företagets direkta avtalsgodkännande; gästprovenienskraven behålls.
- **36/36 riktade grannar PASS:** avtals-PDF, signerad PDF/evidens, befintliga signeringsåtgärder, gästfulfilment, fulfilment-actions och PDF-namnskydd.
- **3/3 tidigare fulla offertbaserade dealer/guest-resor PASS**, inklusive original, betalning/leverans och länkförnyelse.
- **2/2 native PostgreSQL-tvåsessionersprov PASS**, med observerad verklig låsväntan: identiskt prepare ger ett enda underlag, och en konkurrerande kundändring stoppar gammalt godkännande utan underskrift eller mejl. Bevis: [native-proof.json](verification/20261113-direct-deal/native-proof.json).

Nativeprovet använde PostgreSQL 17.11 i en egen container med nätverk `none`, inga publicerade portar och endast syntetiska data. Egna psql-sessioner och testdatabasen stängdes; containern städas av provköraren efteråt. Nativehjälparens cron-/Auth-/Storage-kataloger är lokala testadaptrar, inte verifiering av dessa externa tjänster.

Browser, Auth-cookie, mejlleverantör och Storage-HTTP har kontrollerade testadaptrar i integrationsproven. Ingen hosted mutation, riktig bank, verklig kundunderskrift eller extern mejlleverans utfördes av denna backenddel. Faktisk produktionsinloggning och mottagen signeringslänk kräver separat bevis. Denna rapport är inte ett fullständigt produktionsgodkännande.

## Reproduktion

```sh
node tests/direct-deal-backend.test.mjs
node tests/dealer-guest-complete-journey.test.mjs
node tests/direct-deal-db/native-concurrency.mjs
```

Nativekommandot kräver separat startad nätverksisolerad container `trafexa-direct-deal-native-review` och använder endast sin namngivna lokala databas. Runtime-, UI- och fullsvitsgränser ska bedömas med den samlade granskningen.
