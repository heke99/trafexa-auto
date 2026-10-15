# Handlarens huvudregister

Etappen 15 oktober 2026 omfattar Lager, Kunder, Affärer, kund-/bilval vid ny affär och behovsläsning av fordonskostnader. Implementationen fortsätter från main `eb3fa15`. Migration [20261015092417_dealer_registers.sql](../supabase/migrations/20261015092417_dealer_registers.sql) är applicerad och hosted rollbacktest passerar. Verifierade test- och driftresultat finns i [IMPLEMENTATION_STATUS](IMPLEMENTATION_STATUS.md); källkod i en branch är inte i sig ett publiceringsbevis.

## Registerläsning

`src/components/dealer-registers.tsx` använder serveråtgärden `loadDealerRegisterPage` i `src/lib/data/register-actions.ts` och den skrivskyddade RPC:n `public.dealer_register_page`. Produktionsregistren läser hela det aktuella företagets behöriga data. De använder inte grundsnapshotens 500 rader som ett komplett register.

| Register | Bokstavlig sökning | Filter | Sortering |
|---|---|---|---|
| Lager | Märke, modell, registreringsnummer | Alla, tillgängliga, reserverade, sålda, arkiverade | Senaste först, lägsta/högsta begärt pris |
| Kunder | Namn, e-post, telefon | Alla, privatperson, företag | Senaste först |
| Affärer | Kundens namn/e-post/telefon samt bilens märke/modell/registreringsnummer | Alla, utkast, reserverade, avbrutna | Senaste först, lägsta/högsta affärspris |

Servern normaliserar söktext och begränsar den till 120 tecken utan kontrolltecken. SQL använder bokstavlig delsträngssökning; `%`, `_` och filterliknande text är inga jokertecken eller frågeoperatorer. Inga användarskrivna SQL-/PostgREST-filter byggs.

Varje läsning innehåller högst 50 rader, exakt antal träffar för sökning/filter och företagets total- och kategoriantal oberoende av sökningen. Antal kommer från samma RPC-läsning som sidan. Affärens kund och lagerpost hämtas med företagsbundna relationer direkt i databasen, även när dessa poster saknas i grundsnapshoten. Belopp bevaras som exakta heltalsören och valideras innan de skickas till klienten.

Sidindelningen använder keyset-cursor med tidpunkt och UUID; prissortering inkluderar även exakt öresbelopp. Mikrosekunder och stabila skiljenycklar bevaras. Cursor är bunden till företag, verifierad aktör, aktuell roll, register, sökning, filter, sortering och väljarläge. Den ersätter inte nya behörighetskontroller. UI håller historik för Föregående/Nästa och börjar om vid ändrade sökkriterier. Sidorna är färska läsningar, inte en fryst databasögonblicksbild: nya eller ändrade poster kan påverka nästa läsning.

En misslyckad läsning visas som fel med återförsök. Ett laddningstillstånd eller fel presenteras inte som noll poster. Tomt register, inga matchande träffar och en sida som blivit tom efter en dataändring har skilda meddelanden. Företags-, aktörs- och rollbyte återställer registervyn; sena svar från tidigare läsning används inte.

## Sökbara val vid ny affär

`src/components/deal-form.tsx` använder `searchDealOptions` för kund och tillgänglig bil. Sökning och 50-raderssidindelning omfattar hela företagets valbara register, även äldre poster bortom 500-raderssnapshoten. En redan vald post hämtas separat från den aktuella sökträffen. Kunden måste fortfarande tillhöra företaget och bilen måste fortfarande vara tillgänglig. Saknad eller otillgänglig post rensar valet och kräver ett nytt val.

Formuläret får inte skickas medan valen hämtas eller har fel. Byte av företag, aktör eller roll återställer valen. Ägare, administratör och säljare kan skapa affär; själva skrivåtgärden har fortsatt egna färska server-/databaskontroller. Listläsning ger inte rätt att skapa eller reservera. Bilens begärda pris fyller prisfältet med exakta ören när bilvalet ändras.

## Behovsladdade fordonskostnader

`src/lib/data/vehicle-cost-actions.ts` hämtar kostnader först för den lagerpost som öppnas. Grundsnapshoten hämtar inte längre alla företagets fordonskostnader. Läsningen filtrerar varje sida på både företag och lagerpost och fortsätter tills ett verifierat exakt återstående antal visar att alla rader är hämtade. Den hanterar även en Data API-gräns som är lägre än den begärda sidstorleken.

Aktuellt godkänt konto, användare, företag, medlemskap/roll och lagerpostens företagsanknytning kontrolleras före och efter hela läsningen. Ett fel, saknat antal, främmande företagsdata eller ändrad åtkomst kasserar hela underlaget. Delsvar blir inte en färdig kostnadssumma och misslyckad hämtning blir inte noll kronor. Belopp valideras som säkra heltalsören.

## Åtkomst och avgränsning

Den publika RPC:n är en `SECURITY INVOKER`-wrapper över `private.dealer_register_page`, en `SECURITY DEFINER`-funktion med uttryckliga kontoapproval-, aktörs-, företags- och rollkontroller. Varje källa och relation begränsas till samma företag. Båda funktionerna är STABLE och har låst `search_path`. Detta är registerläsningens åtkomstgräns även när den privata funktionen läser utan per-rad-RLS-kostnad. Roller `owner`, `admin`, `sales`, `finance` och `viewer` kan läsa inom sin företagsgräns. EXECUTE är tillåtet för `authenticated`; anonym klient och `service_role` nekas. Aktör och roll tas från aktuell server-/databaskontext, inte från klientens indata; actionlagret kontrollerar dem även efter läsningen och validerar returnerade relationer, antal och cursor.

Grundsnapshoten kan fortsatt innehålla 500 lager-, kund- och affärsposter för andra konsumenter. Finanslistan och finansformulärets snapshoturval ändras inte i denna etapp. Dashboardens totaler använde redan serveraggregat över hela företaget. CSV-importens gräns på 500 fordon per fil är en separat importgräns. Demon använder endast fiktiva lokala exempel och gör inga produktionsanrop.

## Verifieringsunderlag

Register-, action- och kostnadsregressionerna finns i `tests/dealer-registers.test.mjs`, `tests/register-actions.test.mjs` och `tests/vehicle-cost-actions.test.mjs`. SQL-underlaget finns i `supabase/tests/dealer_registers.sql`. De omfattar register större än 500 rader, nyckelbaserad sortering med lika priser/tidpunkter, bokstavlig sökning, fullständiga affärsrelationer, kvarvarande val utanför sökträffar, ändrad behörighet och riktad kostnadspaginering. Hosted SQL-rollback PASS och efterkontroll utan testföretag/testanvändare är bekräftade. Samlad app-/byggverifiering redovisas separat i statusprotokollet utan att äldre checkpoints räknas som omkörda.
