# Equipments Agent Guide

## Project Shape

Equipments is a Node 22+ TypeScript Fastify service. It does not contain a Go
module, so `go test ./...` is not a valid verification command for this repo.

## Verification

Use the Node project gates:

```bash
npm ci
npm run build
npm run test:non-gherkin
npm run test:gherkin
npm run test:ui:install
npm run test:ui
```

`npm run build` type-checks the service and copies playground assets into
`dist/`. `npm run test:non-gherkin` runs the regular Node test files, and
`npm run test:gherkin` runs the Gherkin feature suite. `npm test` runs both
test suites for local convenience. `npm run test:ui` runs the Playwright
playground smoke test; use `npm run test:ui:headed` when you need to watch the
browser clicks locally. Fresh Linux environments need `npm run test:ui:install`
before the UI test can launch Chromium because it installs the Playwright
browser plus required host system libraries.

In GitHub Actions, successful browser UI runs also keep replay artifacts. The
workflow uploads `playwright-artifacts` with `playwright-report/` and
`test-results/`, including `test-results/**/trace.zip` and video `.webm` files.
Replay a downloaded trace with `npx playwright show-trace path/to/trace.zip`.

Run `npm ci` whenever dependencies may be absent, including fresh refinery or
worker clones.
