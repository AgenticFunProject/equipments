Feature: Playground development tools

  Scenario: Playground HTML and assets are public
    Given the seeded equipments service is running
    When I request GET "/playground" without a bearer token
    Then the latest response status is 200
    And the latest response content type starts with "text/html"
    And the latest response body contains "Equipments API Playground"
    And the latest response body contains "Generate Token"
    And the latest response body contains "Dev-only actions"
    When I request GET "/playground/playground.css" without a bearer token
    Then the latest response status is 200
    And the latest response content type starts with "text/css"
    And the latest response body contains ".auth-panel"
    When I request GET "/playground/playground.js" without a bearer token
    Then the latest response status is 200
    And the latest response content type starts with "text/javascript"
    And the latest response body contains "/dev/generate-token"

  Scenario: Development reset and clear actions reshape service data
    Given the seeded equipments service is running
    When I request POST "/dev/reset-all-data" with a modify bearer token
    Then the latest response status is 200
    And the latest JSON response has boolean field "reset" equal to true
    And the latest JSON response has boolean field "seeded" equal to true
    And availability at depot "CNSHA-01" shows 3 units of "20FT"
    When I request POST "/dev/clear-all-data" with a modify bearer token
    Then the latest response status is 200
    And the latest JSON response has boolean field "reset" equal to true
    And the latest JSON response has boolean field "seeded" equal to false
    And the equipment type catalog is empty
    And the container inventory is empty

  Scenario: Development token generation returns usable bearer tokens
    Given the seeded equipments service is running
    When I generate a development bearer token for subject "playground-user" with read scope
    Then the latest response status is 201
    And the latest response includes a generated bearer token
    When I request GET "/availability?depotCode=CNSHA-01" with the latest generated bearer token
    Then the latest response status is 200

  Scenario: Development routes are unavailable outside development mode
    Given the seeded equipments service is running outside development mode
    When I generate a development bearer token for subject "playground-user" with read scope
    Then the latest response status is 404
    And the latest error contains "not found"
