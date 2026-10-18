# Trafexas autentiseringsmejl

Mallarna utvecklas och versionshanteras i projektet. **Lösenordsåterställning och andra befintliga Supabase Auth-mejl kräver mallarna i hosted Supabase och fungerande SMTP där.** En Git-/Vercel-publicering ändrar inte Supabases Site URL, redirectlista eller mejlmallar. En `RESEND_API_KEY` i Vercel konfigurerar inte Supabases SMTP.

Öppen registrering är stängd. Nya konton får en personlig kontoinbjudan först efter granskad webbansökan i superadmin. Just denna inbjudan genereras av Supabase Auth men skickas via projektets Resend-kod och mall i `src/lib/email/account-invitation-content.ts`; den behöver inte Supabases Invite user-mall eller SMTP. Se [kontokontraktet](ACCOUNT_APPROVAL_CONTRACT.md). Inbjudans adress är alltid `https://app.trafexa.com/auth/invitation`; länken förbrukas först när kunden skickar lösenordsformuläret.

## 1. Rätta produktionsadressen

Öppna [Authentication → URL Configuration](https://supabase.com/dashboard/project/buqdtssxrotkzndublrt/auth/url-configuration) i projektet **Trafexa Dealer**.

- **Site URL:** `https://app.trafexa.com`
- **Redirect URLs:** lägg till följande två rader:

```text
https://app.trafexa.com/auth/callback
https://app.trafexa.com/auth/callback\?**
```

Den andra raden har ett **bokstavligt backslash före frågetecknet**: Supabase använder globmönster och `?` är annars ett jokertecken. `**` behövs eftersom appens `next` innehåller `/` och ibland ytterligare queryparametrar. Mönstret håller host och callback-sökväg fasta och tillåter appens queryparametrar. Appen begränsar separat vilka interna `next`-destinationer som får användas. Undvik en bred `https://app.trafexa.com/**` i produktion.

En alternativ helt explicit allowlist är varje callback-URL som appen använder, inklusive hela querysträngen och exakt kodning. Lägg inte in enbart `/reset-password`: återställningsmejlet går först via `/auth/callback` för sessionsutbytet.

Kontrollera samtidigt att Vercels produktionsmiljö har `NEXT_PUBLIC_APP_URL=https://app.trafexa.com`. Localhost får bara vara en avsiktlig lokal testadress, aldrig produktionsstandard. Previewadresser kan läggas till separat vid behov, utan att ändra produktionsadressen.

En gammal redan skickad mejllänk ändras inte när inställningarna sparas. Begär en ny bekräftelse eller lösenordsåterställning efter ändringen. Dela inte hela mejllänken: den innehåller en personlig autentiseringstoken.

## 2. Lägg in mallarna i Supabase

Öppna [Authentication → Email Templates](https://supabase.com/dashboard/project/buqdtssxrotkzndublrt/auth/templates). Ersätt **Body** med hela motsvarande HTML-fil och **Subject** enligt tabellen. Spara varje mall.

| Supabase-mall | HTML-fil i `supabase/templates/auth/` | Subject |
| --- | --- | --- |
| Confirm sign up | `confirmation.html` | Bekräfta din e-postadress hos Trafexa |
| Reset password | `recovery.html` | Återställ ditt lösenord hos Trafexa |
| Change email address | `email_change.html` | Bekräfta byte av e-postadress hos Trafexa |
| Invite user | `invite.html` | Du har bjudits in till Trafexa |
| Magic link | `magic_link.html` | Din inloggningslänk till Trafexa |
| Reauthentication | `reauthentication.html` | Din verifieringskod för Trafexa |

Prioritera **Reset password** för befintliga användare. Confirm sign up bevaras för historiska Auth-flöden; webbplatsen erbjuder ingen öppen registrering. De andra mallarna är förberedda och aktiverar inte nya funktioner i Trafexas gränssnitt. Hosted Invite user-mallen används inte av det nya granskade ansökningsflödet.

För **Reset password** använder den aktuella mallen `https://app.trafexa.com/auth/recovery?token_hash={{ .TokenHash }}` i både knapp och reservlänk. Supabase fyller i sin befintliga engångstoken; appen skapar ingen egen Auth-token. Övriga länkmallar behåller `{{ .ConfirmationURL }}` exakt i href och länktext. Supabase fyller då i verifieringslänk och den tillåtna callbackadressen. Reauthentication använder i stället `{{ .Token }}` som kod; Change email address använder `{{ .NewEmail }}`. Mallarna visar inga påhittade giltighetstider och läser ingen användarmetadata.

## Återställning på en annan enhet, 18 oktober 2026

Publicera appens nya `/auth/recovery` innan Reset password-mallen byts i hosted Supabase. Kopiera därefter hela `supabase/templates/auth/recovery.html` till **Authentication → Email Templates → Reset password → Body** och behåll ämnesraden från tabellen. Övriga mallar och URL-/SMTP-inställningar behöver inte ändras för denna uppdatering. Verktygen i denna genomgång kan inte läsa eller skriva hosted Auth-mallen; en Vercel-publicering gör inte det åt er.

Den nya mallens direkta applänk kräver ingen ny Supabase redirect-allowlist. `forgotPasswordAction` fortsätter skicka den tidigare tillåtna `/auth/callback` som `redirectTo`, så äldre installerade ConfirmationURL-mallar fortsätter med sitt befintliga PKCE-flöde under utrullningen. Det flödet behöver webbläsaren där återställningen begärdes. Den nya mallens TokenHash-länk fungerar även på en annan enhet och återgår till vanlig inloggning efter lösenordsbytet; den för över ingen ursprunglig dokumentdestination från den andra enheten.

En öppning av den nya länken förbrukar ingen engångstoken och ändrar inget lösenord. Appen sparar bara en HttpOnly-cookie i högst en timme, begränsad till `/reset-password`, och visar en ren formuläradress. Först formulärets uttryckliga POST verifierar token som `recovery`, kontrollerar den färska användaridentiteten och ändrar lösenord. Tokenens verkliga giltighet och engångsanvändning kontrolleras av Supabase. Skanning eller förhandsvisning av mejlet utför ingen lösenordsändring. Utgången, återspelad eller felaktig länk kräver en ny begäran; inget annat redan inloggat konto får sitt lösenord ändrat som reserv.

Begär ett **nytt** mejl efter mallbytet. Redan skickade länkar ändras inte. Den vanliga inloggningen och äldre PKCE-callbacken finns kvar. Testa därefter en uttryckligt avsedd provanvändare från två separata webbläsare; ändra inte superadminens lösenord för att kontrollera funktionen.

## 3. Förvalta och kontrollera

Redigera källan i `scripts/render-auth-emails.mjs`, kör `node scripts/render-auth-emails.mjs` och checka in både källa och genererad HTML. `subjects.json` innehåller ämnesraderna för samma version. Kopiera sedan uppdateringarna till hosted Supabase. Ingen automatisk synkronisering är installerad; använd inte en allmän `supabase config push` som kan skriva över andra Auth-/SMTP-inställningar.

- Kontrollera i Supabases förhandsvisning att layout, knapp och ämnesrad visas korrekt.
- Med en avsedd testansökan: öppna Ansökningar i superadmin, granska och bekräfta kontoinbjudan, öppna mejlet, välj lösenord och verifiera inloggningen. `/register` ska leda till webbansökan och direkt offentlig signup ska nekas.
- Begär lösenordsåterställning, öppna det **nya** mejlet och verifiera att ett nytt lösenord kan sparas och användas. Kontrollera även utgången eller redan använd länk.
- Verifiera att mejlen inte längre innehåller en localhost-redirect. Testerna i repo kontrollerar HTML-layout och providerplatshållare; de bevisar inte hosted konfiguration eller faktisk leverans.

Mejlen är transaktionella kontomejl, utan reklam eller spårning. Supportkontakt är `info@trafexa.com`. En mejlmall ändrar inte avsändaradressen: egen avsändare kräver separat godkänd SMTP-konfiguration och verifierad domän. Länkspårning hos en eventuell SMTP-leverantör ska vara avstängd för autentiseringslänkar. Inga SMTP-, DNS- eller säkerhetsnotifieringsinställningar ändras av denna leverans.

Källor: [Supabase Email Templates](https://supabase.com/docs/guides/auth/auth-email-templates), [Redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls). Kontrollerade 2026-10-14.
