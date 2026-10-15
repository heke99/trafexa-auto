# Internt filialregister

## Omfattning och status

Pågående organisationsetapp från PR #33/main `0b041063681c7045479269970f171794bc8d9f8f`, 15 oktober 2026. Flödet är implementerat och delverifierat: backend 11/11, faktiskt kontext-/åtgärds-/PGlite-korslager 6/6 och Chromium 12/12 passerar, liksom TypeScript och diffkontroll. Produktionsbygge inklusive TypeScript och native PostgreSQL 14/14 på 115 lokala migrationsfiler passerar. Migration `20261015180528_company_branches` är hosted-applicerad; rollbackprovet passerar och nio cleanupaggregat är noll. Slutlig appkörning passerar 1023/1023 utan fel, avbrutna, överhoppade eller todo; produktionsbygge och TypeScript passerar. Publiceringen återstår att verifiera. Se [IMPLEMENTATION_STATUS](IMPLEMENTATION_STATUS.md).

Registret samlar företagets försäljningsställen med intern filialkod, namn, besöksadress, postnummer, ort och valfria publika kontaktuppgifter för e-post och telefon. Alla poster tillhör samma juridiska företag och samma organisationsnummer. Första nyttan är ett gemensamt adress- och kontaktregister.

## Hantering och behörighet

Aktuell ägare och administratör får läsa, skapa och redigera företagets filialer. Skapande och redigering kräver uttrycklig granskning. Filialer har status `active` eller `archived`; arkivering och återaktivering kräver motivering och bekräftelse. Arkivering bevarar posten och dess historik.

Sparande och statusändringar binds till förväntad postversion. Inaktuellt underlag ska ge konflikt och kräva ny granskning. Aktörsbundna begärans-ID:n ger exakt återförsök utan dubbla ändringar. Aktuell autentisering, kontogodkännande, företagsstatus och medlemsbehörighet kontrolleras på servern och i databasen; ett historiskt kvitto ger ingen ny behörighet.

## Fortsatta steg och gränser

Lagerkoppling och filialfilter är separata nästa steg. Filialer ger inte egna lager eller en ny uppdelning av användarnas åtkomst. Företagsmedlemskap, ägarroll och juridisk identitet ändras inte. Registret ersätter inte den befintliga företags-/butiksprofilen och ändrar inga kanalunderlag, exporter, externa butikskonton eller partneranslutningar. Det skickar ingen information till Blocket, Wayke eller annan annonsör.

Ingen ekonomisk transaktion, faktura, avtalsändring eller e-post skapas av filialhanteringen. Fullständig verifiering och publicering redovisas först när de faktiskt genomförts.
