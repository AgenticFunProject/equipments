Feature: Bearer authentication

  Background:
    Given the seeded equipments service is running

  Scenario: Read and write scopes control protected route access
    When I request GET "/equipment-types" with a read bearer token
    Then the latest response status is 200
    When I try to register container "READ1111111" of type "20FT" at depot "CNSHA-01" with a read bearer token
    Then the latest response status is 403
    And the latest error is "missing required scope equipments:modify"

  Scenario: Admin role authorizes protected routes without equipment scopes
    When I request GET "/equipment-types" with an admin bearer token without equipment scopes
    Then the latest response status is 200
    When I register container "ADMG1111111" of type "20FT" at depot "CNSHA-01" with an admin bearer token without equipment scopes
    Then the latest response status is 201

  Scenario: Protected API routes require a bearer token
    When I request GET "/equipment-types" without a bearer token
    Then the latest response status is 401
    And the latest error is "missing bearer token"

  Scenario: Users Service tokens without admin role or read scope are rejected
    When I request GET "/equipment-types" with a Users Service admin bearer token without required scope
    Then the latest response status is 403
    And the latest error is "missing required scope equipments:read"

  Scenario: Users Service admin role does not bypass JWT validation
    When I request GET "/equipment-types" with a Users Service admin bearer token for audience "wrong-audience"
    Then the latest response status is 401
    And the latest error is "bearer token audience is invalid"
    When I request GET "/equipment-types" with a Users Service admin bearer token from issuer "users-service"
    Then the latest response status is 401
    And the latest error is "bearer token issuer is invalid"
    When I request GET "/equipment-types" with an expired Users Service admin bearer token
    Then the latest response status is 401
    And the latest error is "bearer token is expired"
    When I request GET "/equipment-types" with a Users Service admin bearer token that has an invalid signature
    Then the latest response status is 401
    And the latest error is "invalid bearer token signature"

  Scenario: Admin role matching is exact
    When I request GET "/equipment-types" with a bearer token role "Admin" and no equipment scopes
    Then the latest response status is 403
    And the latest error is "missing required scope equipments:read"
    When I request GET "/equipment-types" with a bearer token role "administrator" and no equipment scopes
    Then the latest response status is 403
    And the latest error is "missing required scope equipments:read"

  Scenario: Scoped non-admin tokens authorize protected reads
    When I request GET "/equipment-types" with a read bearer token
    Then the latest response status is 200

  Scenario: Users Service admin JWT authorizes every protected REST endpoint
    When I request GET "/equipment-types" with a Users Service admin bearer token
    Then the latest response status is 200
    And the latest equipment type list includes "20FT"
    When I create equipment type "45UA" described as "45-foot Users Admin" with nominal length "45'" and max payload 29500 with a Users Service admin bearer token
    Then the latest response status is 201
    And the latest JSON response has field "code" equal to "45UA"
    When I update equipment type "45ua" description to "45-foot Users Admin Updated" with a Users Service admin bearer token
    Then the latest response status is 200
    And the latest JSON response has field "description" equal to "45-foot Users Admin Updated"
    When I register container "USRU3333333" of type "20FT" at depot "NLRTM-01" with a Users Service admin bearer token
    Then the latest response status is 201
    And the latest JSON response has field "containerNumber" equal to "USRU3333333"
    And the latest JSON response has field "status" equal to "AVAILABLE"
    When I list containers with type "20FT" status "AVAILABLE" depot "NLRTM-01" with a Users Service admin bearer token
    Then the latest response status is 200
    And the latest container list includes container "USRU3333333"
    When I fetch the latest container with a Users Service admin bearer token
    Then the latest response status is 200
    And the latest JSON response has field "containerNumber" equal to "USRU3333333"
    When I manually set the latest container status to "IN_TRANSIT" with a Users Service admin bearer token
    Then the latest response status is 200
    And the latest JSON response has field "status" equal to "IN_TRANSIT"
    When I request GET "/availability?depotCode=CNSHA-01" with a Users Service admin bearer token
    Then the latest response status is 200
    And the latest availability response includes 3 units of "20FT" at depot "CNSHA-01"
    When I reserve 1 units of "40FT" at depot "CNSHA-01" for booking "BKG-USERS-GHERKIN-DELETE" with a Users Service admin bearer token
    Then the latest response status is 201
    And the latest reservation assigned 1 containers
    And the latest reservation status is "ACTIVE"
    When I release booking "BKG-USERS-GHERKIN-DELETE" with a Users Service admin bearer token
    Then the latest response status is 200
    And the latest reservation release status is "RELEASED"
    When I reserve 1 units of "20FT" at depot "CNSHA-01" for booking "BKG-USERS-GHERKIN-LIFECYCLE" with a Users Service admin bearer token
    Then the latest response status is 201
    And the latest reservation assigned 1 containers
    And the latest reservation status is "ACTIVE"
    When I pick up the latest reserved container with a Users Service admin bearer token
    Then the latest response status is 200
    And the latest JSON response has field "status" equal to "DISPATCHED"
    When I return the latest container with a Users Service admin bearer token
    Then the latest response status is 200
    And the latest JSON response has field "status" equal to "AVAILABLE"
    When I reserve 1 units of "20FT" at depot "CNSHA-01" for booking "BKG-USERS-GHERKIN-EVENT" with a Users Service admin bearer token
    Then the latest response status is 201
    And the latest reservation assigned 1 containers
    When I receive a "booking.cancelled" event for booking "BKG-USERS-GHERKIN-EVENT" with a Users Service admin bearer token
    Then the latest response status is 200
    And the latest JSON response has boolean field "processed" equal to true
    When I request POST "/dev/reset-all-data" with a Users Service admin bearer token
    Then the latest response status is 200
    And the latest JSON response has boolean field "reset" equal to true
    And the latest JSON response has boolean field "seeded" equal to true
    When I request POST "/dev/clear-all-data" with a Users Service admin bearer token
    Then the latest response status is 200
    And the latest JSON response has boolean field "reset" equal to true
    And the latest JSON response has boolean field "seeded" equal to false
