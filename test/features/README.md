# Gherkin Feature Coverage Map

The executable behavior specs in this directory are discovered by
`test/gherkin-demo.test.ts`. Each `*.feature` file may contain multiple
scenarios; the runner executes every scenario with fresh service state.

## Current Coverage

| Feature file | Behavior area | Status | Notes |
| --- | --- | --- | --- |
| `auth.feature` | Bearer authentication | Active | Covers anonymous rejection, read-vs-modify scopes, and admin role access without equipment scopes. |
| `demo.feature` | Documented empty-database equipment flow | Active | Covers catalog creation, container registration, availability, reservation, pickup, return, release, and release rejection after dispatch. |
| `playground-dev-tools.feature` | Playground development tooling | Active | Covers public playground assets, development reset/clear actions, generated bearer tokens, and non-development 404 behavior. |
| `public-routes.feature` | Public routes | Active | Covers unauthenticated health, OpenAPI, root redirect, and anonymous rejection on protected APIs. |

## Planned Coverage Structure

| Behavior area | Feature file | Scope |
| --- | --- | --- |
| Inventory and availability | `inventory.feature` | Equipment type and container inventory behavior visible through public APIs. |
| Reservations and lifecycle | `reservations.feature` | Assignment, pickup, return, release, and invalid lifecycle transitions. |
| Persistence runtime behavior | `persistence.feature` | User-visible behavior that must survive configured storage backends. |
| Public routes and authorization | `public-routes.feature`, `auth.feature`, `playground-dev-tools.feature` | Authenticated route behavior, public route behavior, and playground-facing development routes. |

## Explicit Exclusions

These low-level checks stay in TypeScript tests instead of executable Gherkin:

- Unit-level store helper invariants and data structure edge cases.
- Backend-specific migration DDL, migration ordering, and migration CLI status details.
- Serialization details for persistence snapshots that are not visible through service behavior.
- Narrow validation helper branches that do not represent a user-observable workflow.
