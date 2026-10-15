# Granskat kanalval och pris före annonsutskick

Den här etappen bygger vidare på main `20cb4d`/PR #28 och är sammanfogad med fakturautställningens main `a796bb`/PR #29 samt moms-V2 på main `943514ae`/PR #30. Handlaren kan välja en eller flera annonskanaler, se avgiften för varje vald kanal och granska den innan utskicket köas. Priset sparas tillsammans med kanalvalet för spårbar statistik och framtida fakturering. Användaren har bekräftat att partneranslutning saknas; verklig leverans till Blocket och Wayke kräver därför fortsatt verifierad partneråtkomst och färdiga leveranskontrakt enligt [integrationsgränserna](ADVERTISING_INTEGRATIONS.md).

## Pris som handlaren granskar

Servern hämtar en prisoffert för exakt företag, annons och annonsversion genom `get_advertising_send_quote`. Företagets kanalpriser beslutas av superadmin; handlaren kan inte ange ett eget belopp. Vyn visar kanal, pris, prisgrund och om kanalen kan användas. Beloppen är Trafexas tjänsteavgifter i **SEK och heltalsöre, exklusive moms**, inte fordonspriset eller ett antaget aktuellt listpris hos Blocket eller Wayke. Inga leverantörspriser förifylls.

Uttryckligen beslutat noll är ett giltigt pris och visas som noll. Saknat pris är okänt och blockerar den kanalen; det får aldrig visas eller behandlas som gratis. Val av en enda kanal tar bara med den kanalens avgift. Flera valda kanaler granskas tillsammans före bekräftelse.

Offertens `reviewToken`, som lämnas som `p_expected_quote_token` till databasen, binder serverns aktuella underlag. `send_vehicle_advertisement_priced` kräver samma annonsversion, de valda kanalerna och token från den granskade offerten. Om underlaget har ändrats avslås försöket som konflikt. Handlaren måste då läsa och granska en ny offert; klienten får inte tyst byta till ett högre eller lägre pris.

## Oföränderligt accepterat pris

Den första giltigt accepterade prissättningen för **företag + annonsidentitet + kanal** sparas oföränderligt. Varje skapat leveransjobb binds till den accepterade prisgrunden. Ett senare kanalpris skriver inte om den redan accepterade avgiften för samma annons och kanal. Nya annonsversioner, nya leveransjobb och identiska återförsök innebär inte ett nytt köp av samma publiceringsenhet.

Offerten skiljer enhetspriset `unitPriceOre` från den nya möjliga avgiften `chargeOre`. För en redan registrerad publicering med giltig prisgrund är `chargeOre` noll, eftersom samma annons och kanal inte debiteras igen. Detta är en annan grund än ett uttryckligen beslutat nollpris. Även ett nytt utskick för en redan publicerad annons kräver en giltig prisgrund; utan den förblir båda beloppen okända. Sändningskvittot innehåller exakt den accepterade historiska offerten och ersätts inte med det senaste kanalpriset.

Köning, prisaccept och jobbindningar ska sparas atomärt efter aktuell kontroll av konto, företagsmedlemskap, lager, annonsversion och betrodd kanalanslutning. Saknad prisgranskning, inaktuellt underlag eller otillgänglig kanal får inte lämna ett delvis accepterat utskick. Begärans-ID och sparade kvitton binder återförsök till samma aktör och innehåll. Detta ger inte rätt att köa nya utskick efter att behörigheten har återkallats.

## Publicering, statistik och faktureringsunderlag

Debiteringsenheten är oförändrad: **första unika verifierade publicering per företag, annons och kanal**. Verifierad publicering av ett jobb med accepterad prisgrund använder den frysta avgiften, även om ett annat kanalpris har aktiverats efter köningen. Uppdateringar, nya annonsversioner, omsändningsförsök och upprepade statusbesked ger inga extra enheter.

Äldre jobb och kanalidentiteter som saknar den nya prisaccepten behåller den äldre publiceringstidsregeln. Ingen prisaccept efterkonstrueras för dem. Redan prissatta publiceringar och låsta underlag förändras inte.

`queued`, `submitted`, `rejected` och `outcome_unknown` är operativa statusar. De kan visas i statistiken men skapar inte en faktureringsenhet. Ett accepterat pris är heller inte i sig en publicering, utfärdad faktura eller betalning. Om samma annons publiceras verifierat på två valda kanaler kan det ge två enheter, med respektive accepterat kanalpris.

De befintliga [antalunderlagen](ADVERTISING_USAGE_CONTRACT.md), [låsta månadsunderlagen](ADVERTISING_BILLING_CONTRACT.md), granskade nedsättningarna, fakturautkasten samt moms-/betalningsbedömningarna behåller sina egna behörighets- och versionsgränser. Historiska publiceringar, låsta original och äldre redan prissatta rader skrivs inte om. Fakturautställning, betalning, bokföring och leverantörens egna fakturor är separata steg.

## Behörighet och faktisk leverans

Företagets aktuella ägare, administratör och säljare får läsa sändningens offert och granska ett utskick enligt annonsflödets befintliga skrivrätt. Aktuell Auth, godkänt konto, aktivt företag och aktuellt medlemskap kontrolleras på servern och i databasen. Finans- och läsroller får ingen ny skrivrätt. Prishanteringen förblir superadminens ansvar. Inga credentials lämnas till klienten eller placeras i pris- och statistikunderlag.

Ett ikryssat kanalval räcker inte för extern leverans. Kontobindning, privat verifierad anslutning, färsk worker-readiness och verifierat providerkontrakt krävs fortfarande. Blocket- och Wayke-utskick samt dispatchers förblir inaktiva. Det nya prisflödet varken gissar partnerendpoints eller skickar externa testannonser.

## Verifieringsläge

Migration `20261015123148_advertising_reviewed_send_price` är applicerad och hosted rollbackprov omkört efter V2 ger PASS, inklusive handlarens faktiska fakturerings-/antalstatistik, med nio nollställda cleanupaggregat. Den integrerade basen omfattar 105 hosted migrationer och 107 lokala filer inklusive två äldre pending prototyper. Efter V2-integreringen passerar prisprov 10/10, faktureringsregression 11/11, native PostgreSQL 17.6 6/6 inklusive fem tvåsessionsrace och faktiskt serveråtgärd/parser/SQL-korslager 5/5. Slutlig integrerad appkörning passerar **948/948** utan fel eller överhoppade fall, liksom produktionsbygge med TypeScript. Riktade appfall ingår i helsviten och adderas inte. Tidigare checkpoint före V2 passerade 932/932. Detta är en testad kodcheckpoint före publicering; PR #31 är ännu inte mergad och produktionsbevis följs separat i [IMPLEMENTATION_STATUS](IMPLEMENTATION_STATUS.md). Avstängda integrationer och syntetiska partnerbesked räknas inte som verifierad extern publicering.
