# Testmiljö och kontrollerad omkörning

Den 12 november 2026 visade den ordinarie molnkontrollen running, men Codex terminalanslutning svarade att ingen användbar exekveringsmiljö fanns. Det var en plattforms-/anslutningsfråga, inte ett testfel i Trafexa. En separat tillfällig Vercel Sandbox kunde användas för verklig Node-, SQL- och Chromium-körning. Produktionsdata och serverhemligheter kopierades inte.

## Förutsättningar

- Node.js 24 enligt package.json, Git och projektets låsfil.
- På Ubuntu: `libnss3`, `libnspr4`, `fontconfig`, `libfontconfig1`, `fonts-dejavu-core`, `poppler-utils` och `python3`.
- HTTPS till projektets Git-källa och npm-registret. För Ubuntu-paket krävs godkända officiella paketservrar.
- Ingen Supabase service-nyckel eller verklig mejlmottagare för isolerade testfixturer. Partnerprov är separata.

I managed Codex Cloud ska miljöns tillgängliga paketinstallerare användas där den finns. I en avsedd Ubuntu-baserad Vercel Sandbox användes följande efter kontroll av officiella Ubuntu-källor:

```sh
sudo apt-get update
sudo apt-get install -y libnss3 libnspr4 fontconfig libfontconfig1 fonts-dejavu-core poppler-utils python3
fc-cache -f
```

Om paketservrarna använder HTTP men miljön bara tillåter TLS, byt endast transporten för de redan konfigurerade officiella Ubuntu-URL:erna till HTTPS. Behåll domäner, distribution, signaturkontroll och nycklar. Stäng inte av TLS- eller signaturkontroll och öppna inte hela nätverket.

## Ren installation

Kör från repositoryroten:

```sh
npm ci --ignore-scripts
npm run test:setup
npm run pretest
npm test -- --test-concurrency=2
npm run typecheck
npm run build
npm audit --json
```

`test:setup` installerar de två låsta PGlite-fixturerna. `pretest` kontrollerar deras beroenden och packar upp Chromium innan parallella testprocesser startas. Det verifierar nu dessutom riktig textrendering, klick och skärmbild i en isolerad sida. Det kontrollerar även `pdftotext` för tester som läser genererade PDF-filer. Inga externa webbanrop behövs för provet. Python 3 behövs för vissa arkivprov; Docker-baserade native PostgreSQL-sviter har egna förutsättningar.

En körbar Chromium-fil räcker inte: i den rena Ubuntu-bilden saknades först NSS och sedan Fontconfig. Ett enkelt start-/DOM-prov passerade medan första verkliga textklicket kraschade. Därför ska renderingsprovet passera innan browserfel tillskrivs produkten.

## Arbetsordning och bevis

1. Lås källans commit, kontrollera ren arbetskatalog och kör baslinjen före ändringar.
2. Kör högst två flat-testprocesser samtidigt på den verifierade 4-vCPU/8-GB-miljön; sänk vid resursfel.
3. Spara faktisk exitstatus och slutantal. Ett reproduktionsprov som lyckas bevisa ett fel är inte bevis på att felet är rättat.
4. Separera verklig SQL/SDK/browser från kontrollerad Auth-/Storage-/partnertransport.
5. Använd avsedda provkonton och en städplan för eventuella liveprov. Blocket-/Waykenycklar, inloggningssessioner och mejlaktivering ska inte läggas i chatten.
6. Stoppa en tillfällig Sandbox efter avslutad granskning. Exportera relevanta rapporter och bevis innan den stoppas. Den ordinarie Codex-anslutningens återställning är separat från att en alternativ testmiljö fungerar.

Ingen lyckad lokal testsvit bevisar faktisk Blocket-/bankleverans, mottagen mejllänk eller en autentiserad produktionsresa. Dessa scenarier måste ha egna verifierade utfall.
