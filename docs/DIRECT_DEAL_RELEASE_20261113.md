# Enklare affär och PDF-signering — verifieringsrapport

## Omfattning och identitet

Repository `heke99/trafexa-auto`, utgångspunkt `b0446c9461a49e32fb96b2ffa7cec888959000ef`. Arbetsgren `codex/direct-deals-pdf-signing-20261113`. Verifiering den 13 november 2026 med Node 24, Next 16.4.3 och Chromium. Lokala isolerade databaser och anpassade Auth/Storage/SMTP-gränser används för mutationstester. Produktionsprojektets befintliga data ändras inte av dessa tester.

## Beteende

Skapa affär → välj bil och befintlig/ny kund → ange överenskommet pris → granska → behörig ägare/administratör godkänner och skickar → kunden signerar via personlig länk. Ingen accepterad offert skapas som genväg. Säljrollen kan förbereda men kan inte attestera för företaget. Kundens person-/organisationsnummer behandlas i det privata avtalsunderlaget, inte i vanliga kundlistor eller webbläsarlagring.

Affärslistan visar kompakta rader och en öppen affär i taget. Inbytesunderlag har en stor direktknapp. Detaljerad mejl-/länkstatus är stängd som standard; leverantörens accepterade utskick likställs aldrig med bekräftad leverans till inkorgen. Momsvalet har förklaringar utan att ändra befintlig kalkyllogik.

Uppladdad PDF är en separat signeringskälla. Originalet bevaras och hashverifieras; signerad PDF innehåller en redovisad signeringssida och separat evidens. Den ersätter inte affärens strukturerade ekonomiska underlag för betalning/leverans. Enkel elektronisk underskrift via konto/personlig länk används, inte BankID eller certifikatbaserad PDF-signatur.

## Testmatris

| ID | Prioritet | Kedja | Bevis och gräns |
|---|---|---|---|
| DIRECT-01 | P0 | Ny kund + bil + pris → fryst avtal → företagets godkännande → mejlkö | Faktiska serveråtgärder/SQL/PDF-förkontroll, browser 320/1440; Auth/SMTP adapter |
| DIRECT-02 | P0 | Kundens signering → PDF/evidens → arkiv → export/återställning | Faktisk SQL/rendering/arkiv/CLI; lokala syntetiska identiteter |
| DIRECT-03 | P0 | Betalning, återföring och leverans efter direktavtal | Manuellt attesterade åtgärder och SQL; inga externa banktransaktioner |
| DIRECT-04 | P0 | Roller, tenant, gamla svar, dubbelklick, förlorat svar, kontakt-CAS | UI/API/SQL; samma request-id återförsöks, noll fabricerade offerter |
| PDF-01 | P0 | Uppladdning → företagsattest → personlig mejllänk → kundunderskrift → nedladdning | Faktiska routes/SQL/rendering och browser 320/1440; transportadapter |
| PDF-02 | P0 | Skadlig/felaktig PDF, storleksgräns, Origin, privat Storage och gästgräns | Route-, parser-, SQL- och bucket-migrationsprov |
| PDF-03 | P0 | Återkallelse kontra samtidig signering | Separat samtidighetsregression och radlås |
| UI-01 | P1 | Affärslista, inlinekund, inbyte, roller och busy-skydd | Faktiska komponentprov och visuellt granskade mobil-/desktopbilder |
| UI-02 | P1 | Publika sidor och nio läsbara demovyer | Byggd Next-app, 48 sid-/viewportkombinationer, inga pageerrors/överbredd |
| LIVE-01 | P0 | Inloggad produktionskund får och signerar verkligt utskick | BLOCKED: agenten saknar inloggad appsession; inga kundunderskrifter fabricerade |

Detaljer och maskerade bevis finns i `DIRECT_DEAL_FLOW_20261113.md`, `UPLOADED_PDF_SIGNING_20261113.md` och katalogerna `verification/20261113-*`.

## Kvalitetsgränser

Publik browsercrawl omfattar 45 dokument-GET med 200 och tre ankarnavigeringar. Sex prov med ersättningsfonter passerar vid 320 px. `/pdf-document` utan giltig personlig capability returnerar 404. Externa browseranrop och alla skrivningar blockeras i denna crawl.

Äldre UI-prov som förutsatte tabellrader, förregistrerad kund eller alltid synliga tekniska mejldetaljer har anpassats till den avsedda nya navigeringen. Deras behörighets-, idempotens-, penning- och arkivassertioner behålls. 231 testfiler omfattar 2 101 godkända testfall efter riktade omkörningar av nio berörda UI-/harnessfiler, utan överhoppade eller avbrutna testfall. Full körning och separata rättningsomkörningar redovisas i `verification/20261113-direct-deal/regression.json`. PDF-samtidighetsrättningen verifieras dessutom separat.

## Produktion, externa tjänster och städning

Ingen extern e-post skickas i denna verifiering. Lokal fångad mejlkropp bevisar generering och länkflöde, inte Resend-/inkorgsleverans. Blocket/Wayke och bankkopplingar aktiveras inte av ändringen. Separat extern backupplats är fortfarande inte vald. Testdatabaser och egna browser-/HTTP-processer stängs efter proven.

Full produktionsverifiering är inte grön förrän LIVE-01 körts i en verklig inloggad session. Lokala godkända flöden, migrations-/behörighetskontroller och ett lyckat produktionsbygge redovisas separat från den gränsen.

De två nya migrationerna tillämpades på det befintliga produktionsschemat som `20261113104040_uploaded_pdf_signing` och `20261113104058_direct_deal_contracts`. Lokala filversioner följer de faktiskt tilldelade hosted-versionerna; migrationshistoriken skrivs inte om. Produktionskonfigurationens mejlflaggor och närvaro av servernycklar verifierades via metadata utan att hämta hemligheter. Ingen ny obligatorisk miljövariabel krävs.

Efterkontroll: samma tre befintliga affärer, noll nya produktionsutkast/signeringar/arkiv, noll uppladdade PDF-källor/underskrifter. Privat bucket och RLS på samtliga tio nya privata tabeller är verifierade; inga direkta anon/authenticated-tabellgrants eller anon-signering/attest. Advisorgranskning visar fyra nya avsiktliga authenticated SECURITY DEFINER-endpoints för PDF: samtliga kräver aktuell företags-/konto-/owner-adminåtkomst i SQL och omfattas av negativa behörighetsprov. Tio nya INFO om privata tabeller utan publika RLS-policyer motsvarar avsiktlig RPC-only-åtkomst. Befintlig varning om leaked-password protection kvarstår; den ändras inte av detta arbete.
