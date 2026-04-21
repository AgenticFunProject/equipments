# New Features

This document captures proposed vNext features for the Equipments service.
The goal is to make the service feel more useful inside a larger ecosystem while still keeping the first step practical.

## Priority Order

1. User-based API calls with tokens
2. Smart substitution suggestions
3. Equipment availability forecast
4. Customer priority and allocation rules

## 1. User-Based API Calls With Tokens

This is the highest-priority feature.

The Equipments service is part of a larger ecosystem, so the first authorization model should be token-based instead of a local username/password system.

### Proposed Approach

- Require `Authorization: Bearer <token>` on service endpoints
- Validate token issuer, audience, expiry, and scopes
- Keep the service stateless
- Avoid introducing a local user database in the first version

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
- optional `depot_codes`: list of depots the caller may operate on
- optional `customer_id`: customer identity for customer-facing calls

### Example Token Payload

```json
{
  "sub": "booking-service",
  "iss": "platform-auth",
  "aud": "equipments-service",
  "scope": "availability:read reservations:create",
  "exp": 1770000000
}
```

### Suggested Scopes

- `availability:read`
- `equipment-types:read`
- `equipment-types:write`
- `containers:read`
- `containers:write`
- `containers:override-status`
- `reservations:create`
- `reservations:release`
- `forecast:read`
- `allocation:read`
- `allocation:manage`
- `substitutions:read`
- `substitutions:manage`

### Example Rules

- `GET /availability` requires `availability:read`
- `POST /reservations` requires `reservations:create`
- `DELETE /reservations/{bookingReference}` requires `reservations:release`
- `PATCH /containers/{id}/status` requires `containers:override-status`
- depot-specific operations should respect `depot_codes` when present

### Future Expansion

This can later grow into:

- full role-based access control
- user-specific audit logs
- customer-specific booking policies

## 2. Smart Substitution Suggestions

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

## 3. Equipment Availability Forecast

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

## 4. Customer Priority And Allocation Rules

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

## Recommended Rollout

To keep scope controlled, implement these in stages.

### Stage 1

- token-based API authorization
- scopes per endpoint
- optional depot restrictions

### Stage 2

- substitution table
- alternative suggestions in reservation failures

### Stage 3

- forecast endpoint

### Stage 4

- allocation policies based on customer or booking priority

## Summary

These four features work well together:

- token-based authorization makes the service ecosystem-ready
- substitutions improve booking recovery
- forecasting improves planning
- allocation rules improve strategic inventory management

The most important first move is token-based user/service authorization, because it provides the foundation for the rest.
