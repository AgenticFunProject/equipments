Feature: Persistence and runtime storage behavior

  Scenario: Runtime storage defaults to transient memory
    Given no persistence environment is configured
    Then runtime storage uses "memory" with no persistent path

  Scenario: Durable runtime storage rejects missing configuration
    Given runtime storage environment requests "db" without a persistence path
    Then runtime storage configuration fails with "STORAGE_DB_PATH is required"
    When runtime storage environment requests "sqlite" without a persistence path
    Then runtime storage configuration fails with "STORAGE_SQLITE_PATH or STORAGE_DB_PATH is required"
    When runtime storage environment requests "postgres" without a connection string
    Then runtime storage configuration fails with "STORAGE_POSTGRES_URL is required"

  Scenario: SQLite empty first boot persists service state across restart
    Given the equipments service starts from an empty sqlite database
    Then the equipment type catalog is empty
    And the container inventory is empty
    When I create equipment type "45HC" described as "45-foot High Cube" with nominal length "45'" and max payload 29500
    And I register container "MSCU1234567" of type "45HC" at depot "NLRTM-01"
    And I reserve 1 units of "45HC" at depot "NLRTM-01" for booking "BKG-PERSIST-1"
    And I pick up the latest reserved container
    Then the latest container status is "DISPATCHED"
    When I restart the service with the same runtime storage and no seeded data
    Then the equipment type catalog includes "45HC" described as "45-foot High Cube"
    And the container inventory contains 1 entries
    And the latest container status is "DISPATCHED"
    And availability at depot "NLRTM-01" is empty

  Scenario: SQLite persists API-visible local user and audit metadata across restart
    Given the equipments service starts from an empty sqlite database
    When I create equipment type "45OT" described as "45-foot Open Top" with nominal length "45'" and max payload 28000 as caller "ops-agent"
    Then the latest JSON response has persisted local user metadata
    And the runtime audit log contains a successful "equipment_type.create" event for "45OT"
    When I restart the service with the same runtime storage and no seeded data
    Then equipment type "45OT" still has the same local user metadata
    And the runtime audit log contains a successful "equipment_type.create" event for "45OT"

  Scenario: Memory runtime storage does not persist service writes
    Given the equipments service is running with memory persistence and no seeded data
    When I create equipment type "53FT" described as "Domestic 53-foot container" with nominal length "53'" and max payload 30000
    Then the equipment type catalog includes "53FT" described as "Domestic 53-foot container"
    When I restart the service with the same runtime storage and no seeded data
    Then the equipment type catalog is empty
    And the equipment type catalog does not include "53FT"
