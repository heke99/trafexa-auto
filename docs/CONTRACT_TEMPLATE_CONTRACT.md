# Godkända företagsmallar och avtalsutkast

Detta flöde skapar privata, oföränderliga försäljningsavtalsutkast från en exakt accepterad offert och en uttryckligen godkänd företagsmall. Ett utkast är inte ett signerat avtal, leveransbesked, finansieringsgodkännande eller betalningsutfästelse. Inga mejl, signeringsförfrågningar, dokumentuppladdningar eller externa jobb skapas. Inköps-/leverantörsavtal är ett separat framtida flöde.

Mallfamiljer har företagsscope och ett stabilt templateId. Varje redigering skapar en ny oföränderlig innehållsversion med titel 2..160 Unicodekodpunkter och ren text 2..12000 kodpunkter. Radbrytning, CR och tab stöds. Övriga kontrolltecken avvisas. Texten är aldrig HTML eller körbar kod. Endast dessa exakta platshållare tillåts:

- {{company.name}}, {{company.organisation_number}}
- {{customer.name}}, {{customer.email}}
- {{vehicle.registration}}, {{vehicle.make}}, {{vehicle.model}}, {{vehicle.model_year}}
- {{offer.version}}, {{offer.price_ore}}
- {{trade_in.value_ore}}, {{trade_in.amount_to_pay_ore}}

Okända eller obalanserade platshållare och kvarvarande klammerparenteser avvisas. PDF gör en enda ersättningspassage utan rekursiv tolkning av kunduppgifter. Belopp presenteras som exakta SEK-värden med BigInt. Saknad kundepost anges uttryckligen som Ingen uppgift; saknat inbyte som Inget inbyte, aldrig noll. Den ursprungliga accepterade offertens villkor visas alltid i PDF:ens fasta avsnitt, även om malltexten inte har någon sådan platshållare.

Mallens godkännandestatus är draft/approved/retired med separat approvalVersion. Owner/admin måste uttryckligen granska och godkänna eller återkalla en version, med CAS, skäl och aktörsbundet begärans UUID. Godkänd innehållsversion kan inte redigeras. Den tidigare godkända versionen förblir aktiv under redigering av ett nytt utkast. Godkännande av den senaste nya versionen återkallar tidigare godkänd version atomärt och sparar dess föregående värde i privat revisionslogg. Högst en godkänd version per mallfamilj tillåts av ett partiellt unikt index.

Privat läsning och generering tillåts för owner/admin/finance. Finance får endast läsa godkända mallversioner och deras godkända familjer; nya eller återkallade mallutkast och deras metadata returneras inte av RPC eller serveråtgärd. Endast owner/admin får skapa eller granska mallar. Sales/viewer har ingen läsrätt till kontraktsuppgifter, även med en giltig företagskaka. Verifierad Auth, aktuell kontoapproval, aktivt företag och aktuellt medlemskap kontrolleras före och efter serveråtgärdens IO. SQL låser Auth/approval och företag/medlemskap före affär och mallfamilj, med en konsekvent advisory-lock-ordning för malländringar. Användarmetadata, en epostadress eller en skickad aktörsUUID ger aldrig behörighet. Privata tabeller har RLS och saknar direkta grants för anon/authenticated/service_role.

Ett nytt avtalsutkast använder endast ID för affär, exakt offert och godkänd mallversion samt dess förväntade approvalVersion. Den accepterade statusen kontrolleras i immutable kundgranskningshistorik, exakt företag/affär/offert/version. Utgångsdatum efter en redan giltig accept omtolkar inte accepten. Avbruten affär kan inte generera nya utkast. Kund-, företags-, fordons-, pris-, moms- och eventuella inbytesuppgifter kopieras från serverns oföränderliga offersnapshot via dess uttryckliga whitelist. Inga interna skickanteckningar, långivarnamn eller inköpspriser följer med. Den exakta mallversionens titel/text/godkännandeversion fryses samtidigt.

Varje utkast får en stigande version per affär. Kombinationen företag/exakt offert/mallversion är unik: ett annat nonce kan inte skapa en dubblett av samma källa. Identiskt aktörsbundet återförsök med nuvarande behörighet returnerar historisk kvittens före rörliga accept-/mall-/statuskontroller. Ändrat underlag med samma UUID ger konflikt. Mallar, avtal och revisionslogg kan inte raderas eller skrivas över genom detta flöde.

Mallfamiljer pagineras i fallande templateId-ordning med 50 familjer per sida. Varje familj visar senaste utkast och nuvarande godkända version när dessa skiljer sig. En riktad familjeläsning gör att nyskapad slumpmässig UUID alltid kan granskas färskt utan att utgå från en historisk kvittens. Avtalshistorik pagineras med 50 versioner och företag-/affärsbunden cursor. Mallväljaren kan läsa vidare bland godkända familjer. Privata PDF-versioner hämtas på /api/contracts/[id]/pdf med samma färska behörighetskontroll; inga publika länkar skapas.

Bolaget ansvarar för att innehållet i varje godkänd mall passar affären och gällande villkor. Teknisk godkännandekontroll ersätter inte juridisk granskning. Funktionen utger sig inte för att leverera DocuSeal-signering; eventuell återanvändning av DocuSeal-källkod och framtida extern signering hanteras separat.

Verifiering: tio serveråtgärdsgrupper och tio verkliga PostgreSQL/PGlite-grupper inkluderar både en faktisk publicering/kundaccept via RPC och oföränderligt kontrakt från samma offer-ID. Testerna omfattar privata roller, aktuellt kontogodkännande, nonce/CAS, atomär mallersättning, avbruten affär, 53 mallfamiljer/53 kontraktsversioner, riktad familjeläsning och full-/hosted-basis rollback. Rollbackbevis använder kollisionskontrollerade ee240000-fixturer och skickar inget externt. Fullt autentiserad produktionswebbläsare och fleranslutningslåsväntan är separata verifieringar.
