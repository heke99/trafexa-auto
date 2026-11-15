# Rate limits, sidor och flikar — 15 november 2026

## Verifierade gränser och återförsök

Ansökningsdatabasen tillåter högst 10 nya ansökningar per minut totalt och 3 per timme per normaliserad mejladress. Exakt återanvändning av en redan accepterad begäran kontrolleras före begränsningen och ger samma kvitto utan en ny rad. Isolerade SQL-prov verifierar båda gränserna, återställning av tidsfönstren och återförsök när gränsen redan är full. Gränser och databasbehörigheter ändras inte.

Ansöknings-API:ets HTTP 429 ger nu tydlig väntetext, `Retry-After: 60` och `Cache-Control: no-store`. En minut är en rekommenderad lägsta väntan före nytt försök, ingen utfästelse om när timgränsen upphör. Inloggningens verifierade Supabase-throttling ger väntetext i stället för felaktig uppmaning att kontrollera lösenordet. Lösenordsåterställning behåller samma kontosäkra svar för att inte röja om en mejladress har ett konto.

Ingen egen per-IP-limiter finns i källkoden. Vercels läsning av den aktiva brandväggskonfigurationen returnerade `404 / Seawall Config not found` och anslutningens åtkomstdiagnostik. Vercel CLI saknas i arbetsmiljön. Detta verifierar varken frånvaro eller förekomst av aktiva WAF-regler. Supabase Auths faktiska produktionsgränser är inte verifierade här. Inga produktionsbelastningstester eller brandväggsändringar görs.

Nästa kontroll för skydd före databasen är att läsa Vercels aktiva konfiguration och trafik med rätt behörighet. Riktade loggregler för `POST /api/demo-requests` och autentiseringsformulär kan därefter bedömas per IP och metod, med hänsyn till att flera handlare kan dela företagsnät. Vercelregler för Trafexas formulär täcker inte direkta anrop till Supabase Auths egen origin. Webhook och intern annonskörning ska hållas separata från sådana formulärregler.

## Rättade navigeringsfel

- Handlarens fasta sidmeny kan nu rullas vertikalt i korta fönster och mobilt liggande läge. Nedersta länkarna förblir åtkomliga medan mobilmenyn låser bakgrundens scroll.
- Reservation och släppt reservation rapporterar pågående formulärskrivning till affärens befintliga navigeringsskydd. Flikbyte, stängning, sökning och byte av vy kan inte tappa bort det pågående resultatet. Ingen automatisk omsändning eller backendändring införs.
- Avbrutet kontobeslut och avbruten medlemsgranskning i superadmin återställer tangentbordsfokus till exakt den radknapp som öppnade granskningen. Konton, medlemsroller och beslut ändras inte av dessa navigeringsprov.

Verifieringen omfattar 226 godkända testfall i 14 unika sviter samt 48 sid-/flikvyer mot det lokala produktionsbygget: startsida, kontaktankare, policyer, inloggning, lösenordsåterställning och nio demoflikar vid 320, 390 och 1440 px. Inga sidfel eller horisontella sidöverflöden upptäcktes i den genomgången. De inloggade handlar-/adminåtgärderna provas med isolerade webbläsarunderlag, inte en verklig användarsession. Inga riktiga ansökningar, kontobeslut, reservationer, mejl eller underskrifter skapas.
