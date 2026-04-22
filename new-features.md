# New Features

This document captures proposed vNext features for the Equipments service.
The goal is to make the service feel more useful inside a larger ecosystem while still keeping the first step practical.

## Priority Order

1. User-based API calls with tokens
2. Audit logging for authenticated actions
3. Smart substitution suggestions
4. Equipment availability forecast
5. Customer priority and allocation rules
6. Record ownership metadata
7. Users table

## 1. User-Based API Calls With Tokens

This is the highest-priority feature.

The Equipments service is part of a larger ecosystem, so the first authorization model should be token-based instead of a local username/password system.

### Proposed Approach

- Require `Authorization: Bearer <token>` on service endpoints
- Validate token issuer, audience, expiry, and scopes
- Keep the service stateless
- Avoid introducing a local user database in the first version
- Start with only two coarse service scopes: `equipments:read` and `equipments:modify`

### Why This Is A Good First Step

- fits naturally into a platform ecosystem
- avoids building a full identity system inside this service
- allows caller-specific authorization without too much complexity
- creates a clean base for future audit and policy features

### Suggested Token Claims

- `sub`: caller identity
- `iss`: issuing auth service
- `aud`: `equipments-service`
- `exp`: expiry timestamp
- `scope`: allowed actions
- optional `customer_id`: customer identity for customer-facing calls

### Example Token Payload

```json
{
  "sub": "booking-service",
  "iss": "platform-auth",
  "aud": "equipments-service",
  "scope": "equipments:read equipments:modify",
  "exp": 1770000000
}
```

### Suggested Scopes

- `equipments:read`
- `equipments:modify`

### Suggested Scope Mapping

`equipments:read` should cover read-only routes such as:

- `GET /availability`
- `GET /equipment-types`
- `GET /containers`
- `GET /containers/{id}`
- future forecast and read-only planning endpoints

`equipments:modify` should cover write routes such as:

- `POST /equipment-types`
- `PUT /equipment-types/{code}`
- `POST /containers`
- `PATCH /containers/{id}/status`
- `POST /reservations`
- `DELETE /reservations/{bookingReference}`
- `POST /containers/{id}/pickup`
- `POST /containers/{id}/return`
- `POST /events`

### Example Rules

- `GET /health` should remain unauthenticated
- read-only routes require `equipments:read`
- write routes require `equipments:modify`
- callers may carry both scopes when they need full access

### Future Expansion

This can later grow into:

- finer-grained endpoint scopes
- depot-scoped restrictions
- full role-based access control
- user-specific audit logs
- customer-specific booking policies

## 2. Audit Logging For Authenticated Actions

Once API calls carry caller identity, the service should record audit events for sensitive operations.

### Proposed Approach

- record audit events for authenticated write operations
- capture actor identity from bearer token claims such as `sub`
- store enough context to explain who changed what and when
- keep read-only traffic out of the first version unless explicitly needed

### Suggested Audit Fields

- `actor`: caller identity from the token
- `action`: operation performed
- `resourceType`: what kind of object changed
- `resourceId`: which object changed
- `timestamp`: when the action happened
- `requestContext`: selected request details such as depot, booking reference, or equipment type
- `outcome`: success or failure

### Suggested First Audit Scope

- equipment type create and update
- container registration
- container status override
- reservation creation
- reservation release
- future substitution and allocation policy updates

### Why This Helps

- gives clients traceability for operational changes
- makes token-based identity more useful
- prepares the service for stronger governance later

## 3. Smart Substitution Suggestions

When the requested equipment type is unavailable, the service should suggest allowed substitutes instead of only returning a hard failure.

### Proposed Approach

- Keep substitutions in an explicit substitution table
- Do not hardcode compatibility rules in application logic
- Return suggestions in priority order
- Include availability counts and reasons in the response

### Suggested Substitution Table Fields

- `requestedType`
- `substituteType`
- `priority`
- `reason`
- `isActive`

### Example Table

| requestedType | substituteType | priority | reason | isActive |
|---|---|---:|---|---|
| 40FT | 40HC | 1 | Higher cube unit accepted for standard 40-foot demand | true |
| 20FT | 20RF | 2 | Reefer allowed only for special cases | false |

### Example Response Shape

```json
{
  "error": "insufficient available 40FT at depot CNSHA-01",
  "alternatives": [
    {
      "requestedType": "40FT",
      "suggestedType": "40HC",
      "availableCount": 3,
      "priority": 1,
      "reason": "allowed by substitution policy"
    }
  ]
}
```

### Why This Helps

- reduces failed bookings
- helps booking recovery
- makes the service feel more operationally smart

## 4. Equipment Availability Forecast

The service should expose projected availability by depot and date, not only current stock.

### Proposed Endpoint

`GET /availability/forecast?depotCode=CNSHA-01&date=2026-05-01`

### Forecast Inputs

- current available stock
- active reservations
- expected returns
- known depot transfers or repositioning events
- allocation restrictions if enabled

### Example Response

```json
{
  "depotCode": "CNSHA-01",
  "date": "2026-05-01",
  "forecast": [
    {
      "equipmentType": "20FT",
      "currentAvailable": 12,
      "projectedAvailable": 18
    },
    {
      "equipmentType": "40FT",
      "currentAvailable": 4,
      "projectedAvailable": 6
    }
  ]
}
```

### Why This Helps

- supports planning and quoting
- helps clients decide where and when to book
- moves the service from inventory lookup toward operational planning

## 5. Customer Priority And Allocation Rules

The service should support strategic allocation of scarce equipment based on customer tier or booking priority.

### Proposed Approach

- apply explicit allocation policies during reservation decisions
- allow premium or urgent bookings to access protected stock
- optionally expose allocatable availability based on caller context

### Example Policy Inputs

- `customerTier`
- `bookingPriority`
- `depotCode`
- `equipmentType`
- protected stock amount or percentage

### Example Request Extension

```json
{
  "bookingReference": "BKG-2026-00042",
  "originDepot": "CNSHA-01",
  "customerTier": "PREMIUM",
  "bookingPriority": "URGENT",
  "equipment": [
    { "type": "20FT", "quantity": 2 }
  ]
}
```

### Example Availability Shape

```json
{
  "availability": [
    {
      "equipmentType": "20FT",
      "depotCode": "CNSHA-01",
      "generalAvailable": 10,
      "protectedAvailable": 4,
      "allocatableAvailable": 14
    }
  ]
}
```

### Why This Helps

- supports premium service levels
- helps manage scarce inventory strategically
- fits well with token-based caller identity and scopes

## 6. Record Ownership Metadata

All persisted business records should carry consistent created-by and last-modified-by metadata, along with creation and update timestamps.

### Proposed Approach

- add `createdByUserId`, `lastModifiedByUserId`, `createdAt`, and `updatedAt` to every persisted table
- populate these values from the authenticated caller identity where possible
- update `lastModifiedByUserId` and `updatedAt` on every successful write
- preserve `createdByUserId` and `createdAt` once the row is created

### Suggested First Table Scope

- `equipment_types`
- `containers`
- `reservations`
- `audit_events`
- future policy/configuration tables such as substitutions or allocation policies

### Suggested Semantics

- `createdByUserId`: the user or service identity responsible for initial creation
- `lastModifiedByUserId`: the user or service identity responsible for the most recent successful write
- `createdAt`: immutable creation timestamp
- `updatedAt`: latest successful modification timestamp

### Why This Helps

- makes record ownership visible without querying audit history
- improves support and operational debugging
- creates a clean base for admin tooling and future UI screens
- complements audit logs with durable row-level metadata

### Notes

For service-to-service calls, the value may initially come from token `sub` until a richer user synchronization model is in place.

## 7. Users Table

The service should maintain a local users table so persisted records can reference stable user identifiers instead of only raw token strings.

### Proposed Approach

- add a `users` table to the local persistence model
- use stable user ids in business records and metadata columns
- keep the first step limited to the schema and local persistence support
- defer synchronization and ingestion logic to a later phase

### Suggested Initial Fields

- `id`
- `externalIdentity`
- `displayName`
- `email`
- `status`
- `createdAt`
- `updatedAt`

### Current Scope Boundary

- tokens still authenticate requests directly
- the table exists so later work has a stable persistence target
- mapping token identities into the users table is out of scope for this first step
- synchronization from APIs or events is also out of scope for now

### Why This Helps

- gives stable foreign-key style references for `createdByUserId` and `lastModifiedByUserId`
- separates authentication from user profile data
- prepares the service for richer admin, reporting, and audit experiences

### Notes

This should stay reference-data-focused at first. It does not need to become a local login system.

## Recommended Rollout

To keep scope controlled, implement these in stages.

### Stage 1

- token-based API authorization
- coarse `equipments:read` and `equipments:modify` scopes

### Stage 2

- audit logging for authenticated write actions

### Stage 3

- substitution table
- alternative suggestions in reservation failures

### Stage 4

- forecast endpoint

### Stage 5

- allocation policies based on customer or booking priority

### Stage 6

- created-by and last-modified metadata on persisted records

### Stage 7

- users table schema and persistence support

## Summary

These seven features work well together:

- token-based authorization makes the service ecosystem-ready
- audit logs make caller actions traceable
- substitutions improve booking recovery
- forecasting improves planning
- allocation rules improve strategic inventory management
- row-level ownership metadata makes business records self-describing
- a users table creates stable identity references for future integrations

The most important first move is token-based user/service authorization with only `equipments:read` and `equipments:modify`, because that gives the ecosystem a simple integration surface and provides the foundation for the rest. Audit logging is the next most natural step once caller identity is available.
