Feature: Bearer authentication

  Background:
    Given the seeded equipments service is running

  Scenario: Read and write scopes control protected route access
    When I request GET "/equipment-types" with a read bearer token
    Then the latest response status is 200
    When I try to register container "READ1111111" of type "20FT" at depot "CNSHA-01" with a read bearer token
    Then the latest response status is 403
    And the latest error contains "missing required scope equipments:modify"

  Scenario: Admin role authorizes protected routes without equipment scopes
    When I request GET "/equipment-types" with an admin bearer token without equipment scopes
    Then the latest response status is 200
    When I register container "ADMG1111111" of type "20FT" at depot "CNSHA-01" with an admin bearer token without equipment scopes
    Then the latest response status is 201

  Scenario: Protected API routes require a bearer token
    When I request GET "/equipment-types" without a bearer token
    Then the latest response status is 401
    And the latest error contains "missing bearer token"
