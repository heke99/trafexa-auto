# Selektiv DocuSeal-portning

Ägaren har angett https://github.com/docusealco/docuseal som källa och bekräftat godkännande för användning och portning utan separat licens. Källversionen är låst till `3c65b0e4ba872fe71d5566c0d09c3ace59a7fb8a` (12 oktober 2026). Proveniens dokumenteras för kod som faktiskt används; hela Rails-/Vue-applikationen importeras inte.

## Del som portas i denna leverans

`app/javascript/submission_form/validate_signature.js`, blob `bcdb2891c67c04a4bff7903dae6d8a7295b44458`, anpassas till TypeScript i `src/lib/signing/docuseal-ported/signature-validation.ts`. Den kontrollerar ritade namnteckningspunkter och om webbläsaren tillåter canvas. Trafexas lokala förhandsgranskning av namnteckningsfält använder dessa funktioner utan att spara ritningen eller signera ett dokument.

Anpassningen begränsar antal streck/punkter, kräver ändliga koordinater och hanterar degenererade linjer uttryckligen. Originalets division med noll kan annars ge NaN och släppa igenom identiska punkter. En verklig sluten kurva hanteras separat. Valideringen bedömer grafiska punkter, inte identitet, BankID eller en juridiskt verifierad signatur.

Källa: [låst originalfil](https://github.com/docusealco/docuseal/blob/3c65b0e4ba872fe71d5566c0d09c3ace59a7fb8a/app/javascript/submission_form/validate_signature.js).

## Befintlig integrationsgrund

Trafexas serverkod för DocuSeal-transport, låsta jobb, status, privata filer och webhookkontroll finns redan i `src/lib/signing`. HMAC-semantiken har jämförts med [signatures.rb](https://github.com/docusealco/docuseal/blob/3c65b0e4ba872fe71d5566c0d09c3ace59a7fb8a/lib/webhook_urls/signatures.rb), blob `937a316e2aea15575719fe7ed95cbaff482a4b3c`: SHA-256 över tidsstämpel, punkt och exakta bodybytes, med hela hemligheten och fem minuters tolerans.

Denna leverans bygger Trafexas företagsbundna mallgranskning och osignerade avtalsversioner från accepterade offerter. Konton, medlemskap, behörigheter och affärsdata använder Trafexas befintliga modell. Namnteckningsförhandsgranskning, accepterad offert, avtalsutkast och fullbordad elektronisk signering är separata tillstånd.

Aktiv underskrift, signerad PDF, signeringsbevis och drift kopplas i ett efterföljande verifierat flöde. De två tidigare opublicerade signing/archive-migrationerna appliceras inte av denna leverans, och inga verkliga signeringsuppdrag eller mejl skickas.
