# Synlig arkivering och radering av affärer, 15 november 2026

## Beteende

Arkivera och Radera affär visas direkt på affärskortet före öppning. Återställ i listan visas direkt på arkiverade kort. En enkel bekräftelse ersätter manuellt angiven anledning och extra kryssruta; granskad version, stabil begäran och en kontrollerad standardanledning sparas fortfarande i serverflödet.

Arkivering tar bort affären från den aktiva listan. Avtal, PDF, underskrifter och historik finns kvar under Arkiverade. En fullt signerad affär kunde tidigare felaktigt blockeras när affärens grundstatus fortfarande var draft; kontrollen skiljer nu färdigsignerat underlag från väntande underskrifter. Aktiva reservationer, väntande kundunderlag och oavslutade pengar skyddas fortfarande. Ett accepterat offertunderlag räknas som behandlat först när motsvarande avtal verkligen har båda hashbundna underskrifterna.

Radering är en permanent borttagning från handlarens aktiva och arkiverade affärslistor, inte en fysisk radering av original eller personuppgifter. Detta gäller osignerade affärer utan skyddad affärshistorik och fungerar även för det vanliga direktflödets sparade osignerade underlag. Dessa tekniska original och granskningsspår bevaras internt. Affärer med underskrifter, kundärenden, betalningar eller andra skyddade affärsrelationer kan inte raderas på detta sätt och hänvisas till arkivering. Ingen bankbetalning, försäljning eller avtalsannullering skapas av liståtgärderna.

## Rättningar och skydd

Den tidigare bekräftelsen utlöste endast router.refresh, vilket inte säkert hämtade om den aktiva klientlistan. Ett verifierat kvitto döljer nu rätt kort direkt och startar verklig registerhämtning. Lokal visningsstatus är operationsbunden och blockerar inte att affären återkommer vid byte till Arkiverade eller efter återställning. Okända resultat behåller kortet och exakt samma begäran för säker kontroll. Läsfel och konflikter har synlig ny hämtning och Avbryt.

Radering får en privat oföränderlig borttagningspost. Grundaffär, kund, bil, dokument och teknisk historik skrivs inte om. Alla affärslistor och levande räknare utesluter borttagna poster. Grundskyddet för arkiverade affärer gör även borttagna affärer skrivskyddade; en gammal flik kan inte skicka ett nytt avtal för ett borttaget id. Borttagning kan inte återställas genom arkivets vanliga återställning. Färskt godkänt konto, aktivt valt företag och ägar-/administratörsroll krävs för förändringar.

## Planen efter denna rättning

De återstående punkterna är kvar i PLAN_PROGRESS: verkligt slutligt användarprov, separat extern avtalsbackup, säljarstatistikens rapportvy samt verkliga annons-/bank-/bokföringsanslutningar när leverantör och partneråtkomst är valda. Denna rättning slutför inte dessa integrationer.

## Verifiering

Verkliga isolerade SQL-/actionprov och browserprov följer arkivering/återställning, radering av primärt förberett osignerat direktavtal, kvarvarande original, skyddade affärer, roller/företag, stabila återförsök och mobil-/desktoplayout. Berörda register-, signerings-, betalnings- och dokumentflöden körs i en separat regression; sista per-filresultat ersätter eventuella omkörningar utan dubbelräkning. Verifierat: 27 kanoniska berörda testfiler, 286 godkända unika fall utan överhoppade. Ett befintligt exakt DTO-prov uppdaterades för det nya removed-fältet; slutomkörningen ersätter tidigare per-filresultat. Typkontroll och normalt produktionsbygge passerar. Databasversion och produktion följs i releasens PR. Inga verkliga affärer arkiveras eller tas bort som produktionsprov.


## Tillämpning och produktionskontroll

Migration `20261115090124_deal_archive_and_remove_controls.sql` är tillämpad. Den är kompatibel med den tidigare klientens DTO:er och infördes före publiceringen av de nya knapparna. Fyra verkliga affärer och avtalsoriginalens kontrollvärde är oförändrade; inga borttagningsposter skapades som produktionsprov. Den färdigsignerade verkliga affären kan nu arkiveras enligt ägarens behörighetsbedömning. Ett annat ärende med aktivt kundunderlag skyddas fortfarande och får en tydlig förklaring. Det nya raderings-RPC:t ger ingen anonym exekveringsrätt. Alla befintliga konto-/företags- och signaturkontroller gäller fortsatt.
