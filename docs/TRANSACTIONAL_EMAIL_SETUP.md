# Trafexas transaktionsmejl

Supabase Auth hanterar lösenordsåterställning och sina verifieringsmejl enligt AUTH_EMAIL_SETUP.md. Välkomstmejlet efter granskad ansökan skickas separat via Resend enligt [kontokontraktet](ACCOUNT_APPROVAL_CONTRACT.md). Händelsemejlen nedan har en egen kö och aktiveringsflagga. Samma SMTP-inställning i Supabase aktiverar inte dessa utskick.

Adminpanelens köantal gäller enbart dessa händelsemejl, inte kontoinbjudningar, Auth-mejl eller fakturamejl. Status skiljer pausad transport från saknad konfiguration och visar separat om välkomstmejl är konfigurerade. Statusläsning och sidöppning skickar aldrig mejl. Produktionskontroll 16 oktober 2026 visar verifieringsflagga och servernycklarnas förekomst, men `TRANSACTIONAL_EMAIL_ENABLED` saknas. Därför är händelsemejlen pausade medan granskade kontoinbjudningar har separat konfigurationskontroll. Inga väntande mejl skickas som del av UI-ändringen.

Avsändare: **Trafexa <kundtjanst@trafexa.com>**. Svar går till **info@trafexa.com**. Mallar versionshanteras i `src/lib/email/templates.ts` och innehåller HTML och ren text, utan kunduppgifter, autentiseringstokens, bilagor eller spårning.

| Händelse | Mottagare | Underlag |
| --- | --- | --- |
| Ny webbansökan | Ansökans e-postadress | Sparad ansökan, befintlig global/adressbaserad throttling |
| Ny webbansökan | Aktiva verifierade superadministratörer | Privat UUID-registry, inga ansökningsuppgifter i mejlet |
| Konto godkänt | Kontots verifierade e-postadress | Superadmins uttryckliga kontogodkännande |
| Avtal för underskrift | Avtalets bundna kundadress | Sparad signeringssession |
| Avtal slutfört | Avtalets bundna kundadress och företagets faktiska signerare | Båda parternas sparade underskrifter, aktuell kontobehörighet |

## Aktivering

Den första transporten använder Resends API. Verifiera `trafexa.com` med de DNS-poster leverantören anger och stäng av länk-/öppningsspårning. Avsändardomänen `trafexa.com` har lagts till i Resend i region `eu-west-1`, med framtvingad TLS och utan länk-/öppningsspårning. Återläsning 2026-10-15 visar verified för domänen och samtliga DKIM-/SPF-poster. Produktionsnyckel och separat Auth SMTP är ännu inte verifierade som konfigurerade för appen; faktisk leverans är inte verifierad. Ersätt inte befintliga SPF-/DMARC-poster utan att kombinera dem korrekt.

Sätt servermiljövariabler i produktionsprojektet, aldrig i publika variabler eller Git:

- `RESEND_API_KEY`: begränsad sändningsnyckel för verifierad avsändardomän.
- `TRANSACTIONAL_EMAIL_DOMAIN_VERIFIED=true`: sätt endast efter faktisk domänverifiering.
- `TRANSACTIONAL_EMAIL_ENABLED=true`: aktiverar eventbundna utskick och superadmins manuella köhantering.
- `SUPABASE_SECRET_KEY`: servernyckel för den begränsade service-RPC-transporten.

Saknad konfiguration innebär inga nätverksutskick. Andra SMTP-leverantörer kan anslutas genom transportgränssnittet; deras lösenord eller Supabase SMTP-inställningar läses inte av appen.

## Leverans och återförsök

En privat databasoutbox skapas i samma transaktion som ansökan, kontogodkännande eller signeringshändelse. En unik händelse-/mottagarbindning förhindrar dubbla köposter. Appen försöker skicka efter den sparade händelsen när transporten är aktiverad. Superadmin kan även skicka nästa köpost med en explicit åtgärd. Inget cronjobb finns.

Service-RPC:er hyr en post under 30 sekunder, kontrollerar aktuellt underlag och mottagare igen före sändning och sparar leverantörens accepterade ID. Resend får en stabil idempotency-key baserad på köpostens UUID. Timeout, trasig respons och okänt serverutfall markeras **unknown** och skickas inte automatiskt igen. Utgången lease markeras också unknown. En 429 kan återförsökas högst fem gånger; inga blockerande retryloopar finns. Efter 23 timmar krävs manuell utredning eftersom leverantörens idempotencyfönster är begränsat.

**Accepted betyder att leverantören accepterat mejlet, inte att det levererats till inkorgen.** Leverans-, bounce- och complaint-webhooks samt faktisk mottagartestning är separata aktiveringssteg. Denna leverans skickar inga faktiska testmejl. Lägg inte till reklam i dessa transaktionsmallar.

Ansökningsradering stoppar väntande utskick. Konto-/administratörsbehörighet och avtalsunderlag kontrolleras före sändning. En återkallelse exakt samtidigt med ett redan påbörjat nätverksutskick kan inte dra tillbaka ett mejl leverantören redan accepterat. Tidigare accepterade köposters metadata omfattas av organisationens lagrings- och raderingsrutiner.

## DNS för den förberedda Trafexa-domänen

Resend-domänen skapades 2026-10-14 i EU-regionen eu-west-1, med tvingad TLS och utan länk-/öppningsspårning. Status vid skapandet: not_started. Dessa offentliga DNS-poster behöver läggas hos domänens DNS-operatör. TTL: Auto. Behåll befintliga MX-poster för ordinarie inkorgar.

| Typ | Namn | Värde | Prioritet |
| --- | --- | --- | --- |
| TXT | resend._domainkey | p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQC1QhYhGJJn9sLx1GBXlrFyLPzgIhe36kz037wqf/oSRE5bsU1j4wmSdMKdivmzi+AVdmN3BwNpDvG+glPyX4dXfbXncNe+NWSTgyx0XQCftyjg9izcISpRtkd9LbbVW40bUt9NRKJl5sC9MI9DJ8GP4d4ajShNuCx/knAhVT1j5wIDAQAB | — |
| MX | send | feedback-smtp.eu-west-1.amazonses.com | 10 |
| TXT | send | v=spf1 include:amazonses.com ~all | — |
| CNAME | rsend | send.forge.rmta.net | — |

Domänverifieringen är bekräftad 2026-10-15. Konfigurera produktionsnyckeln i Vercel utan att dela den i chatten. Supabase Auth behöver separat SMTP-konfiguration med samma verifierade avsändare. Domänskapandet aktiverar inte utskick och bevisar inte leverans.

## Fakturamejl

Granskade faktura- och kreditmejl har nu en separat kö, exakt PDF-bilaga och signerade leveranshändelser enligt [ADVERTISING_INVOICE_EMAIL_CONTRACT](ADVERTISING_INVOICE_EMAIL_CONTRACT.md). De använder en egen aktiveringsflagga och aktiverar inte de generella konto-/avtalsutskicken automatiskt. Servernycklar och Resend-webhook måste finnas; verklig leverans provas separat.
