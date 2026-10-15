# Register UI regression tests

Run the Chromium suite from the repository root:

```sh
node tests/register-ui.test.mjs
```

Optional JSON evidence stays outside the repository:

```sh
TRAFEXA_REGISTER_QA_DIR=/workspace/trafexa-dealer-qa/registers-20261015 node tests/register-ui.test.mjs
```

The suite compiles the actual `DealerRegisters`, `DealForm`, and `DealerWorkspace` sources with the installed Next compiler and uses the pinned Playwright/Chromium dependencies. It loads the actual application stylesheet. No Next server, credentials, database, or external network is required. All browser network requests are blocked, server actions use explicit in-memory responses, and importing `server-only` fails the build.

The fixtures cover remote records outside a 500-row snapshot, cursor history, search/filter races, identity changes, untrusted response scope, selector reconciliation, exact price input, lazy cost loading, drafts during failed refreshes, and demo behavior at 320 and 1280 pixels. Cursor ordering and database authorization have separate backend tests; these UI tests verify how the actual components use the contract.

Unrelated workspace widgets and navigation are adapters. The calculation adapter records whether verified costs are passed to the calculation consumer; it does not test the calculation implementation. Reports identify individual new cases and are not combined with earlier release QA totals.
