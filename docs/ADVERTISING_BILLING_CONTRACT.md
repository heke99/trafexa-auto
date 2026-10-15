# Kanalpriser och låsta månadsunderlag

Trafexas modell är en unik verifierad publicering per annons och kanal. Statistik och antalexport är separata från det här pris- och månadsunderlaget. Alla belopp anges i **SEK, heltalsöre och exklusive moms**. Fordonets momsmodell eller VMB används inte för att beräkna Trafexas tjänsteavgifter. Ingen moms, fakturanummer, betalningsstatus eller utfärdad faktura skapas här.

## Behörighet

Aktuell faktisk UUID-superadmin får spara kanalpriser, granska tidigare oprissatta publiceringar och låsa månadsunderlag. Företagets aktuella ägare, administratör och ekonomiansvarig har läsåtkomst. Övriga roller, anonym åtkomst, spärrade konton och användarredigerbar administratörsmetadata ger ingen åtkomst. Superadmin kan läsa historik för ett suspenderat företag utan medlemskap. Företagsvyn kräver aktivt företag och aktuellt medlemskap.

SQL-funktionerna och serveråtgärderna kontrollerar aktuell Auth och kontogodkännande. Mutationer har versions-/underlagskontroll, begärans-ID och oföränderliga granskningsspår. Återförsök sker först efter aktuell behörighetskontroll. Priskvittot binds till faktiskt företag, administratör och begäran innan det får lämna servern.

## Pris och publicering

Varje företag och kanal har versionshanterade priser. Aktiveringstid bestäms av servern när priset sparas. Ett nytt pris gäller endast framtida verifierade publiceringar, aldrig automatiskt historiken. Publiceringen kopierar då gällande prisversion och belopp till ett oföränderligt kvitto. Prisaktivering, publicering, granskning och periodlåsning samordnas med samma företagslås.

Explicit noll är ett giltigt beslutat pris. Avsaknad av pris är null och blockerar ett slutligt underlag; den tolkas aldrig som gratis. Tidigare oprissatta publiceringar kan ges ett uttryckligen granskat pris per vald kanal och månad, med motivering och exakt aktuell underlagskontroll. Detta ändrar inga redan prissatta rader. För rättelser av beslutade priser behövs en separat framtida rättelse-/krediteringsprocess.

## Månad och låsning

Perioder följer svensk kalendermånad i Europe/Stockholm, inklusive sommartid. Månadens rader innehåller publicerings- och annons-ID, kanal, registreringstidpunkt, exakt pris, prisgrund och eventuell prisversion. Antal och totalsumma verifieras från raderna. Beräkningen använder PostgreSQL numeric/bigint och JavaScript BigInt; inga flyttal används för pengar.

En månad kan låsas först efter periodens slut, utan oprissatta rader och efter uttrycklig granskning av aktuellt underlag. Om registreringen började under månaden krävs även separat bekräftelse av den ofullständiga täckningen. En månad som ligger helt före registreringsstart får inte låsas. Äldre annonser i baslinjen får fortfarande inga nya avgifter.

Låsningen bevarar ursprungliga rader, totalsumma, täckning, registreringsstart och tidsgränser. Originalets kanoniska JSON-text sparas separat och kontrolleras med SHA-256 samt mot JSON-innehållet. Ett nytt kanalpris ändrar inte originalet. Senare källavvikelser markeras separat. Både muterande återförsök och upprepade stängningsförsök kan inte skapa dubbla månadsunderlag.

## Vyer och export

Superadmin: Företag → Annonsunderlag → Priser och månadsunderlag. Behöriga företagsroller hittar läsvyn under Annonsering. Privat radvis CSV av låst original finns på `/api/advertising/billing/[month]/csv`; superadmin väljer uttryckligt företag, medan företagsvyn använder det aktuella företagsvalet. Källa och aktuell behörighet kontrolleras igen innan privata bytes lämnas ut. CSV innehåller exakta ören, kanalantal, originalhash och täckning; det är ett faktureringsunderlag, ingen faktura.

Den äldre antalrapporten behålls som antalunderlag. Nya klienter använder versionsseparerade quantity-RPC:er som visar faktiskt antal oprissatta publiceringar, men saknar monetär beräkning. Priser ingår inte i antal-CSV. Faktiska pris- och periodbelopp hämtas alltid från den nya faktureringsdomänen.

Nuvarande gräns är 2 000 publiceringar per månadsunderlag och högst 9 223 372 036 854 775 807 öre för styckpris eller totalsumma. Större underlag avvisas i stället för att trunkeras eller avrundas. Större volymer kräver sidindelad granskning före låsning.

## Nästa steg

Fakturautställning kräver separat nummer-/versionshantering, kund- och säljaruppgifter, skatteregler, betalningsvillkor, rättelser/kreditering och bokföringskoppling. Externa Blocket-/Wayke- och bankkopplingar förblir inaktiva tills respektive partneråtkomst och verkliga leveranskontrakt är verifierade. Inga externa annonser, fakturor, betalningar eller mejl skickas av detta pris- och periodsteg.
