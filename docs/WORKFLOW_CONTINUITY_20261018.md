# Sammanhängande handlar- och adminflöden, 18 oktober 2026

Denna etapp fortsätter från main `ffa352e` och kompletterar redan publicerad kontofri kundgranskning, handlarens affärsbetalningar och leverans. De funktionerna byggs inte på nytt.

## Bilhandlarens väg vidare

Företagsnamnet i arbetsytans sidhuvud är en riktig länk till företagets inställningar och företagsval. Den kan användas med tangentbord och i mobilvyn. En medlem som öppnat anslutning av ytterligare företag kan återvända till inställningarna; en förstagångsanslutning visar ingen påhittad befintlig företagsåtkomst.

Tomma lager-, kund- och affärsregister visar nästa steg utifrån den faktiska rollen. En sökning utan träffar har en tydlig åtgärd för att återställa sökning, filter och sidvisning. Ett misslyckat anrop visas inte som ett tomt register.

## Superadmins kontoinbjudningar

Ansökningar visar sparad utskicksstatus, antal försök och kontots verkliga e-postverifiering och godkännande separat. Leverantörens accepterade utskick bevisar inte leverans till inkorgen. Verifierad e-post bevisar inte att lösenordssteget lyckats. Ingen beräknad giltighetstid visas utan underlag från Auth.

Under granskad sändning eller förnyelse spärras konkurrerande handläggningsändringar, radering och navigering i samma adminvy. Återläsning tar bort gammalt granskningsläge; en ny leveransgeneration återanvänder aldrig föregående bekräftelse.

En ny personlig länk kräver separat motivering, granskning och bekräftelse att tidigare länk ersätts. Privat leveransidentitet, oföränderlig nyttolast och servicebegränsad kryptering binder varje sändning till rätt generation. En försenad leverantörskvittens uppdaterar historiken för sitt eget försök, aldrig en senare inbjudan. Okända resultat skickas inte automatiskt igen.

Om handläggningsversionen ändrats före faktiskt kontoskapande kan superadmin granska den aktuella ansökan på nytt. Den tidigare godkännandeavsikten sparas i privat historik. Ny granskning kräver nytt begärans-ID, samma verkliga administratör och att konto, skickad nyttolast och aktiv sändningslease saknas. Ett gammalt leveransförsök kan inte ta över den nya granskningen. För redan skapade konton kan en vanlig handläggningsändring fortsätta utan att ändra ursprungligt kontogodkännande.

Öppen registrering förblir stängd. Kontot `hekmat.h@trafexa.com` ska behållas som superadmin enligt användarens senaste besked. Inga riktiga inbjudningar skickas av verifieringstesterna.

## Nästa ekonomipunkt

[Manuell betalningsavstämning av annonsfakturor](ADVERTISING_PAYMENT_RECONCILIATION.md) finns som separat del i den utfärdade fakturan. Superadmin registrerar mot kontrollerat bankunderlag; handlarens ägare, administratör och ekonomi läser företagets egna uppgifter. Delbetalning, överskott, full administrativ återföring och spårbar rättelse mellan fakturor har egna granskade flöden.

Bankens transaktions-ID hålls skilt från OCR eller bankmeddelande. Samma OCR kan förekomma vid delbetalningar. Ursprunglig faktura, kredit och journalposter ändras inte. En återföring rättar registreringen och utför ingen bankåterbetalning. Summor beräknas från hela historiken i exakta ören även när den synliga listan är sidindelad.

## Verifieringsgränser och fortsättning

Browserprover använder riktiga komponenter och CSS med syntetiska svar vid externa gränser. Databasprov använder riktiga migrationer; separata PostgreSQL-processer verifierar låsväntan och konkurrerande beslut. Produktionskontroller och fullständiga slutresultat följs i [IMPLEMENTATION_STATUS](IMPLEMENTATION_STATUS.md) och releasens PR.

Ingen verklig faktura, betalning, återbetalning eller mejlleverans skapas för att verifiera etappen. Bankanslutning, bokföringsintegration och faktisk mottagarleverans kräver separata kontroller. Fortsättningen lägger till [CSV-underlag per annonsfaktura](ADVERTISING_PAYMENT_EXPORT.md). Avstämning mot valt bokföringssystem återstår; leverantör är ännu inte bestämd.
