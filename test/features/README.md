# Gherkin Feature Coverage Map

The executable behavior specs in this directory are discovered by
`test/gherkin-demo.test.ts`. Each `*.feature` file may contain multiple
scenarios; the runner executes every scenario with fresh service state.

## Current Coverage

| Feature file | Behavior area | Status | Notes |
| --- | --- | --- | --- |
| `audit-metadata.feature` | Audit metadata and local callers | Active | Covers API-visible caller metadata, stable local user reuse across reservation/container writes, partial caller header rejection, and read routes not emitting audit events. |
| `auth.feature` | Bearer authentication | Active | Covers anonymous rejection, read-vs-modify scopes, admin role access without equipment scopes, Users Service admin JWT validation, and protected endpoint authorization. |
| `demo.feature` | Documented empty-database equipment flow | Active | Covers catalog creation, container registration, availability, reservation, pickup, return, release, and release rejection after dispatch. |
| `inventory.feature` | Inventory catalog and container APIs | Active | Covers seeded equipment type listing, type create/update and error cases, container register/list/get/status override and error cases, and seeded availability counts. |
| `persistence-runtime.feature` | Persistence and runtime storage behavior | Active | Covers runtime storage default/error behavior, SQLite empty first boot, SQLite restart persistence, API-visible local user/audit metadata persistence, and memory non-persistence. |
| `playground-dev-tools.feature` | Playground development tooling | Active | Covers public playground assets, development reset/clear actions, generated bearer tokens, and non-development 404 behavior. |
| `public-routes.feature` | Public routes | Active | Covers unauthenticated health, OpenAPI, root redirect, and anonymous rejection on protected APIs. |
| `reservations.feature` | Reservations, container lifecycle, and booking events | Active | Covers atomic reservation assignment, insufficient-stock rollback, duplicate booking rejection, pickup/return lifecycle rules, reservation release outcomes, cancellation events, and completion event return/no-op/missing cases. |

## Coverage Structure

| Behavior area | Feature file | Scope |
| --- | --- | --- |
| Audit metadata and local users | `audit-metadata.feature`, `persistence-runtime.feature` | API-visible local caller metadata, stable user id reuse, audit log outcomes, read-route audit silence, and persistence across restart. |
| Inventory and availability | `inventory.feature` | Equipment type and container inventory behavior visible through public APIs. |
| Reservations and lifecycle | `reservations.feature` | Assignment, pickup, return, release, and invalid lifecycle transitions. |
| Booking events | `reservations.feature` | Booking cancellation and completion events that release, return, or leave containers unchanged. |
| Persistence runtime behavior | `persistence-runtime.feature` | User-visible behavior for configured runtime storage: defaults and validation, SQLite first boot, restart durability, API-visible metadata, and memory volatility. |
| Public routes and authorization | `public-routes.feature`, `auth.feature`, `playground-dev-tools.feature` | Authenticated route behavior, Users Service admin protected endpoint access, public route behavior, and playground-facing development routes. |

## Unit-Only Persistence and Migration Coverage

The behavior specs cover storage through externally meaningful runtime outcomes.
The following persistence checks intentionally stay in TypeScript tests because
they are backend implementation details or narrow migration guards:

| Check area | Test file | Reason |
| --- | --- | --- |
| Backend alias normalization and exact runtime config object shapes | `test/persistence.test.ts` | Gherkin covers the default backend and missing durable-backend configuration errors; alias tables and object shape assertions are unit-level parser checks. |
| SQLite/Postgres migration plans, schema versions, DDL columns, and unsupported future schemas | `test/persistence.test.ts` | These protect migration internals and should not be duplicated as behavior scenarios. |
| Relational table row/column storage for users, audit metadata, authorization rules, reservations, and container links | `test/persistence.test.ts` | Gherkin verifies API-visible metadata and restart durability; SQL layout remains a backend contract. |
| Snapshot parsing/backfill compatibility and clone semantics | `test/persistence.test.ts` | These are serialization compatibility checks below the service behavior boundary. |
| Optional Postgres runtime persistence smoke coverage | `test/persistence.test.ts` | Requires `TEST_POSTGRES_URL` and is not part of the always-on multi-feature harness. |

## Explicit Exclusions

These low-level checks stay in TypeScript tests instead of executable Gherkin:

- Unit-level store helper invariants and data structure edge cases.
- Backend-specific migration DDL, migration ordering, and migration CLI status details.
- Backend alias exhaustiveness, exact runtime config object shapes, and boolean parser edge cases.
- Relational storage column checks for local users, audit metadata, authorization rules, and reservation links.
- Serialization details for persistence snapshots that are not visible through service behavior.
- Narrow validation helper branches that do not represent a user-observable workflow.
