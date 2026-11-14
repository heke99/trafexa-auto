# Superadmin: behörigheter och UI, 14 november 2026

## Granskat ansvar

Superadmin hanterar webbansökningar, godkännanden och kontoinbjudningar, företagsstatus, tillåtna medlemsroller, plattformsstatistik samt annons-/fakturaunderlag. Server- och databaskontroller ska gälla även direkta RPC/API-anrop och även om behörighet ändras under ett pågående anrop.

| Område | Verifierad gräns |
| --- | --- |
| Inloggning och adminvyer | Färskt verifierat Auth-konto och aktiv UUID-bunden privat administratörspost. Företagsmedlemskap krävs inte för `/admin`. |
| Första aktivering | Endast den egna uttryckliga reservationen och godkänt konto får visa aktivering. Vanliga handlare ser ingen aktiveringsväg. Läsning gör aldrig anspråk på reservationen. |
| Konton | Godkännande/avslag/avstängning kräver behörighet, granskning, anledning, aktuell version och stabilt request-id. Registry-konton är skyddade i appflödena. |
| Medlemmar | Tillåtna roller kan hanteras; egen roll, plattformsadministratörer och ägare skyddas. Ägaröverlåtelse har eget tvåpartsflöde. |
| Ansökningar och radering | Aktuell ansökningsversion och uttrycklig granskning krävs. Förlorad åtkomst eller nytt aktörs-/ansökningsscope rensar privat innehåll. |
| Avtal hos handlare | Superadminrollen ersätter inte företagets rätt att teckna avtal. För sändning och underskrift gäller företagets separata behörigheter. |

Skydden gäller appens roller och RPC:er. Betrodd databasägare kan fortfarande administrera privata tabeller via driftverktyg; detta är ingen garanti mot sådana ägaroperationer.

## Åtgärdade verifierade fel

- Äldre adminläsningar och företags-/ansökningsåtgärder saknade ny kontroll före svaret. Samma färska administratör verifieras nu efter RPC innan data eller kvitto lämnas ut.
- Vissa äldre SQL-kontroller kunde acceptera ett verifieringstidsvärde trots saknad/tom eller tvetydig e-post. Direkta API-anrop får nu samma krav på faktisk verifierad identitet. Gemensamma konto-/teamkontroller nekar tom e-post konsekvent. Inga verkliga konton ändras av detta.
- Adminlayouten kunde visa aktivering för vanliga autentiserade användare. Ett nytt minimalt, läsande, aktörsbundet RPC kontrollerar verklig egen behörighet till aktivering utan att exponera reservationsuppgifter.
- Utgången färsk session kunde tappa vald adminundersida trots kvarvarande proxy-claim. Proxy sätter nu kanonisk lokal återgångsväg, ersätter förfalskad sådan metadata och behåller uppdaterade cookies. Metadata används bara för navigation; server och databas avgör åtkomst.
- Okända resultat i konto-, medlems-, företags-, ansöknings- och inbjudningsflöden bevarar exakt granskad begäran/nonce för säker kontroll. Panelernas navigation och ändring låses tills ett känt utfall finns. Ett bekräftat kvitto får inte återvisa inaktuellt underlag när efterföljande läsning misslyckas.
- Byte av administratör eller ansökningsversion kasserar sena privata svar. Fel och återgång vid granskning får tangentbordsfokus.
- Avklippta mobilknappar rättas med lokal radbrytning och ordentliga tryckytor. Även verklig yttre adminheader provas vid 320/390/1440 px; kontraktsguiden är valfri och hopfälld så översikten kommer fram.
- Manuell avslutad pappersaffär kallas inte levererad i statistiken.

## Verifiering

Riktade lokala prov omfattar 64 verkliga browserfall i huvudvyn, medlems-/kontoidentitetsvyer, routing genom faktisk proxy och layout, samt riktiga SQL/RPC-fixturer för kontotyper, skyddade roller, CAS och stabila återförsök. Mobila och breda bilder är granskade. Testbilderna innehåller syntetiska värden och personer.

De kanoniska PGlite-beroendena för admin-/översiktsdatabastester har återställts från låsfiler. SQL-batchen omfattar 30 godkända fall och action-batchen 64 godkända fall; dessa kan överlappa helkörningen och adderas inte till dess unika antal. Kontrollerna är isolerade PGlite-/browserprov, inte ett nytt produktionsinloggat användarprov eller ett fristående flersessionsprov i PostgreSQL. Samlad verifiering omfattar 250 kanoniska testfiler och 2 270 godkända unika fall, utan överhoppade fall. Helkörningens 249 filer kompletteras av den verkliga yttre adminheaderns tre browserfall. Ett asynkront betalningsprov rättades till att invänta faktisk mottagen återförsöksbegäran; slutomkörningen ersätter tidigare per-filresultat. Exakt publicering redovisas i PR.

Produktionskontroll före ändring: en aktiv, verifierad superadmin med rätt UUID-bindning, inga lediga aktiveringsreservationer, inga godkända konton med saknad e-post. Ingen kontoradering, verklig statusändring, aktivering eller mejlsändning har gjorts som test. Befintligt superadminkonto `hekmat.h@trafexa.com` bevaras.


## Produktionsuppgradering

Den funktionsbaserade migrationen `20261114110745_platform_admin_activation_eligibility.sql` är tillämpad. Inga tabeller eller verkliga kontorader uppdateras av den. Den nya läsande aktiveringsfunktionen har endast autentiserad exekveringsrätt, med egen identitetskontroll; anonym och service-roll saknar exekveringsrätt.

Efterkontrollen visar fortfarande en frisk aktiv superadmin. Registry-, konto- och företagsstatus har exakt samma kontrollvärden som före uppgraderingen. Kontot hekmat.h@trafexa.com har inte raderats, pausats eller fått ny roll. Schemaändringen är kompatibel med den tidigare appen för friska användare, så den kunde införas före appen och det faktiska hosted-versionsnumret användas direkt i samma PR. Kontroller som avsiktligt nekar ogiltiga identiteter är skärpningen.
