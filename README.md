# Component: Equipments Service

## Purpose
Manages the container equipment catalogue (types and sizes) and the physical inventory of
containers. Handles the full lifecycle of a container from depot availability through
deployment on a shipment to return.

## Responsibilities
- Maintain the catalogue of equipment types (20FT, 40FT, 40FT HC, etc.)
- Track the inventory and current status of each container unit
- Expose an API to reserve ("deploy") containers for a booking
- Record container pickup at origin and return at destination
- Provide availability counts per equipment type to Schedules and Quotes

## Equipment Types (Catalogue)
| Code | Description | Nominal Length | Max Payload (kg) |
|------|-------------|---------------|-----------------|
| 20FT | Standard 20-foot dry container | 20' | 28 200 |
| 40FT | Standard 40-foot dry container | 40' | 26 500 |
| 40HC | 40-foot High Cube | 40' | 26 460 |
| 20RF | 20-foot Reefer | 20' | 27 400 |
| 40RF | 40-foot Reefer High Cube | 40' | 26 380 |

The catalogue is employee-manageable so new types can be added without code changes.

## Container Unit Lifecycle

```
AVAILABLE → RESERVED → DISPATCHED ──┬──→ RETURNED → AVAILABLE
                ↓                   │
            RELEASED                └──→ IN_TRANSIT → RETURNED → AVAILABLE
      (reservation cancelled            (set today via manual status override)
       before dispatch)
```

| Status | Meaning |
|--------|---------|
| AVAILABLE | In depot, ready to be booked |
| RESERVED | Allocated to a confirmed booking, awaiting pickup |
| DISPATCHED | Picked up by customer at origin; this is the last status reached by the standard pickup flow |
| IN_TRANSIT | On the vessel; today this is reached through the manual status override endpoint rather than a dedicated public transition |
| RETURNED | Delivered and back at destination depot |
| RELEASED | Reservation cancelled; returns to AVAILABLE |

## API Endpoints

### Equipment Type (Catalogue) — Employee
| Method | Path | Description |
|--------|------|-------------|
| GET | /equipment-types | List all equipment types |
| POST | /equipment-types | Add a new equipment type |
| PUT | /equipment-types/{code} | Update an equipment type |

### Container Units — Employee
| Method | Path | Description |
|--------|------|-------------|
| POST | /containers | Register a new container unit |
| GET | /containers | List containers (filterable by type/status/depot) |
| GET | /containers/{id} | Get a specific container |
| PATCH | /containers/{id}/status | Manual status override (ops use); currently the supported way to mark a dispatched container as `IN_TRANSIT` |

### Inventory / Availability — Public/Service
| Method | Path | Description |
|--------|------|-------------|
| GET | /availability | Get available counts by equipment type |
| POST | /reservations | Reserve containers for a booking |
| DELETE | /reservations/{bookingReference} | Release reservation (booking cancelled) |
| POST | /containers/{id}/pickup | Record container pickup at origin |
| POST | /containers/{id}/return | Record container return at destination |

### GET /availability — Response
```json
{
  "availability": [
    { "equipmentType": "20FT", "availableCount": 45, "depotCode": "CNSHA-01" },
    { "equipmentType": "40FT", "availableCount": 18, "depotCode": "CNSHA-01" },
    { "equipmentType": "40HC", "availableCount": 12, "depotCode": "CNSHA-01" }
  ]
}
```

### POST /reservations — Request Body
```json
{
  "bookingReference": "BKG-2026-00042",
  "originDepot": "CNSHA-01",
  "equipment": [
    { "type": "20FT", "quantity": 2 }
  ]
}
```

### POST /reservations — Response
```json
{
  "reservationId": "RES-uuid",
  "bookingReference": "BKG-2026-00042",
  "assignedContainers": [
    { "containerId": "CONU1234567", "type": "20FT" },
    { "containerId": "CONU7654321", "type": "20FT" }
  ],
  "status": "RESERVED"
}
```

## Data Models

### Container Unit
| Field | Type | Notes |
|-------|------|-------|
| id | UUID | Internal primary key |
| containerNumber | string | ISO 6346 number (e.g. CONU1234567) |
| equipmentType | string | FK to equipment type code |
| status | enum | See lifecycle above |
| currentDepot | string | Depot code where container is located |
| bookingReference | string | Set when RESERVED or later; null when AVAILABLE |
| lastMovedAt | timestamp | |
| createdAt | timestamp | |

### Reservation
| Field | Type | Notes |
|-------|------|-------|
| id | UUID | |
| bookingReference | string | |
| containers | JSON array | List of assigned container IDs |
| status | enum | ACTIVE, RELEASED |
| createdAt | timestamp | |

### Local User
| Field | Type | Notes |
|-------|------|-------|
| id | UUID-like string | Stable local user identifier for future record metadata |
| issuer | string | Token issuer or identity namespace |
| subject | string | External caller subject within the issuer |
| createdAt | timestamp | When the local mapping was created |

## Business Rules
- Reservations are created atomically — either all requested units are reserved or the request fails
- Released reservations (cancelled bookings) return containers to AVAILABLE immediately
- Container pickup can only be recorded when status is RESERVED
- There is no dedicated API transition from DISPATCHED to IN_TRANSIT; operations use `PATCH /containers/{id}/status` when they need to reflect vessel departure
- Container return can only be recorded when status is IN_TRANSIT or DISPATCHED

## Events Consumed
| Event | Action |
|-------|--------|
| `booking.cancelled` | Automatically release the reservation for that booking |
| `booking.completed` | Trigger return flow if not already done |

## Out of Scope (v1)
- Depot-to-depot repositioning logic
- Maintenance / repair tracking
- Reefer temperature monitoring
- ISO 6346 check-digit validation

## Implementation (TypeScript + Node)

This repository now includes a runnable TypeScript/Node implementation of the service:

- Runtime: Node 22.5+ with Fastify
- Source: `src/`
- Tests: `test/service.test.ts`

### Project Structure
- `src/index.ts` - server entrypoint
- `src/server.ts` - HTTP routes and error handling
- `src/store.ts` - in-memory domain logic, lifecycle transitions, reservation atomics, event handling
- `src/types.ts` - domain types and enums
- `src/errors.ts` - domain error type mapped to HTTP responses

### Run Locally

Install dependencies first:

```bash
npm install
```

Use Node 22.5 or newer for local development and production builds because the
service imports the built-in `node:sqlite` module.

Default local development uses the in-memory backend, which needs no migration step:

```bash
npm run dev
```

Service starts on `http://0.0.0.0:3000` by default.

`GET /health` remains unauthenticated. All other routes require `Authorization: Bearer <token>`.

Machine-readable API documentation is exposed at `GET /openapi.json`. The browser playground also links to that document directly.

Bearer token configuration is driven by these environment variables:

- `AUTH_JWT_ISSUER` defaults to `platform-auth`
- `AUTH_JWT_AUDIENCE` defaults to `equipments-service`
- `AUTH_JWT_SECRET` defaults to `equipments-dev-secret`

### Local Users Service Admin JWT Flow

For local development, Users Service `POST /auth/token` is the source of admin bearer tokens for callers that exercise Equipments protected endpoints. Equipments does not call Users Service to introspect tokens; it validates the JWT locally, so both services must be configured with the same JWT values:

- `AUTH_JWT_ISSUER` must match the token `iss`
- `AUTH_JWT_AUDIENCE` must match the token `aud`; array audiences are accepted when one entry matches
- `AUTH_JWT_SECRET` must be the same HS256 signing secret used by Users Service

The expected Users Service admin token shape is:

```json
{
  "header": {
    "alg": "HS256",
    "typ": "JWT"
  },
  "payload": {
    "sub": "<stable users.id>",
    "iss": "<AUTH_JWT_ISSUER>",
    "aud": "<AUTH_JWT_AUDIENCE>",
    "exp": 1770000000,
    "scope": "equipments:read equipments:modify",
    "role": "admin"
  }
}
```

`sub` must be the stable Users Service `users.id` value because Equipments records authenticated write metadata against the `(iss, sub)` identity. `role` must be exactly `admin` to authorize both read and write routes without relying on Equipments-specific scopes. Non-admin tokens still need `equipments:read` for read routes and `equipments:modify` for write routes.

For local validation, start both services with matching JWT configuration:

```bash
export AUTH_JWT_ISSUER=platform-auth
export AUTH_JWT_AUDIENCE=equipments-service
export AUTH_JWT_SECRET=equipments-dev-secret
```

When Users Service is running locally, get an admin bearer token from `POST /auth/token` using that service's configured local admin credential or fixture. The JSON body below represents that local fixture payload; the response token must have the claim shape above:

```bash
USERS_SERVICE_URL=http://localhost:3001

TOKEN=$(curl -fsS -X POST "$USERS_SERVICE_URL/auth/token" \
  -H "Content-Type: application/json" \
  -d '{"role":"admin"}' \
  | node -pe 'JSON.parse(require("fs").readFileSync(0, "utf8").toString()).token')
```

If Users Service is not running, you can construct a Users Service-shaped admin token with Node as long as the same `AUTH_JWT_*` values are used by Equipments:

```bash
TOKEN=$(node --input-type=module <<'EOF'
import { createHmac } from "node:crypto";

const secret = process.env.AUTH_JWT_SECRET || "equipments-dev-secret";
const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
const payload = Buffer.from(
  JSON.stringify({
    sub: process.env.USERS_ADMIN_ID || "local-users-admin-id",
    iss: process.env.AUTH_JWT_ISSUER || "platform-auth",
    aud: process.env.AUTH_JWT_AUDIENCE || "equipments-service",
    exp: Math.floor(Date.now() / 1000) + 3600,
    scope: "equipments:read equipments:modify",
    role: "admin"
  })
).toString("base64url");
const signature = createHmac("sha256", secret).update(`${header}.${payload}`).digest("base64url");
process.stdout.write(`${header}.${payload}.${signature}`);
EOF
)
```

Then call at least one local read endpoint and one write endpoint with the same bearer token:

```bash
EQUIPMENTS_URL=http://localhost:3000

curl -fsS "$EQUIPMENTS_URL/equipment-types" \
  -H "Authorization: Bearer $TOKEN"

VALIDATION_CODE="VAL$(date +%s)"
curl -fsS -X POST "$EQUIPMENTS_URL/equipment-types" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"code\":\"$VALIDATION_CODE\",\"description\":\"Local validation dry container\",\"nominalLength\":\"local\",\"maxPayloadKg\":1}"
```

### Playground Authorization and Admin Rights

The browser playground stays publicly reachable so developers can inspect the API and paste a bearer token before sending protected requests. The service treats `GET /`, `GET /health`, `GET /openapi.json`, `GET /playground`, and `GET /playground/*` as public routes. `POST /dev/generate-token` is also public at the auth layer, but returns `404` outside development mode. Playground request presets mark `GET /health` as public; all other service presets are protected and need a bearer token before the request will authorize.

Protected playground requests use the bearer token field exactly like any other API client:

- read-only `GET` and `HEAD` service routes require the `equipments:read` scope
- state-changing `POST`, `PUT`, `PATCH`, and `DELETE` service routes require the `equipments:modify` scope
- tokens can carry both scopes for full scoped access
- tokens with `role` set exactly to `admin` authorize every protected route without requiring Equipments-specific scopes

Admin rights are represented only by the JWT `role: "admin"` claim. There is no separate Equipments admin-rights store or playground session state. The token still must pass the normal bearer-token checks: HS256 signature, matching issuer, matching audience, future expiry, and non-empty subject. Use a stable Users Service `users.id` as `sub` when the token represents a real admin.

In local development (`NODE_ENV` not set to `production`), the playground shows a token generator. To test admin routes manually, select `role=admin` in the Token rights control, enter the subject to use for audit metadata, choose an expiry, and click `Generate Token`. The playground calls `POST /dev/generate-token`, which is public but available only in development mode, signs the token with the running service's `AUTH_JWT_*` configuration, and copies it into the bearer token field. Selecting `equipments:read`, `equipments:modify`, or `equipments:read + equipments:modify` generates scoped non-admin tokens instead.

Production deployments do not expose local token generation. In production mode the playground keeps the bearer token field and scope guide, but the generator is replaced with copy that tells the developer to paste an externally issued token, and `POST /dev/generate-token` returns `404`. For production admin testing, obtain the bearer token from Users Service `POST /auth/token` or the production identity provider so the token contains either `role: "admin"` or the specific `equipments:*` scopes required by the route.

The dev-only data actions are only exposed when `NODE_ENV` is not `production`:

- `POST /dev/reset-all-data` resets in-memory or persisted runtime data back to the seeded baseline
- `POST /dev/clear-all-data` removes runtime data without reseeding so the service stays empty until restart or manual re-creation
- the playground shows `Reset All Data` and `Clear All Data` buttons only in development mode; those controls require a bearer token with `equipments:modify` or `role: "admin"`
- production mode returns `404` for both endpoints and hides the controls from the playground

### Build and Test

```bash
npm ci
npm run build
npm run test:non-gherkin
npm run test:gherkin
npm test
```

The playground has a browser-visible Playwright smoke test that starts the
compiled service, opens `/playground`, clicks the dev token generator, and sends
a protected request through the visible controls:

```bash
npm run test:ui:install
npm run test:ui
npm run test:ui:headed
npm run test:ui:slow
```

Run `npm run test:ui:install` once on fresh local checkouts, after `npm ci`, and
again when the Playwright version changes. It installs the Chromium browser and,
on supported Linux distributions, the host libraries Chromium needs before
`npm run test:ui` or `npm run test:ui:headed` can launch a browser. Those test
commands intentionally do not reinstall Chromium on every run; CI runs the same
install script as a separate step before the browser tests.

`npm run test:ui:headed` opens a real browser so the token generation and
protected request clicks can be watched locally. `npm run test:ui:slow` uses the
same headed browser run with a one-second delay between Playwright actions, which
makes the clicks easier to follow. Local UI test runs keep traces, screenshots,
and videos under `test-results/` when a test fails, and write the HTML report to
`playwright-report/`. GitHub Actions records Playwright traces and videos for
successful UI runs too, then uploads a `playwright-artifacts` artifact with
`playwright-report/` and `test-results/`; download it from the workflow run to
find `test-results/**/trace.zip` and video `.webm` files. On `main` and `master`
pushes, CI also publishes the Playwright HTML report to GitHub Pages and adds an
`Open the browser UI test report` link to the workflow summary. The Pages link is
the latest published report, while the downloadable artifact remains the per-run
fallback for trace and video files. If your Linux user cannot run the dependency
installer because system package installation requires elevated privileges, ask
an administrator to run `npm run test:ui:install` or install the Playwright
Chromium host dependencies first. Open a downloaded or local trace with:

```bash
npx playwright show-trace path/to/trace.zip
```

Open the HTML report with:

```bash
npm run test:ui:report
```

For a full API walkthrough that starts from an empty database and creates all demo data through the service, see `DEMO.md`.
For Azure Container Apps production deployment guidance with PostgreSQL, see `azure/README.md`.

### Migration Workflow

The repo exposes explicit migration commands for relational backends:

```bash
npm run migrate
npm run migrate:status
```

Those commands target the compiled `dist/` output so the same entrypoints work inside the production runtime image and after a local `npm run build`.
For source-based local development without a build step, use:

```bash
npm run migrate:dev
npm run migrate:status:dev
```

Run the migration command with the same backend environment variables you plan to use at startup.

Startup and migration expectations by backend:

- `memory`: no persistence, no migration step
- `db`: JSON snapshot persistence, no migration step
- `sqlite`: use `STORAGE_SQLITE_PATH` (or the fallback `STORAGE_DB_PATH`), then run `npm run migrate:dev` for local source-based setup or `npm run migrate` after a build when you want the production-compatible entrypoint
- `postgres`: use `STORAGE_POSTGRES_URL`, run `npm run migrate:dev` for local source-based setup or `npm run migrate` after a build, then start the service against the migrated database

Examples:

```bash
# inspect pending SQLite migrations from source during local development
STORAGE_BACKEND=sqlite STORAGE_SQLITE_PATH=.data/equipments.sqlite npm run migrate:status:dev

# apply SQLite migrations explicitly from source, then start the service
STORAGE_BACKEND=sqlite STORAGE_SQLITE_PATH=.data/equipments.sqlite npm run migrate:dev
STORAGE_BACKEND=sqlite STORAGE_SQLITE_PATH=.data/equipments.sqlite npm run dev

# apply PostgreSQL migrations from source, then start the service
STORAGE_BACKEND=postgres \
STORAGE_POSTGRES_URL=postgres://equipments:equipments@localhost:5432/equipments \
npm run migrate:dev
STORAGE_BACKEND=postgres \
STORAGE_POSTGRES_URL=postgres://equipments:equipments@localhost:5432/equipments \
npm run dev

# apply migrations through the compiled production-compatible entrypoint
STORAGE_BACKEND=sqlite STORAGE_SQLITE_PATH=.data/equipments.sqlite npm run build
STORAGE_BACKEND=sqlite STORAGE_SQLITE_PATH=.data/equipments.sqlite npm run migrate
```

Backend-specific notes:

- SQLite startup still applies missing schema migrations when the service opens the database file, so `npm run migrate:dev` is mainly for an explicit pre-start workflow and `npm run migrate` is the production-compatible equivalent after a build
- `STORAGE_SQLITE_EMPTY_ON_FIRST_BOOT=true` only affects whether the seeded baseline data is inserted after a new SQLite database is created; it does not skip schema creation
- PostgreSQL startup validates the migrated schema before the HTTP server begins listening

Production deployments on Azure Container Apps should run `npm run migrate` as a separate pre-deploy job before updating the app revision; that command now executes compiled `dist/` output, matching the production image layout. See `azure/README.md` for the runbook and YAML scaffolding.

### Workflow Policy

- Every repo change must have a beads ticket before implementation starts.
- Completed features must bump the service version in `package.json` before merge.
- Every service version bump must also update `VERSIONS.md` with the user-visible changes in that version.
- The healthcheck version returned by `GET /health` is expected to reflect that feature-ready version bump.
- GitHub board mirroring for beads is documented in `github-board-sync.md` and audited/applied with `npm run sync:github-board`.

### Implemented Endpoints

- `GET /health`
- `GET /` (redirects to `/playground`)
- `GET /playground`
- `GET /equipment-types`
- `POST /equipment-types`
- `PUT /equipment-types/{code}`
- `POST /containers`
- `GET /containers`
- `GET /containers/{id}`
- `PATCH /containers/{id}/status`
- `GET /availability`
- `POST /reservations`
- `DELETE /reservations/{bookingReference}`
- `POST /containers/{id}/pickup`
- `POST /containers/{id}/return`
- `POST /events` (consumes `booking.cancelled` and `booking.completed`)

### Dev-Only Utilities

- `POST /dev/reset-all-data` - clears service state and restores the seeded baseline for local testing
- `POST /dev/clear-all-data` - clears service state and leaves the service empty for local testing

### Bearer Auth Scopes

- `equipments:read` is required for `GET` and `HEAD` routes other than `/health`
- `equipments:modify` is required for write routes such as `POST`, `PUT`, `PATCH`, and `DELETE`
- callers can carry both scopes in a single token for full API access

The current Fastify route authorization matrix is persisted as authorization-rule metadata in snapshots and relational stores. Each rule records the method, path pattern, controller/action, resource type, required scope, public-route flag, and whether admin role tokens are accepted.

### Runtime Storage Backends

The service now supports runtime-selectable persistence entirely in TypeScript.
The same API and domain rules run on top of one of these backends:

- `memory` (default) keeps state in-process only
- `db` persists a JSON snapshot to disk
- `sqlite` persists store state in relational SQLite tables on disk
- `postgres` persists store state in relational PostgreSQL tables
- SQLite aliases: `sqlite3`, `sql`, `persistent-sqlite`, `persistent-sqlite3`

Environment variables:

- `STORAGE_BACKEND` selects the backend mode
- `STORAGE_DB_PATH` is required when `STORAGE_BACKEND=db`
- `STORAGE_SQLITE_PATH` is preferred when `STORAGE_BACKEND=sqlite`
- `STORAGE_DB_PATH` is also accepted as a fallback for `sqlite`
- `STORAGE_POSTGRES_URL` is required when `STORAGE_BACKEND=postgres`
- `STORAGE_SQLITE_EMPTY_ON_FIRST_BOOT=true` skips seeded baseline data when a SQLite database is created for the first time

Examples:

```bash
# in-memory (default)
npm run dev

# JSON file persistence
STORAGE_BACKEND=db STORAGE_DB_PATH=.data/equipments.json npm run dev

# SQLite persistence with an explicit migration step from source
STORAGE_BACKEND=sqlite STORAGE_SQLITE_PATH=.data/equipments.sqlite npm run migrate:dev
STORAGE_BACKEND=sqlite STORAGE_SQLITE_PATH=.data/equipments.sqlite npm run dev

# SQLite persistence without seeded baseline data on first boot
STORAGE_BACKEND=sqlite STORAGE_SQLITE_PATH=.data/equipments.sqlite STORAGE_SQLITE_EMPTY_ON_FIRST_BOOT=true npm run migrate:dev
STORAGE_BACKEND=sqlite STORAGE_SQLITE_PATH=.data/equipments.sqlite STORAGE_SQLITE_EMPTY_ON_FIRST_BOOT=true npm run dev

# PostgreSQL persistence
STORAGE_BACKEND=postgres STORAGE_POSTGRES_URL=postgres://equipments:equipments@localhost:5432/equipments npm run migrate:dev
STORAGE_BACKEND=postgres STORAGE_POSTGRES_URL=postgres://equipments:equipments@localhost:5432/equipments npm run dev
```

### PostgreSQL Verification

- Apply the schema before startup in local source-based workflows: `STORAGE_BACKEND=postgres STORAGE_POSTGRES_URL=postgres://equipments:equipments@localhost:5432/equipments npm run migrate:dev`
- Apply the schema before startup with the compiled production-compatible entrypoint: `STORAGE_BACKEND=postgres STORAGE_POSTGRES_URL=postgres://equipments:equipments@localhost:5432/equipments npm run build && STORAGE_BACKEND=postgres STORAGE_POSTGRES_URL=postgres://equipments:equipments@localhost:5432/equipments npm run migrate`
- Start the service against PostgreSQL: `STORAGE_BACKEND=postgres STORAGE_POSTGRES_URL=postgres://equipments:equipments@localhost:5432/equipments npm run dev`
- Run the automated PostgreSQL persistence test when a local PostgreSQL server is available: `TEST_POSTGRES_URL=postgres://equipments:equipments@localhost:5432/postgres npm test`
