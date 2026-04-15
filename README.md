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
AVAILABLE → RESERVED → DISPATCHED → IN_TRANSIT → RETURNED → AVAILABLE
                ↓
            RELEASED  (reservation cancelled before dispatch)
```

| Status | Meaning |
|--------|---------|
| AVAILABLE | In depot, ready to be booked |
| RESERVED | Allocated to a confirmed booking, awaiting pickup |
| DISPATCHED | Picked up by customer at origin |
| IN_TRANSIT | On the vessel |
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
| PATCH | /containers/{id}/status | Manual status override (ops use) |

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

## Business Rules
- Reservations are created atomically — either all requested units are reserved or the request fails
- Released reservations (cancelled bookings) return containers to AVAILABLE immediately
- Container pickup can only be recorded when status is RESERVED
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

- Runtime: Node 20+ with Fastify
- Source: `src/`
- Tests: `test/service.test.ts`

### Project Structure
- `src/index.ts` - server entrypoint
- `src/server.ts` - HTTP routes and error handling
- `src/store.ts` - in-memory domain logic, lifecycle transitions, reservation atomics, event handling
- `src/types.ts` - domain types and enums
- `src/errors.ts` - domain error type mapped to HTTP responses

### Run Locally

```bash
npm install
npm run dev
```

Service starts on `http://0.0.0.0:3000` by default.

Open `http://localhost:3000/playground` for a lightweight browser playground with
preset requests, editable JSON bodies, inline response output for manual API testing,
and a dev-only reset button that restores the seeded baseline state.

The reset action is only exposed when `NODE_ENV` is not `production`:

- `POST /dev/reset-all-data` resets in-memory or persisted runtime data back to the seeded baseline
- the playground shows a `Reset All Data` button only in development mode
- production mode returns `404` for the reset endpoint and hides the control from the playground

### Build and Test

```bash
npm run build
npm test
```

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

### Runtime Storage Backends

The service now supports runtime-selectable persistence entirely in TypeScript.
The same API and domain rules run on top of one of these backends:

- `memory` (default) keeps state in-process only
- `db` persists a JSON snapshot to disk
- `sqlite` persists the same snapshot in a SQLite database
- SQLite aliases: `sqlite3`, `sql`, `persistent-sqlite`, `persistent-sqlite3`

Environment variables:

- `STORAGE_BACKEND` selects the backend mode
- `STORAGE_DB_PATH` is required when `STORAGE_BACKEND=db`
- `STORAGE_SQLITE_PATH` is preferred when `STORAGE_BACKEND=sqlite`
- `STORAGE_DB_PATH` is also accepted as a fallback for `sqlite`

Examples:

```bash
# in-memory (default)
npm run dev

# JSON file persistence
STORAGE_BACKEND=db STORAGE_DB_PATH=.data/equipments.json npm run dev

# SQLite persistence
STORAGE_BACKEND=sqlite STORAGE_SQLITE_PATH=.data/equipments.sqlite npm run dev
```
