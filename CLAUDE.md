# Equipments Agent Guide

## Project Shape

Equipments is a Node 22+ TypeScript Fastify service. It does not contain a Go
module, so `go test ./...` is not a valid verification command for this repo.

## Verification

Use the Node project gates:

```bash
npm ci
npm run build
npm test
```

`npm run build` type-checks the service and copies playground assets into
`dist/`. `npm test` runs the Node test runner through `tsx` against
`test/**/*.test.ts`.

Run `npm ci` whenever dependencies may be absent, including fresh refinery or
worker clones.
