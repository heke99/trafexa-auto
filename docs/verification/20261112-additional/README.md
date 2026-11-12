# Kompletterande reproduktioner 12 november 2026

Appbaslinje: `681df2dbbbc884218cd2d58b03c2ae037446c84c`. Kör från repositoryroten efter `npm ci --ignore-scripts` och `npm run test:setup`, med Node 24 och de dokumenterade PDF-/testberoendena.

```sh
node docs/verification/20261112-additional/cost-replay.mjs
node docs/verification/20261112-additional/cjk-signature.mjs
node docs/verification/20261112-additional/admin-redirect.mjs
```

Skripten bekräftar att de beskrivna felen finns i baslinjen. Exit 0 betyder att reproduktionens assertioner stämmer; det betyder inte att produkten är rättad. De ingår därför inte i den ordinarie flat-testsviten. När felen rättas ska förväntningarna ersättas med riktiga regressionsprov.

Databasproven använder tillfällig lokal PGlite och stänger den efteråt. Auth, Storage och utgående transport är kontrollerade adaptrar. CJK-provet använder enbart syntetiska nycklar och fångar alla HTTP-anrop; inga riktiga mejl eller dokument skickas. Adminprovet testar den faktiska proxyn med en anonym Auth-fixtur. Det kompletterades med verklig lokal Next/Chromium vid 320/1440 px; de maskerade resultaten finns i `evidence.json`.

Se [kompletterande rapport](../../E2E_REVIEW_20261112_ADDITIONAL.md).
