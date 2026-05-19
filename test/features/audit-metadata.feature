Feature: Audit metadata and local callers

  Background:
    Given the seeded equipments service is running

  Scenario: Equipment type writes expose caller metadata
    When I create equipment type "46AM" described as "46-foot Audit Metadata" with nominal length "46'" and max payload 28600 as caller "ops-create"
    Then the latest response status is 201
    And the latest equipment type response has created and modified local user metadata for one caller
    When I update equipment type "46AM" description to "46-foot Audit Metadata Updated" as caller "ops-update"
    Then the latest response status is 200
    And the latest JSON response has field "description" equal to "46-foot Audit Metadata Updated"
    And the latest equipment type response preserves creator metadata and records a new modifier

  Scenario: Reservation and container writes reuse stable local user ids
    When I reserve 1 units of "20FT" at depot "CNSHA-01" for booking "BKG-AUDIT-GHERKIN-1" as caller "ops-agent"
    Then the latest response status is 201
    And the latest reservation assigned 1 containers
    And the latest reservation response has local user metadata for one caller
    When I pick up the latest reserved container as caller "ops-agent"
    Then the latest response status is 200
    And the latest JSON response has field "status" equal to "DISPATCHED"
    And the latest container response last modified user matches the reservation local user
    When I fetch the latest container
    Then the latest response status is 200
    And the latest container response has no creator and the same local last modifier

  Scenario: Partial caller metadata headers are rejected
    When I try to create equipment type "46PI" described as "46-foot Partial Issuer" with nominal length "46'" and max payload 28600 with only x-auth-issuer caller metadata
    Then the latest response status is 400
    And the latest error is "authenticated caller metadata requires both x-auth-issuer and x-auth-subject headers"
    When I try to create equipment type "46PS" described as "46-foot Partial Subject" with nominal length "46'" and max payload 28600 with only x-auth-subject caller metadata
    Then the latest response status is 400
    And the latest error is "authenticated caller metadata requires both x-auth-issuer and x-auth-subject headers"

  Scenario: Read routes do not emit audit events
    When I request GET "/equipment-types" with a read bearer token
    Then the latest response status is 200
    And the latest equipment type list includes "20FT"
    And the runtime audit log is empty
    When I request GET "/containers" with a read bearer token
    Then the latest response status is 200
    And the latest container list includes container "CONU1234567"
    And the runtime audit log is empty
    When I request GET "/availability?depotCode=CNSHA-01" with a read bearer token
    Then the latest response status is 200
    And the latest availability response includes 3 units of "20FT" at depot "CNSHA-01"
    And the runtime audit log is empty
