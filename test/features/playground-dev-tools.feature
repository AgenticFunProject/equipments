Feature: Playground development tools

  Scenario: Playground HTML and assets are public
    Given the seeded equipments service is running
    When I request GET "/playground" without a bearer token
    Then the latest response status is 200
    And the latest response content type starts with "text/html"
    And the latest response body contains "Equipments API Playground"
    And the latest response body contains "Active Backend"
    And the latest response body contains "Bearer token"
    And the latest response body contains "Generate Token"
    And the latest response body contains "Token subject"
    And the latest response body contains "Token rights"
    And the latest response body contains "equipments:read"
    And the latest response body contains "equipments:modify"
    And the latest response body contains "role=admin"
    And the latest response body contains "Protected routes without equipment scopes"
    And the latest response body contains "GET /health"
    And the latest response body contains "/openapi.json"
    And the latest response body contains "Dev-only actions"
    When I request GET "/playground/playground.css" without a bearer token
    Then the latest response status is 200
    And the latest response content type starts with "text/css"
    And the latest response body contains ".backend-chip"
    And the latest response body contains ".auth-panel"
    When I request GET "/playground/playground.js" without a bearer token
    Then the latest response status is 200
    And the latest response content type starts with "text/javascript"
    And the latest response body contains "const presets ="
    And the latest response body contains "updateType:"
    And the latest response body contains "getContainer:"
    And the latest response body contains "authHint:"
    And the latest response body contains "const bearerTokenInput ="
    And the latest response body contains "const generateTokenButton ="
    And the latest response body contains "/dev/generate-token"
    And the latest response body contains "function generateToken("
    And the latest response body contains "function roleFromSelection("
    And the latest playground script handles admin token rights
    And the latest response body contains "function isPublicPath("
    And the latest response body contains "function resetResponseOutput("
    And the latest response body contains "function runDevDataAction("
    And the latest response body contains "function resetAllData("
    And the latest response body contains "function clearAllData("
    And the latest response body contains "resetResponseOutput();"
    And the latest playground script loads the availability preset by default

  Scenario: Playground shows configured runtime backend details
    Given the seeded equipments service is running with sqlite persistence at path "/tmp/equipments.sqlite"
    When I request GET "/playground" without a bearer token
    Then the latest response status is 200
    And the latest response body contains "sqlite"
    And the latest response body contains "/tmp/equipments.sqlite"

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
    And the latest JSON response has field "subject" equal to "playground-user"
    And the latest JSON response has string array field "scopes" containing exactly "equipments:read"
    When I request GET "/availability?depotCode=CNSHA-01" with the latest generated bearer token
    Then the latest response status is 200

  Scenario: Development admin token generation authorizes a protected write
    Given the seeded equipments service is running
    When I generate a development admin bearer token for subject "playground-admin"
    Then the latest response status is 201
    And the latest response includes a generated bearer token
    And the latest JSON response has field "subject" equal to "playground-admin"
    And the latest JSON response has empty array field "scopes"
    And the latest JSON response has field "role" equal to "admin"
    When I create equipment type "53FT" described as "53-foot Dry" with nominal length "53'" and max payload 30000 with the latest generated bearer token
    Then the latest response status is 201
    And the latest JSON response has field "code" equal to "53FT"

  Scenario: Development token generation validates required subject
    Given the seeded equipments service is running
    When I try to generate a development bearer token with a blank subject
    Then the latest response status is 400
    And the latest error is "token subject is required"

  Scenario: Playground hides development controls outside development mode
    Given the seeded equipments service is running outside development mode
    When I request GET "/playground" without a bearer token
    Then the latest response status is 200
    And the latest response body does not contain "Reset All Data"
    And the latest response body does not contain "Clear All Data"
    And the latest response body contains "unavailable outside development mode"
    When I generate a development bearer token for subject "playground-user" with read scope
    Then the latest response status is 404
    And the latest error is "not found"
    When I request POST "/dev/reset-all-data" with a modify bearer token
    Then the latest response status is 404
    And the latest error is "not found"
    When I request POST "/dev/clear-all-data" with a modify bearer token
    Then the latest response status is 404
    And the latest error is "not found"
