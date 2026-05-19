Feature: Public routes

  Background:
    Given the seeded equipments service is running

  Scenario: Health and OpenAPI routes are available without a bearer token
    When I request GET "/health" without a bearer token
    Then the latest response status is 200
    And the latest JSON response has field "status" equal to "ok"
    When I request GET "/openapi.json" without a bearer token
    Then the latest response status is 200
    And the latest response content type starts with "application/json"
    And the latest JSON response has field "openapi" equal to "3.1.0"
    And the latest OpenAPI response exposes path "/availability"
    And the latest OpenAPI response exposes path "/reservations"

  Scenario: Root route sends users to the playground without a bearer token
    When I request GET "/" without a bearer token
    Then the latest response status is 302
    And the latest response redirects to "/playground"

  Scenario: Protected API routes still reject anonymous callers
    When I request GET "/equipment-types" without a bearer token
    Then the latest response status is 401
    And the latest error contains "missing bearer token"
