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
```

`npm run build` type-checks the service and copies playground assets into
`dist/`. `npm run test:non-gherkin` runs the regular Node test files, and
`npm run test:gherkin` runs the Gherkin feature suite. `npm test` runs both
test suites for local convenience.

Run `npm ci` whenever dependencies may be absent, including fresh refinery or
worker clones.
