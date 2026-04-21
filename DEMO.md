# Equipments Demo

This walkthrough starts from an empty persisted database and creates all data through the API.

## Goal

By the end of the demo you will have:

- created equipment types
- registered container inventory
- verified availability
- created a reservation
- picked up a container
- marked it `IN_TRANSIT`
- returned it to stock
- verified that availability was restored

## Start From Empty State

Use SQLite persistence with an empty first boot so the service starts with no seeded data:

```bash
rm -f .data/demo-equipments.sqlite
STORAGE_BACKEND=sqlite \
STORAGE_SQLITE_PATH=.data/demo-equipments.sqlite \
STORAGE_SQLITE_EMPTY_ON_FIRST_BOOT=true \
npm run dev
```

The service will be available at `http://localhost:3000`.

If the service is already running in development mode and you just want to reset it to empty, you can use:

```bash
curl -X POST http://localhost:3000/dev/clear-all-data
```

## 1. Confirm The Service Is Empty

```bash
curl http://localhost:3000/equipment-types
curl http://localhost:3000/containers
curl "http://localhost:3000/availability?depotCode=CNSHA-01"
```

Expected shape:

```json
{"equipmentTypes":[]}
{"containers":[]}
{"availability":[]}
```

## 2. Create Equipment Types

```bash
curl -X POST http://localhost:3000/equipment-types \
  -H 'content-type: application/json' \
  -d '{
    "code": "20FT",
    "description": "Standard 20-foot dry container",
    "nominalLength": "20'",
    "maxPayloadKg": 28200
  }'

curl -X POST http://localhost:3000/equipment-types \
  -H 'content-type: application/json' \
  -d '{
    "code": "40FT",
    "description": "Standard 40-foot dry container",
    "nominalLength": "40'",
    "maxPayloadKg": 26500
  }'
```

Verify:

```bash
curl http://localhost:3000/equipment-types
```

## 3. Register Containers

Create three units in the same depot:

```bash
curl -X POST http://localhost:3000/containers \
  -H 'content-type: application/json' \
  -d '{
    "containerNumber": "CONU1234567",
    "equipmentType": "20FT",
    "currentDepot": "CNSHA-01"
  }'

curl -X POST http://localhost:3000/containers \
  -H 'content-type: application/json' \
  -d '{
    "containerNumber": "CONU7654321",
    "equipmentType": "20FT",
    "currentDepot": "CNSHA-01"
  }'

curl -X POST http://localhost:3000/containers \
  -H 'content-type: application/json' \
  -d '{
    "containerNumber": "CONU3000001",
    "equipmentType": "40FT",
    "currentDepot": "CNSHA-01"
  }'
```

List inventory:

```bash
curl http://localhost:3000/containers
```

## 4. Check Availability

```bash
curl "http://localhost:3000/availability?depotCode=CNSHA-01"
```

Expected result includes:

```json
{
  "availability": [
    { "equipmentType": "20FT", "availableCount": 2, "depotCode": "CNSHA-01" },
    { "equipmentType": "40FT", "availableCount": 1, "depotCode": "CNSHA-01" }
  ]
}
```

## 5. Reserve A Container

```bash
curl -X POST http://localhost:3000/reservations \
  -H 'content-type: application/json' \
  -d '{
    "bookingReference": "BKG-DEMO-0001",
    "originDepot": "CNSHA-01",
    "equipment": [
      { "type": "20FT", "quantity": 1 }
    ]
  }'
```

Save the returned `containerId` from `assignedContainers[0].containerId`.
This walkthrough refers to it as `<container-id>`.

Check availability again:

```bash
curl "http://localhost:3000/availability?depotCode=CNSHA-01"
```

The `20FT` available count should now be `1`.

## 6. Pick Up The Container

```bash
curl -X POST http://localhost:3000/containers/<container-id>/pickup
```

Expected result:

```json
{
  "id": "<container-id>",
  "status": "DISPATCHED"
}
```

## 7. Mark It In Transit

The current service does not expose a dedicated `DISPATCHED -> IN_TRANSIT` endpoint.
Operations use the manual status override endpoint when they need to reflect vessel departure.

```bash
curl -X PATCH http://localhost:3000/containers/<container-id>/status \
  -H 'content-type: application/json' \
  -d '{
    "status": "IN_TRANSIT"
  }'
```

Verify:

```bash
curl http://localhost:3000/containers/<container-id>
```

## 8. Return The Container

```bash
curl -X POST http://localhost:3000/containers/<container-id>/return
```

The fixed behavior returns the container to `AVAILABLE` stock.

Verify the container:

```bash
curl http://localhost:3000/containers/<container-id>
```

Expected fields now include:

```json
{
  "id": "<container-id>",
  "status": "AVAILABLE",
  "bookingReference": null
}
```

## 9. Verify Availability Was Restored

```bash
curl "http://localhost:3000/availability?depotCode=CNSHA-01"
```

The `20FT` available count should be back to `2`.

## 10. Demonstrate Cancellation Before Dispatch

Create a second reservation:

```bash
curl -X POST http://localhost:3000/reservations \
  -H 'content-type: application/json' \
  -d '{
    "bookingReference": "BKG-DEMO-0002",
    "originDepot": "CNSHA-01",
    "equipment": [
      { "type": "40FT", "quantity": 1 }
    ]
  }'
```

Release it before pickup:

```bash
curl -X DELETE http://localhost:3000/reservations/BKG-DEMO-0002
```

This should succeed and return reservation status `RELEASED`.

## 11. Demonstrate Cancellation After Dispatch Is Rejected

Create and pick up another reservation:

```bash
curl -X POST http://localhost:3000/reservations \
  -H 'content-type: application/json' \
  -d '{
    "bookingReference": "BKG-DEMO-0003",
    "originDepot": "CNSHA-01",
    "equipment": [
      { "type": "20FT", "quantity": 1 }
    ]
  }'
```

Pick it up using the returned `containerId`, then try to release it:

```bash
curl -X POST http://localhost:3000/containers/<another-container-id>/pickup

curl -X DELETE http://localhost:3000/reservations/BKG-DEMO-0003
```

Expected result: HTTP `409` with an error indicating the reservation cannot be released after dispatch.

## Playground Option

You can also run the same flow in the browser playground at:

```text
http://localhost:3000/playground
```

The playground is useful for copying the JSON bodies in this file and pasting returned IDs into later requests.

## Automated Gherkin Coverage

The same walkthrough is also encoded as an executable feature file at `test/features/demo.feature`.
It is exercised automatically by `test/gherkin-demo.test.ts`, so running `npm test` verifies that the documented demo flow still works end to end.
