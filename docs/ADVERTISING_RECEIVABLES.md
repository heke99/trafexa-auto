# Superadminens översikt över annonsfakturor

**Administration → Annonsfakturor** samlar Trafexas utfärdade annonsfakturor över företagen. Superadmin kan se aktuell manuell avstämning och öppna en faktura utan att först söka fram företaget. Översikten läses först när fliken öppnas. Den skapar inga fakturor, betalningar, påminnelser, bankförfrågningar eller bokföringsposter.

## Åtkomst och källor

Åtkomst kräver en verklig aktiv, verifierad och godkänd superadmin i det privata UUID-registret. Företagsroller, e-postadresser och klientmetadata ger ingen global läsåtkomst. Aktuell identitet och administratörsåtkomst kontrolleras igen innan data lämnas ut. Anonyma, vanliga handlarkonton och service-role-anrop får inte läsa den globala översikten.

Historiska fakturor för avstängda gäldenärsföretag finns fortfarande i superadmins lista. Fakturans frysta köparnamn och organisationsnummer skiljs från företagets aktuella visningsnamn och status. Företagsnamnsändringar skriver inte om utfärdade fakturor. Handlarens företagsvisa läsåtkomst ändras inte av denna vy.

Översikten använder utfärdade originalfakturor, eventuell full kredit och den manuella betalningsjournalen. Fakturanummer, ursprungligt bruttobelopp, datum och källhash är sparade fakturauppgifter. Avstämt belopp, kvar att betala och överskott beräknas från journalen enligt [avstämningskontraktet](ADVERTISING_PAYMENT_RECONCILIATION.md). Fakturans PDF och betalningspanelen har sina egna aktuella behörighets- och källkontroller.

## Filter och totalsiffror

Listan kan visa alla fakturor eller filtrera på obetald, delbetald, avstämd, överskott, krediterad eller förfallen. Förfallen betyder att fakturan har ett kvarstående belopp och att förfallodatumet ligger före dagens datum i **Europe/Stockholm**. En faktura som förfaller i dag är inte förfallen. En full kredit sänker fordran till noll; redan registrerade inbetalningar kan då visas som överskott. Överskott betyder inte att någon återbetalning har gjorts.

Sammanfattningen omfattar samtliga utfärdade annonsfakturor oberoende av listans filter. Den visar antal per avstämningsstatus, antal förfallna fakturor, ursprungligt bruttobelopp, kreditbelopp, fordran, avstämda inbetalningar, kvarstående belopp, överskott och förfallet kvarstående belopp. Antal matchande fakturor avser däremot valt filter. Belopp är **SEK i exakta heltalsören**. Summeringar får överstiga en enskild posts int64-gräns och behandlas som decimalsträngar och BigInt, aldrig som osäkra JavaScript-tal.

Den globala listan är ett administrativt bevakningsunderlag. Den är inte en verifiering mot bank, momsdeklaration, bokföringsrapport eller bekräftelse på att en kund fått sitt fakturamejl.

## Sidindelning, aktualitet och UI

En sida innehåller högst 25 fakturor, sorterade på registreringstid och fakturans UUID i fallande ordning. Sidmarkören är bunden till aktuell administratör och valt filter. Ett filterbyte börjar på första sidan. Sidan, totalsiffrorna och dagens datum bygger på samma databasfrågas läsbild; UI visar dess uppdateringstid.

Varje sidläsning är aktuell vid sitt eget anrop. Senare sidor ersätter den synliga sidan; de läggs inte ihop till en påstått fryst sammanställning. Betalningar, återföringar eller krediter kan ändra både totalsiffror och vilka fakturor som matchar ett filter mellan anrop. Uppdatering börjar om med aktuellt underlag. Inget löfte lämnas om en oföränderlig ögonblicksbild över flera sidläsningar.

När användaren lämnar fliken eller byter aktör tas den öppnade finansvyn bort och sena svar får inte fylla den igen. Nekad administratörsåtkomst tömmer finansvyn och moderadministrationens tidigare data och spärrar fortsatt navigering. Vanliga läsfel visas med möjlighet att försöka igen. Pågående kontogodkännande eller inbjudningsförnyelse behåller den befintliga navigeringsspärren även mot den nya fliken. En pågående betalningsåtgärd eller CSV-hämtning spärrar också byte av administrationsflik tills anropet har avslutats. Ett avslutat anrop med okänt utfall lämnar inte navigeringen permanent spärrad; betalningsflödets gransknings- och återförsöksregler gäller fortfarande.

## Fortsättning och verifiering

Manuell registrering och rättelse av betalningar följer [grundkontraktet](ADVERTISING_PAYMENT_RECONCILIATION.md). Den separata [CSV-exporten](ADVERTISING_PAYMENT_EXPORT.md) granskar en vald fakturas hela journal; den globala listan exporterar inte automatiskt alla företags ekonomidata. Automatisk påminnelse, ränta, inkasso, bankkoppling och ekonomisystemsintegration ingår inte.

Faktiska tester, hosted migrationer och produktionspublicering redovisas separat i [implementationsstatus](IMPLEMENTATION_STATUS.md). Denna dokumentation är inget bevis på att ett verkligt kund- eller bankflöde har körts i produktion.
