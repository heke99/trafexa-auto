# Plattformsadministration av företagsmedlemskap

## Omfattning och status

Det separata superadminflödet visar vilka företag ett konto tillhör och vilka konton som är medlemmar i ett företag. Det kompletterar den befintliga kontohanteringen och företagsvyn. Kodkontraktet beskrivs här; testresultat, hosted applicering och publicering redovisas först när verifierade fakta finns. Inga verkliga företagsmedlemskap ändras av verifieringen.

## Läsa samband mellan konton och företag

Från ett konto öppnas **Kontots företag**, med företagsnamn, företagsstatus, medlemsroll och medlemsstatus samt möjlighet att öppna företagets medlemslista. Ett konto utan medlemskap visas uttryckligen som sådant; ett godkänt konto skapar inte automatiskt ett företag eller medlemskap.

Företagets medlemslista visar e-post om den finns, kontogodkännande, verifierad e-post, företagsroll och medlemsstatus. Båda listorna använder keyset-sidindelning med högst 50 poster per anrop och uttrycklig inläsning av fler. Ändrad `teamVersion` vid fortsatt medlemsläsning kräver omläsning. Byte av konto, företag eller administratör avmonterar föregående panel; sena svar från en tidigare vy ska inte återöppna den.

## Granska en medlemsändring

Aktuell verifierad plattformsadministratör kan granska en befintlig oskyddad medlemsroll: administratör, säljare, finansansvarig eller läsare. Medlemsstatus är aktiv eller avstängd. Beslutet kräver motivering, separat granskning av före/efter och en uttrycklig bekräftelse. Oförändrat beslut godtas inte som en ändring.

Ändringen använder medlemskapets förväntade version som CAS-villkor. Vid konflikt läses aktuell lista in och beslutet måste granskas på nytt. Vid okänt resultat bevaras samma begärans-ID för exakt samma granskade innehåll. Aktörsbundet begärans-ID och exakt payload hindrar dubbla ändringar; annat innehåll med samma ID avvisas. Medlemsversion, företagets `teamVersion` och privat oföränderlig audit med före/efter, aktör, mål och motivering uppdateras atomiskt.

Ett historiskt kvitto återges bara efter aktuell plattformsautentisering. Kvittot är inte en ny bild av medlemskapet: UI läser alltid om aktuella medlemskap efter bekräftad ändring och rapporterar separat om omläsningen misslyckas. Nekad åtkomst tömmer listor och öppnad granskning.

## Skydd och aktiveringsvillkor

Ägarrollen, administratörens eget medlemskap och mål som förekommer någonstans i det privata plattformsadministratörsregistret är skyddade i detta nya flöde. Även en avstängd registerpost skyddar målet. Den befintliga kontolistan visar nu samma skydd för samtliga registerposter som kontobeslutens serverfunktion redan tillämpade. En skyddad registerpost innebär inte att kontot har aktiv plattformsåtkomst. Ingen ny ägarroll kan väljas. Ägarbyte använder fortsatt företagets befintliga tvåpartsöverlåtelse utan superadminoverride.

Ett aktivt medlemskap kräver aktivt företag, godkänt konto och verifierad Auth-adress. Avstängning är möjlig även när målkontextens konto eller företag är avstängt; detta återaktiverar ingenting annat. Server- och databasregler kontrollerar aktuell identitet och skydd också under låsväntan.

Företagets tidigare ägar-/administratörsstyrda personalhantering har sitt separata kontrakt. De nya skyddsreglerna beskrivna här är inte en automatisk omskrivning av alla befintliga tenantflöden.

## Vad åtgärden inte gör

Flödet skapar inga nya medlemmar eller inbjudningar och tilldelar ingen plattformsbehörighet. Det godkänner inget konto och aktiverar inget företag implicit. Företagsrollen, kontots godkännande och plattformsadministration visas och hanteras som separata behörighetsbeslut.

## Verifieringsgränser

Browserfixturer med syntetiska konton bevisar komponenternas beteende och layout. Native PostgreSQL med separata anslutningar bevisar databasregler och faktisk samtidighet inom testmiljön. Hosted rollbackprov verifierar det applicerade databasgränssnittet med syntetiska transaktioner som återställs. Dessa bevis är skilda från verkligt inloggat produktionsarbete och från ändring av riktiga handlares medlemskap. Inga framtida test- eller publiceringsresultat förutsätts av detta dokument.
