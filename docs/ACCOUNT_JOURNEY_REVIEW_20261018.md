# Kontoresan: granskning 18 oktober 2026

Utgångspunkt: main `a115511ca593bd77582f8624417c4a046cba6672`. Uppgiften är att kontrollera ansökan → granskning → kontoinbjudan → aktivering → inloggning → företagsstart och lösenordsåterställning. Exakt publicerat main-SHA och READY-deployment återläses i releasens PR.

## Rättade stopp och fel

- Superadmins första godkännande kräver att den lästa livscykelversionen matchar den visade ansökan. En verklig CAS-konflikt ger omläsning och ny okryssad granskning med ny begärandeidentitet. Samma versions okända utfall behåller sitt ursprungliga nonce.
- Äldre ofullständiga och avslutade ansökningar erbjuder inga kontoskrivningar som SQL ändå skulle neka. Gränssnittet visar hur kunden lämnar en komplett ansökan eller hur handläggningen återupptas.
- Aktivering, inloggning, glömt lösenord, nytt lösenord och utloggningsåterförsök visar vänteläge och spärrar submitknappen under serverformulärets åtgärd. Inmatningsfält och komplett FormData bevaras.
- Långa inloggningsadresser och feltexter samt företagsstartens granskningsknappar håller sig inom 320 px. Tangentbordsfokus och uttrycklig granskning före företagsstart finns kvar.
- Ett förlorat providersvar efter lösenordsskrivning vid aktivering beskrivs som obekräftat resultat, inte som en säkert avvisad ändring. Den förbrukade inbjudan återspelas inte.
- Återställning på en annan enhet har ett separat, scannersäkert flöde. Öppning av `/auth/recovery` förbrukar ingen OTP; bara ett uttryckligt formulär-POST verifierar token, aktuell användare och lösenordsändring. Den nya mejlmallen kräver separat kopiering till hosted Supabase efter apppubliceringen. Äldre installerade mallar fortsätter med oförändrad PKCE-callback under utrullningen.
- Aktiverings- och återställningsformulär binds till den länk som faktiskt visades genom ett SHA-256-fingeravtryck som inte kan användas som Auth-token. Sessionsbaserat lösenordsformulär binds till den visade användaridentiteten. Saknad/utbytt cookie, nytillkommen annan länk eller bytt inloggad användare i en annan flik får inte skriva lösenord för fel konto. Äldre redan öppnade formulär behöver läsas om.
- Tokenvägarna kanoniseras till appdomänen före host-bundna cookies. Proxy-handoff för återställnings- och inbjudningslänkar använder no-store/no-referrer och gör ingen Auth-klient eller sessionsförnyelse.

## Bevis per gräns

| Gräns | Verifiering | Praktisk gräns |
| --- | --- | --- |
| Publik ansökan → API → databas | Riktig React-komponent i Chromium, verklig POST-handler och migrerad SQL. Första svaret förloras efter commit; återförsök med samma nonce ger exakt en ansökan och två ursprungliga notifieringsköposter. | Supabase-wire och browserns fetch-transport är isolerade adaptrar. Inga notifieringar skickas. |
| Databas → superadmin | Verkliga admin-context-, läs- och granskningsåtgärder med riktiga behörighets-RPC:er. Namn, e-post, telefon, organisationsnummer, syften och integritetskvittens återläses. Vanlig verifierad användare nekas. Ansökan och granskning skapar inget Auth-konto. | Syntetiska lokala användare; ingen autentiserad produktionssession. |
| Godkännande → kontoinbjudan | 55 adminbrowserfall, inklusive fyra nya konflikt-/ofullständighetsfall. Native PostgreSQL-prover med separata backendanslutningar och verkliga observerade låsväntningar. | Auth- och lagringskataloger är lokala. Inga verkliga mejl eller GoTrue-konton skapas. |
| Aktivering/återställning → lösenord | Verklig route, serverformulär/åtgärd och installerade Supabase SSR/Auth-SDK. Kontroll av engångstyp, fresh actor, explicit POST och global utloggning. | SDK:s nättransport är kontrollerad; detta är inget liveprov av hosted SMTP. |
| Flera flikar/kontobyte | Oberoende före/efter-prov med riktig renderare, actions och SDK visar att borttagen/utbytt token och ändrad session inte gör någon lösenords-PUT eller felkontoutloggning. | Syntetiska token/sessioner. Ingen riktig kunds lösenord ändras. |
| UI och företagsstart | 28 browserfall med verkliga sidor, vänteläge, komplett FormData, 320 px, okänt utfall och stabilt nonce. | Kontrollerad transport och syntetisk butiksprofil. |
| Domän och cache | Verklig NextRequest/NextResponse genom proxy samt befintliga kund-/gästvägar: kanonisk host, bevarad query, inga cookies på fel host och ingen Auth-IO vid tokenhandoff. | Slutlig produktionskontroll använder endast ofarliga anonyma GET-anrop. |

Fokuserade delkörningar överlappar den samlade kontoreleasens testkörning och summeras inte. Samlad teststatus och produktionsbygge finns i releasens PR. Native inbjudans livscykel passerar 11/11 grupper och native godkännande/kontosäkerhet 10/10 grupper, utan ändrade testskript. Båda tillfälliga isolerade PostgreSQL-containrarna är borttagna.

Den befintliga hosted Auth-triggern `approved_application_registration_gate` är återläst som aktiverad och anropar `private.enforce_approved_application_invitation`. Funktionen kräver betrodd Auth-inbjudan, aktuell godkänd ansökan och fortfarande behörig godkännare. Detta är en skrivskyddad konfigurationskontroll, inte ett faktiskt signupförsök i produktion. Försök att läsa Auths publika settings direkt blockerades av molnmiljöns nätpolicy; ingen kringgående nätväg användes.

## Kräver separat mallbyte i Supabase

Efter att releasen är live: ersätt **Authentication → Email Templates → Reset password → Body** med hela [recovery.html](../supabase/templates/auth/recovery.html). [Installationsinstruktionen](AUTH_EMAIL_SETUP.md) beskriver exakt ordning och vad som bevaras. Git/Vercel uppdaterar inte denna hosted Auth-inställning, och de anslutna verktygen kan inte skriva den. Befintliga återställningslänkar ändras inte; begär ett nytt mejl efter bytet.

Den nya mallens direkta återställningslänk använder standardlandning efter ny inloggning, med befintlig superadmin-/handlarstyrning. Den överför inte den första enhetens ursprungliga dokumentdestination. Det äldre PKCE-flödet bevarar sin `next`-destination och kräver ursprunglig webbläsare. Ingen ny bred redirect-allowlist, SMTP-leverantör eller sändningsnyckel införs av ändringen.

Faktisk produktionsinloggning och ett helt nytt provkonto från inbjudan till inkorg har inte utförts, eftersom ingen avsedd autentiserad provsession är ansluten. Den tidigare separat godkända Resend-transportkontrollen är mottagen av användaren men bevisar inte Supabase SMTP eller denna kontoresas fullständiga livekedja. Superadminens adress, konto och lösenord är oförändrade; den tidigare Resend-spärren för dess ursprungsadress har inte hävts. Inga databas-, SMTP- eller Auth-mallinställningar har skrivits i denna etapp.
