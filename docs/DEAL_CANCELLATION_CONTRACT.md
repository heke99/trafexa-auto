# Kontrollerad avbrytning av affärer

Ägare, administratör och säljare kan avbryta företagets utkast eller reserverade affär. De anger 2–500 teckens motivering och granskar den före bekräftelse. Ekonomi/läsroller och demo kan inte skriva. Verifierad Auth, aktivt företag och faktiskt medlemskap kontrolleras före och efter serveråtkomst; Auth-metadata ger ingen roll.

RPC `cancel_deal(company,deal,expectedStatus,reason,requestId)` låser lagerpost före affär, kontrollerar förväntad status och spärrar accepterad offert. Bara affärens aktiva reservationer avslutas. En reserverad lagerpost blir tillgänglig endast om ingen aktiv reservation återstår; såld/arkiverad lagerstatus öppnas inte. Affärens offertversioner och kundsvar bevaras. Oföränderligt privat auditkvitto binder aktör, nonce och exakt begäran. Identisk retry kan returnera historiskt kvitto, men färsk status hämtas genom uppdaterad arbetsyta.

Gränssnittets nyckel omfattar företag, användare, roll, affär och status; sena svar från gamla vyer ignoreras. Okänt nätverksutfall återanvänder samma UUID. Konflikt eller nekad åtkomst blockerar ny skrivning tills affären öppnas igen. Verifierad framgång uppdaterar affärer, lager och översikt.

Kundaccept är separat från reservation, kredit, betalning och leverans. Accept förlänger inte reservationens giltighet. Befintlig tidsutgång kan fortfarande frigöra en reservation; accepterad offert bevaras som underlag. Vanlig manuell avbrytning och reservationsfrigivning får däremot inte användas för att kringgå en accepterad offert. Separat överenskommelse-/avtalsprocess återstår.

Inga mejl, partnerutskick eller schedulerjobb aktiveras. Riktiga samtidiga anslutningars låsväntan och hela inloggade produktionsflödet verifieras separat från lokala browser-fixtures och rollbacktest.
