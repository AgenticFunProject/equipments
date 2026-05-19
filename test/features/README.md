# Gherkin Black-Box Contract Coverage Map

The executable specs in this directory are the black-box acceptance contract for
the Equipments service. `test/gherkin-demo.test.ts` discovers every
`*.feature` file, parses each `Scenario`, and runs it with fresh scenario state.

A replacement implementation may use a different data layer, schema, migration
system, or internal model if it passes this Gherkin contract: the externally
visible HTTP responses, public assets, authorization outcomes, persistence
effects, and lifecycle behavior must remain equivalent.

## Feature Contract Surface

| Feature file | Contract area | Externally meaningful behavior covered |
| --- | --- | --- |
| `audit-metadata.feature` | Audit metadata and local callers | API-visible creator/modifier metadata on equipment, reservation, and container writes; stable local user reuse; rejection of partial caller metadata headers; read routes leaving the runtime audit log empty. |
| `auth.feature` | Bearer authentication | Read-vs-modify scope enforcement, admin role access without equipment scopes, anonymous protected route rejection, Users Service token rejection without admin/read authorization, JWT audience/issuer/expiry/signature validation, exact admin role matching, scoped non-admin reads, and Users Service admin access across protected REST endpoints. |
| `demo.feature` | Empty-database service flow | The documented empty SQLite database flow from type creation through container registration, availability, reservation, pickup, manual status change, return, release, and release rejection after dispatch. |
| `inventory.feature` | Inventory catalog and container APIs | Seeded equipment type listing, type create/update behavior, type error responses, container register/list/fetch/status override behavior, container error responses, and seeded depot availability counts. |
| `persistence-runtime.feature` | Runtime storage behavior | Memory default configuration, durable backend configuration errors, SQLite first boot from an empty database, SQLite restart durability for service writes, SQLite persistence of API-visible local user and audit metadata, and memory backend non-persistence. |
| `playground-dev-tools.feature` | Playground and development tools | Public playground HTML/CSS/JS assets, displayed runtime backend details, development reset/clear effects, generated bearer tokens, generated admin token authorization, token subject validation, and non-development 404 behavior for dev-only actions. |
| `public-routes.feature` | Public routes | Anonymous `/health`, `/openapi.json`, root redirect to `/playground`, OpenAPI service metadata/security scheme, and anonymous rejection on protected APIs. |
| `reservations.feature` | Reservations, container lifecycle, and booking events | Atomic reservation assignment, insufficient-stock rollback, duplicate booking rejection, pickup/return lifecycle rules, release by booking reference, release/cancel rejection after pickup, cancellation release behavior, completion return behavior, completion no-op for reserved containers, and unknown completion no-op responses. |

## Service Test Coverage Map

`test/service.test.ts` remains a lower-level service regression suite. Its
externally observable scenarios are represented in Gherkin as follows:

| `test/service.test.ts` scenario group | Gherkin contract location |
| --- | --- |
| Health, OpenAPI, root redirect, and anonymous protected-route rejection | `public-routes.feature` |
| Scope checks, admin role checks, Users Service admin JWT validation, exact role matching, and scoped non-admin reads | `auth.feature` |
| Users Service admin authorization across protected equipment, container, availability, reservation, lifecycle, event, and dev-tool endpoints | `auth.feature` |
| Public playground assets, backend details, development reset/clear, generated user/admin tokens, required token subject validation, and non-development dev-tool 404s | `playground-dev-tools.feature` |
| Equipment type list/create/update behavior and type error responses | `inventory.feature` |
| Container register/list/fetch/status override behavior and container error responses | `inventory.feature` |
| Seeded availability counts | `inventory.feature` |
| Reservation assignment, insufficient stock, duplicate bookings, pickup/return rules, release rules, cancellation events, and completion events | `reservations.feature` |
| API-visible audit metadata, stable local users, caller-header validation, and read-route audit silence | `audit-metadata.feature` |
| Runtime storage defaults/errors, SQLite restart durability, persisted API-visible local user/audit metadata, and memory volatility | `persistence-runtime.feature` |
| End-to-end empty-database walkthrough used by the documented demo | `demo.feature` |

## Deliberate Implementation/Data-Layer Exclusions

The Gherkin suite intentionally does not make the following internals part of
the replacement contract. They stay in TypeScript tests because they protect the
current implementation rather than client-visible service behavior:

| Excluded detail | Covered by |
| --- | --- |
| Migration DDL, migration ordering, schema version records, and future-schema guards | `test/persistence.test.ts` |
| SQL row/column layout for local users, audit metadata, authorization rules, reservations, and container links | `test/persistence.test.ts` |
| Snapshot parser, legacy snapshot backfill, and snapshot clone compatibility | `test/persistence.test.ts` |
| Exact runtime config object parser shape | `test/persistence.test.ts` |
| Optional Postgres smoke coverage requiring `TEST_POSTGRES_URL` | `test/persistence.test.ts` |
