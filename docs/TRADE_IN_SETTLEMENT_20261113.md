# Manuell inbytesavräkning

Avräkningen utgår från det verkliga signerade och arkiverade avtalet. För försäljningspris S, inbytesvärde V och känd skuld D är kundnettot C=S−V+D. Kundinbetalning är max(C,0), utbetalning till kund max(−C,0), och långivarbetalning D. Alla belopp beräknas i hela ören; bilvärde/pris/skuld behåller originaltaket, medan beräknad kontantavräkning kan nå nästan dubbla taket.

Owner/admin registrerar separata manuella betalningsattester per kategori, med datum, unik bankreferens, underlagsnotering, uttrycklig granskning och aktuell avtals-hash. Dessa är uppgifter från handlaren, inte verifierade bankhändelser. Systemet överför inga pengar och kontaktar ingen långivare. Reversering skapar en ny oföränderlig motsatt post i exakt samma kategori och avtalskälla. CAS/version, återförsöks-ID och bankreferensgränser förhindrar dubbelregistrering och överavräkning.

Leverans kräver exakt avstämd kundinbetalning, kundutbetalning och långivarbetalning, fysisk inbytesanskaffning kopplad till samma signerade dokument, inbytesversion, bruttoinbytesvärde och skuld samt bilens aktiva reservation. Saknad anskaffning kan inte ersättas av en betalningsattest. Leverans markerar bilen såld och affären slutförd i samma transaktion. Finance kan läsa; sales kan inte registrera attest eller leverera.

Både ursprungliga offertavtal och nya direktavtal använder frysta underlag. Ingen godkänd offert fabriceras för direktavtal. Senare inbytesförslag får inte skriva om signerad avräkning. Ofullständig eller okänd skuld ger ingen levererbar avräkningskälla. Gamla affärer utan inbyte behåller sitt betalningsflöde.

## Verifiering och gränser

**9/9 backendfall PASS:** `tests/trade-in-settlement.test.mjs` provar faktisk migrerad SQL, accepterad offert, riktiga interna signerings-RPC:er, faktiska avräkningsåtgärder och faktisk anskaffning. Fallen omfattar positivt/noll/negativt kundnetto, ingen skuld, skuld större än inbytesvärde, 13-siffrigt beräknat belopp, en öres negativt netto, kategoritak, reversering, saknad anskaffning, återförsök, CAS, roller och privat oföränderlig bokföring. Storage-katalogen är en lokal adapter; testet bevisar inte verklig bank eller extern lagring.

**2/2 samtidighetsfall PASS:** Två verkliga PostgreSQL 17.12-sessioner verifierar observerad låsväntan: samtidiga kategoriattester ger en enda post och stale-CAS-nekning; samtidig leverans efter exakt avräkning och faktisk anskaffning ger en enda leverans. Egen container kördes med nätverk `none`, utan portar och endast syntetiska data. Testdatabasen och containern är borttagna. Bevis finns i [native-proof.json](verification/20261113-trade-settlement/native-proof.json).

Direktavtalets fulla PDF-/gäst-/arkiv-/anskaffningskedja och browserflöde verifieras separat i den samlade projektgranskningen. Denna rapport är inget påstående om produktionsbankverifiering.

Riktade grannar: 8/8 befintliga direktavtalsfall, 6/6 befintliga avräknings-actions och 6/6 gästfulfilmentfall passerade. TypeScript-kontroll och git diff-check passerade.
