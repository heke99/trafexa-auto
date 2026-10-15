# Granskade fakturamejl

Superadmin granskar en faktisk utfärdad annonsfaktura eller kreditfaktura, den frysta faktureringsadressen, dokumentnumret och beloppet innan mejlet köas. Mottagaren kommer från originalets sparade köparprofil. Webbläsaren får inte ange mottagare, mejltext, bilaga eller leverantörsutfall. En köpost per dokument och ett aktörsbundet återförsökskvitto förhindrar dubbel köning. Konton, företag och administratörsbehörighet kontrolleras aktuellt före nya utskick. Ett helkrediterat original får inte skickas som ett nytt betalningskrav. Kreditfakturan har ett eget utskick.

Mallen är versionshanterad HTML och ren text med avsändare `Trafexa <kundtjanst@trafexa.com>` och svar till `info@trafexa.com`. Den har inga öppningspixlar, reklam eller inloggningstokens. PDF genereras från exakt sparad faktura/kredit med oförändrad renderer. Hela leverantörsbegäran inklusive Base64-bilagan samt PDF:ens SHA-256 binds oföränderligt till köposten före nätverksanropet. Ändrade bytes kan inte återförsökas under samma utskicksnyckel. Bilagan begränsas till 10 MiB före Base64, under leverantörens mejlgräns.

En explicit superadminåtgärd hyr en köpost i 60 sekunder och gör högst ett nätverksförsök. Inget schemalagt massutskick aktiveras. Endast känd utebliven acceptans, exempelvis 429 eller samtidig användning av samma idempotensnyckel, får nytt försök efter serverns väntetid. Gränsen är fem försök och 23 timmar från första försöket. Ett gammalt, aldrig påbörjat köat mejl får sitt första försök när det faktiskt skickas. Timeout, 5xx, trasig respons och utgången pågående sändning ger okänt utfall; de skickas inte automatiskt igen.

Leverantörens svar registreras endast via serverns serviceklient och exakt ursprunglig lease, aktör och payload-/PDF-hash. Det historiska utfallet kan sparas även om aktören spärras efter nätverksanropet. Ny sändning kräver aktuell behörighet. En spärr precis efter sista kontrollen kan inte återkalla ett mejl som leverantören redan accepterat.

Signerade leveranshändelser tas emot på `/api/webhooks/resend/invoice-email`. Svix 2.8.0 verifierar råa request-bytes, signatur och tidsstämpel före JSON-tolkning. Högst 64 KiB läses och läsningen tidsbegränsas. Endast fakturamejlens särskilda tagg och leverans-, studs- och spamklagomål behandlas. Faktisk mottagare binds genom hash; rå mejltext, rå eventbody och mottagaradress lagras inte i eventtabellen. Händelse-ID avdubblas och en ändrad återanvändning nekas. Databasens kvitto måste finnas före HTTP 200.

Händelser kan komma före sändningssvaret. Verifierad köposttagg, exakt mottagarhash och redan bundna payload-/PDF-hashar kan då återställa accepterad/levererad status för en påbörjad eller okänd sändning, även efter en processkrasch. Ej påbörjade, avbrutna eller avvisade poster återupplivas inte. Ett senare identiskt leverantörssvar är idempotent. Leverans, studs och klagomål bevaras som separata fakta; ett sent leveransevent suddar inte ut ett klagomål. Studs/klagomål spärrar nya utskick till samma adress. Obundna event begränsas och rensas efter 24 timmar.

**Accepterat** betyder accepterat av leverantören. **Levererat** betyder accepterat av mottagarens mejlserver, och bevisar inte att någon läst mejlet eller betalat. Företagets ägare/admin/finance ser sina egna utskicksuppgifter. Andra företag och icke-ekonomiska roller nekas. Konto- och avtalsmejl behåller sin tidigare separata kö.

## Aktivering i Vercel och Resend

Välj Vercel-projektet `trafexa-auto`, miljön **Production**. Användaren lägger själv hemligheterna direkt där. Inga nycklar ska läggas i Git, publika variabler eller chatten.

| Variabel | Innehåll |
|---|---|
| `ADVERTISING_INVOICE_EMAIL_ENABLED` | `true`, separat aktiveringsflagga för detta flöde |
| `TRANSACTIONAL_EMAIL_DOMAIN_VERIFIED` | `true`, efter bekräftad avsändardomän |
| `RESEND_API_KEY` | Resend-sändningsnyckel begränsad till verifierad avsändardomän |
| `SUPABASE_SECRET_KEY` | Servernyckel för rätt Supabase-projekt, används enbart i serverkod |
| `RESEND_WEBHOOK_SECRET` | Signeringshemligheten för fakturamejlens webhook |

Skapa webhook i Resend till `https://app.trafexa.com/api/webhooks/resend/invoice-email` med `email.delivered`, `email.bounced` och `email.complained`. Kopiera dess signing secret direkt till `RESEND_WEBHOOK_SECRET` i Vercel. Behåll domänens öppnings-/länkspårning avstängd. Deploya om efter ändrade miljövariabler; en tidigare deployment får inte automatiskt nya värden.

Utskick kräver samtliga flaggor och tre serverhemligheter samt rätt Supabase-URL. Ofullständig konfiguration tillåter granskad förberedelse men ingen claim eller nätverkssändning. Aktiveringsflaggan skickar inga fakturor av sig själv. Superadmin öppnar det sparade dokumentet, väljer mejlpanelen och bekräftar avsändningen. Därefter verifieras acceptans, leverans och studs med en uttryckligen vald verklig mottagare. Generella kontomejl och Supabase Auth SMTP aktiveras separat.

## Källor och verifieringsgräns

- [Resend: skicka mejl och bilagor](https://resend.com/docs/api-reference/emails/send-email)
- [Resend: idempotens](https://resend.com/docs/dashboard/emails/idempotency-keys)
- [Resend: verifiera rå webhook](https://resend.com/docs/webhooks/verify-webhooks-requests)
- [Leveranshändelse](https://resend.com/docs/webhooks/emails/delivered), [studs](https://resend.com/docs/webhooks/emails/bounced) och [klagomål](https://resend.com/docs/webhooks/emails/complained)

Testresultat, hosted schema och faktisk release redovisas i [IMPLEMENTATION_STATUS](IMPLEMENTATION_STATUS.md). Syntetiska leverantörs-/webhookprov bevisar inte verklig mejlleverans. Delkreditering, betalningsavstämning och bokföring är separata ekonomisteg.
