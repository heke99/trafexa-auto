# Trafexas autentiseringsmejl

Mallarna utvecklas och versionshanteras i projektet. **Supabase Auth skickar mejlen och måste ha mallarna sparade i sitt hosted projekt.** En Git-/Vercel-publicering ändrar inte Supabases Site URL, redirectlista eller mejlmallar.

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

Prioritera **Confirm sign up** och **Reset password** för det aktuella registrerings- och återställningsflödet. De andra mallarna är förberedda och aktiverar inte nya funktioner i Trafexas gränssnitt. Inbjudningsmallen lovar inga särskilda företags- eller administratörsbehörigheter.

Behåll `{{ .ConfirmationURL }}` exakt i länkarnas href och länktext. Supabase fyller själv i verifieringslänk och den tillåtna callbackadressen. Mallarna konstruerar inga egna tokens eller hashfragment. Reauthentication använder i stället `{{ .Token }}` som kod; Change email address använder `{{ .NewEmail }}`. Mallarna visar inga påhittade giltighetstider och läser ingen användarmetadata.

## 3. Förvalta och kontrollera

Redigera källan i `scripts/render-auth-emails.mjs`, kör `node scripts/render-auth-emails.mjs` och checka in både källa och genererad HTML. `subjects.json` innehåller ämnesraderna för samma version. Kopiera sedan uppdateringarna till hosted Supabase. Ingen automatisk synkronisering är installerad; använd inte en allmän `supabase config push` som kan skriva över andra Auth-/SMTP-inställningar.

- Kontrollera i Supabases förhandsvisning att layout, knapp och ämnesrad visas korrekt.
- Med ett avsett testkonto: registrera via `app.trafexa.com`, öppna ett **nytt** bekräftelsemejl i samma webbläsare som startade registreringen och verifiera att callback landar på rätt interna sida. PKCE kräver webbläsarens verifierare.
- Begär lösenordsåterställning, öppna det **nya** mejlet och verifiera att ett nytt lösenord kan sparas och användas. Kontrollera även utgången eller redan använd länk.
- Verifiera att mejlen inte längre innehåller en localhost-redirect. Testerna i repo kontrollerar HTML-layout och providerplatshållare; de bevisar inte hosted konfiguration eller faktisk leverans.

Mejlen är transaktionella kontomejl, utan reklam eller spårning. Supportkontakt är `info@trafexa.com`. En mejlmall ändrar inte avsändaradressen: egen avsändare kräver separat godkänd SMTP-konfiguration och verifierad domän. Länkspårning hos en eventuell SMTP-leverantör ska vara avstängd för autentiseringslänkar. Inga SMTP-, DNS- eller säkerhetsnotifieringsinställningar ändras av denna leverans.

Källor: [Supabase Email Templates](https://supabase.com/docs/guides/auth/auth-email-templates), [Redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls). Kontrollerade 2026-10-14.
