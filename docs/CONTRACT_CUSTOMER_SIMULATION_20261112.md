# Sammanhängande kund- och avtalssimulering, 12 november 2026

Körningen utgår från main `32add2d` och den lokala rättningen av felmeddelandets fokus. **Fyra av fyra sammanhängande browserresor passerar:** kunden respektive handlaren först, vid 320 och 1440 px bredd (1000 px höjd). Slutkörningen tog 31,720 s. Den befintliga kundkomponentens browserregression passerar också 21/21 fall; de två utökade fokusfallen passerar separat 2/2.

## Vad som faktiskt kopplats ihop

Den verkliga `GuestCustomerDocument` renderas och hydreras i Chromium. Lokala HTTP-anrop går till de faktiska serveråtgärderna, aktuella SQL-migrationer och riktig PDF-/arkivkod. Provservern använder asynkront avskilda requestcookies. En personlig länk ur det genererade provmejlet öppnar den riktiga invitation-routen, som sätter en HttpOnly-cookie och tar bort token från sidans URL.

Varje resa omfattar:

1. Handlarens faktiska offertåtgärd, sparad version och genererad mejlinbjudan.
2. Kunden granskar, bekräftar i UI och får ett verkligt sparat offertsvar.
3. Godkänd avtalsmall, fryst utkast och signeringsinbjudan skapas genom ordinarie actions.
4. Nekat PDF-namn sparar ingen kundunderskrift och bevarar kundens inmatning. Därefter fungerar ett namn som stöds utan translitterering.
5. Vid gatewayfel före commit återanvänds exakt samma granskning och request-ID. Vid gatewayfel efter commit visar ny läsning färdigsignerat avtal utan ytterligare underskrift.
6. Båda signerordningarna slutar med exakt en kundunderskrift och en företagsunderskrift.
7. Kundens färdigmejl öppnar en läslänk. Riktiga PDF- och evidensnedladdningar fungerar före och efter arkivering. Arkivet innehåller två objekt; byteidentitet och evidensens PDF-hash verifieras mot de lagrade originalen.
8. Kontrollerad utgång av länken rensar kundvyn och ger 403 på PDF-hämtning. Ingen konto-/lösenordsinmatning eller gäst-Auth används.

Alla fyra resor saknade oväntad extern trafik, JavaScriptfel och serverfel. De avsiktliga gateway-503- och utgången-länk-403-svaren syns i browserkonsolen och räknas som negativa prov, inte som lyckade leveranser.

## UI-fynd och rättning

Vid en känd valideringsnekning låg feltexten helt ovanför viewporten, medan fokus hamnade på `BODY`. Användaren kunde därför stå kvar vid namnformuläret utan att se förklaringen. Före rättningen låg alertens övre kant på följande skärmpositioner:

| Signerordning | Bredd | Före | Efter | Fokus efter |
| --- | ---: | ---: | ---: | --- |
| Kund först | 320 | −642 px | 285 px | Felmeddelandet |
| Kund först | 1440 | −307 px | 61 px | Felmeddelandet |
| Handlare först | 320 | −808 px | 218 px | Felmeddelandet |
| Handlare först | 1440 | −482 px | 246 px | Felmeddelandet |

`GuestCustomerDocument` gör nu befintligt felmeddelande programmässigt fokuserbart och fokuserar det när ett nytt fel visas. Kunduppgifterna bevaras vid känd valideringsnekning. Regressionen väntar på både korrekt fokus och faktisk position i viewporten; sidans vanliga mjuka scroll gör en omedelbar positionsmätning otillräcklig.

Screenshots av offert, färdigsignerat avtal, validering och utgången länk producerades i båda bredderna. Granskade exempel visar läsbara kort och tydliga status-/nedladdningsknappar utan horisontell overflow. När den andra parten signerar behöver kunden fortfarande välja **Kontrollera dokumentets status**; automatisk uppdatering har inte införts.

## Verifieringsgränser och underlag

- Serveråtgärdernas transport är en isolerad lokal adapter, **inte Nexts fullständiga RSC-/Server Action-protokoll**. Den verkliga komponenten, invitation-routen, SQL, renderarna och nedladdningsrutterna körs.
- Auth, Resend och Storage-HTTP ersätts av kontrollerade adaptrar. Lagringskatalog och RLS kontrolleras i migrerad PGlite. Verklig SMTP-leverans, produktionsinloggning, native PostgreSQL-samtidighet eller extern filbackup bevisas inte av denna körning.
- Länkens utgång simuleras genom tidsändring av enbart isolerade provposter. Ingen produktion eller verklig mottagare berörs.
- Körskript, maskerad rapport, loggar, PDF-prov och bilder finns i arbetsytans `scratch/trafexa-sim-contracts-20261112/`. Stora bilder läggs inte i Git. `report-before-error-focus.json` bevarar föremätningen och `report.json` slututfallet.
- Reproduktion i aktuell arbetsyta: `node /workspace/scratch/trafexa-sim-contracts-20261112/browser-flow.test.mjs` från projektroten. Chromium behöver exekveringsmiljöns vanliga godkända browseråtkomst.
- Varaktig UI-regression: `node tests/guest-customer-ui.test.mjs`.

Lokala databaser, browserkontexter och HTTP-servrar stängs av testerna. Inga produktionskonton, mejl, annonser eller kunddokument skapades. Utfallet är godkänt för denna isolerade kundkedja; det utgör inte ett releasegodkännande av hela systemet.
