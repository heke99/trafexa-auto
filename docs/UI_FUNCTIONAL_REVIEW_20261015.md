# UI och funktioner: uppföljande granskning

Granskningen utgår från main `64ee46b` och använder syntetiska data. Den skiljer reproducerbara fel från funktioner som behöver en egen implementation eller partneranslutning. Produktions- och testbevis redovisas i leveransrapporten, inte genom att denna lista finns.

## Rättningar i denna etapp

- Dokumentlistan saknade nedladdning av arkiverade offerter. Den använder nu befintlig skyddad PDF-route för den egna butikens kanoniska offertarkiv. Endast ägare, administratör och finansansvarig får länken. Demo och övriga dokumentformat får ingen missvisande nedladdning. Serverns arkivkontroll avgör fortsatt faktisk åtkomst; lagringsvägen används inte som auktorisation.
- Superadmins ändring av handläggningsstatus kunde fastna på en gammal ansökningsversion efter samtidig ändring. En definitiv versionskonflikt rensar granskning och begäransreferens, läser aktuell ansökan och kräver ny granskning. Okänt sparresultat behåller samma begäransreferens för säkert återförsök.
- Finansformulärets affärsväljare använde endast arbetsytans senaste 500 affärer och visade bara kund och pris. Den använder nu befintligt serverregister med sökning och sidindelning och visar bil, registreringsnummer, kund, pris och datum. Företags-/rollbyte eller nekad registerläsning rensar valet. Kopplingen är fortsatt valfri och innebär ingen bankansökan.
- Kundkontaktloggens förklaring till en nekad samtidig uppföljningsändring försvann vid lyckad automatisk omläsning. Konflikten ska synas efter omläsningen utan falskt lyckandemeddelande; ett nytt läsfel eller nekad åtkomst har företräde.

## Rekommenderad fortsatt ordning

Punkterna har därefter byggts vidare enligt [fortsättningens faktiska kontrakt](DEALER_NEXT_STEPS_20261015.md). Listan nedan bevarar granskningens ursprungliga prioritering och innebär inte att återförsöksskydd, kontosökning, dokumentöversikt eller första leverans-/nätverksflödet fortfarande saknas. De uttryckliga begränsningarna i det nya kontraktet gäller fortsatt.

1. **Säkra återförsök för äldre skapandeflöden.** Kundregistrering och finansintresseanmälan saknar beständig, payloadbunden begäransreferens. Ett lyckat sparande med förlorat svar kan därför följas av en dubblett vid manuellt återförsök. Inför atomisk RPC/kvittens per företag, aktör och begärans-ID. Namn eller e-post ska inte användas som automatisk dubblettnyckel.
2. **Snabbare superadminhandläggning.** Lägg till serverstödd kontosökning via e-post, mobilkort för inkomna ansökningar och ett uttryckligt överlämningsflöde för kontoinbjudan som förberetts av en annan administratör. För närvarande blockeras den senare situationen säkert, men vägen vidare är otydlig.
3. **Samlad dokumentöversikt.** Arkiverade offerter blir direkt tillgängliga här; avtalsoriginal, signeringsbevis och ekonomidokument följer fortfarande egna flöden. En gemensam lista behöver typade källor, sidindelning och rätt behörighet per dokumenttyp.
4. **Rollanpassad introduktion och plattformsroller.** Startsidan behöver nästa steg som matchar användarens behörighet. Support, ekonomi och integrationsdrift bör få separata plattformsbehörigheter i stället för att alla administrativa uppgifter kräver full superadmin.
5. **Full affärskedja och drift.** Betalningsavstämning, uttryckligt leverans-/avslutsflöde och operativ översikt över fastnade partnerjobb är separata funktioner att bygga och verifiera. Handlarnätverket är fortfarande en informations-/kontaktvy. Blocket och finanspartners kräver verifierad partneranslutning innan faktisk extern leverans eller kreditprocess kan aktiveras.

## Verifieringsgräns

Webbläsarproven bygger faktiska React-komponenter med appens CSS och syntetiska serversvar. De verifierar kontroller, navigering, felåterhämtning och roll-/företagsbyten. Befintliga PDF-routeprov verifierar separat nedladdningens serverkontroller. Granskningen använder inga verkliga företagsändringar, kontoinbjudningar, annonser, fakturor eller utskick.
