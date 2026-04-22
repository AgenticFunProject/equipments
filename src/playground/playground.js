const presets = {
  health: { method: "GET", path: "/health", body: "", auth: "public", authHint: "This preset is public. A bearer token is optional." },
  listTypes: { method: "GET", path: "/equipment-types", body: "", auth: "equipments:read", authHint: "This preset needs the equipments:read scope." },
  createType: {
    method: "POST",
    path: "/equipment-types",
    body: JSON.stringify({ code: "45HC", description: "45-foot High Cube", nominalLength: "45'", maxPayloadKg: 29500 }, null, 2),
    auth: "equipments:modify",
    authHint: "This preset needs the equipments:modify scope."
  },
  updateType: {
    method: "PUT",
    path: "/equipment-types/45HC",
    body: JSON.stringify({ description: "45-foot High Cube Updated", nominalLength: "45'", maxPayloadKg: 29750 }, null, 2),
    auth: "equipments:modify",
    authHint: "This preset needs the equipments:modify scope."
  },
  registerContainer: {
    method: "POST",
    path: "/containers",
    body: JSON.stringify({ containerNumber: "MSKU1234567", equipmentType: "20FT", currentDepot: "NLRTM-01" }, null, 2),
    auth: "equipments:modify",
    authHint: "This preset needs the equipments:modify scope."
  },
  listContainers: { method: "GET", path: "/containers?status=AVAILABLE", body: "", auth: "equipments:read", authHint: "This preset needs the equipments:read scope." },
  getContainer: { method: "GET", path: "/containers/{id}", body: "", auth: "equipments:read", authHint: "This preset needs the equipments:read scope." },
  overrideStatus: {
    method: "PATCH",
    path: "/containers/{id}/status",
    body: JSON.stringify({ status: "DISPATCHED" }, null, 2),
    auth: "equipments:modify",
    authHint: "This preset needs the equipments:modify scope."
  },
  pickup: { method: "POST", path: "/containers/{id}/pickup", body: "", auth: "equipments:modify", authHint: "This preset needs the equipments:modify scope." },
  return: { method: "POST", path: "/containers/{id}/return", body: "", auth: "equipments:modify", authHint: "This preset needs the equipments:modify scope." },
  availability: { method: "GET", path: "/availability?depotCode=CNSHA-01", body: "", auth: "equipments:read", authHint: "This preset needs the equipments:read scope." },
  reserve: {
    method: "POST",
    path: "/reservations",
    body: JSON.stringify({ bookingReference: "BKG-2026-00042", originDepot: "CNSHA-01", equipment: [{ type: "20FT", quantity: 2 }] }, null, 2),
    auth: "equipments:modify",
    authHint: "This preset needs the equipments:modify scope."
  },
  release: { method: "DELETE", path: "/reservations/BKG-2026-00042", body: "", auth: "equipments:modify", authHint: "This preset needs the equipments:modify scope." },
  event: {
    method: "POST",
    path: "/events",
    body: JSON.stringify({ eventType: "booking.cancelled", payload: { bookingReference: "BKG-2026-00042" } }, null, 2),
    auth: "equipments:modify",
    authHint: "This preset needs the equipments:modify scope."
  }
};

const methodInput = document.getElementById("method");
const pathInput = document.getElementById("path");
const requestBodyInput = document.getElementById("requestBody");
const responseBodyInput = document.getElementById("responseBody");
const responseStatus = document.getElementById("responseStatus");
const responseCode = document.getElementById("responseCode");
const responseText = document.getElementById("responseText");
const responseDetail = document.getElementById("responseDetail");
const responseTime = document.getElementById("responseTime");
const bearerTokenInput = document.getElementById("bearerToken");
const requestAuthHint = document.getElementById("requestAuthHint");
const sendButton = document.getElementById("send");
const resetAllDataButton = document.getElementById("resetAllData");
const clearAllDataButton = document.getElementById("clearAllData");

function setResponseStatus(code, text, detail, tone) {
  responseCode.textContent = code;
  responseText.textContent = text;
  responseDetail.textContent = detail;
  responseStatus.className = `status-chip ${tone}`;
}

function resetResponseOutput() {
  setResponseStatus("Waiting", "Ready to send", "The next response will appear in the panel on the right.", "status-idle");
  responseTime.textContent = "Duration: -";
  responseBodyInput.value = "";
}

function loadPreset(name) {
  const preset = presets[name];
  if (!preset) {
    return;
  }

  methodInput.value = preset.method;
  pathInput.value = preset.path;
  requestBodyInput.value = preset.body;
  requestAuthHint.textContent = preset.authHint;
  resetResponseOutput();

  document.querySelectorAll(".preset").forEach((button) => {
    button.classList.toggle("active", button.dataset.preset === name);
  });
}

async function sendRequest() {
  const method = methodInput.value;
  const path = pathInput.value.trim();
  const rawBody = requestBodyInput.value.trim();
  const bearerToken = bearerTokenInput.value.trim();

  if (!path) {
    setResponseStatus("Missing path", "Request blocked", "Add a path before sending the request.", "status-error");
    return;
  }

  const headers = {};
  const options = { method, headers };

  if (bearerToken && !isPublicPath(path)) {
    headers.authorization = `Bearer ${bearerToken}`;
  }

  if (rawBody) {
    try {
      options.body = JSON.stringify(JSON.parse(rawBody));
      headers["content-type"] = "application/json";
    } catch (error) {
      setResponseStatus("Invalid JSON", "Request blocked", "Fix the request body and try again.", "status-error");
      responseBodyInput.value = String(error);
      return;
    }
  }

  const startedAt = performance.now();

  try {
    const response = await fetch(path, options);
    const duration = Math.round(performance.now() - startedAt);
    const contentType = response.headers.get("content-type") || "";
    const payload = contentType.includes("application/json")
      ? JSON.stringify(await response.json(), null, 2)
      : await response.text();

    setResponseStatus(
      String(response.status),
      response.statusText || "Response received",
      response.ok ? "Request completed successfully." : "Inspect the payload for error details.",
      response.ok ? "status-ok" : "status-error"
    );
    responseTime.textContent = `Duration: ${duration} ms`;
    responseBodyInput.value = payload;
  } catch (error) {
    setResponseStatus("Request failed", "Network error", "The browser could not reach the running service.", "status-error");
    responseTime.textContent = "Duration: -";
    responseBodyInput.value = String(error);
  }
}

async function runDevDataAction(button, url, pendingDetail, successDetail, failureDetail) {
  if (!button) {
    return;
  }

  button.disabled = true;
  setResponseStatus("Working", "Dev data action requested", pendingDetail, "status-idle");
  responseTime.textContent = "Duration: -";

  const startedAt = performance.now();
  const bearerToken = bearerTokenInput.value.trim();

  if (!bearerToken) {
    setResponseStatus("Missing token", "Request blocked", "Paste a bearer token with the equipments:modify scope before using dev-only actions.", "status-error");
    button.disabled = false;
    return;
  }

  try {
    const response = await fetch(url, { method: "POST", headers: { authorization: `Bearer ${bearerToken}` } });
    const duration = Math.round(performance.now() - startedAt);
    const payload = JSON.stringify(await response.json(), null, 2);

    setResponseStatus(
      String(response.status),
      response.ok ? "Action complete" : (response.statusText || "Action failed"),
      response.ok ? successDetail : failureDetail,
      response.ok ? "status-ok" : "status-error"
    );
    responseTime.textContent = `Duration: ${duration} ms`;
    responseBodyInput.value = payload;
  } catch (error) {
    setResponseStatus("Request failed", "Network error", failureDetail, "status-error");
    responseTime.textContent = "Duration: -";
    responseBodyInput.value = String(error);
  } finally {
    button.disabled = false;
  }
}

function isPublicPath(path) {
  return path === "/" || path === "/health" || path === "/playground" || path.startsWith("/playground/");
}

async function resetAllData() {
  return runDevDataAction(
    resetAllDataButton,
    "/dev/reset-all-data",
    "Clearing runtime data and restoring the seeded baseline.",
    "The service state was reset to the seeded baseline for local testing.",
    "The seeded reset endpoint was unavailable or returned an error."
  );
}

async function clearAllData() {
  return runDevDataAction(
    clearAllDataButton,
    "/dev/clear-all-data",
    "Clearing all runtime data and leaving the service empty.",
    "The service state was cleared and now remains empty until you recreate data or restart.",
    "The clear-all endpoint was unavailable or returned an error."
  );
}

document.querySelectorAll(".preset").forEach((button) => {
  button.addEventListener("click", () => loadPreset(button.dataset.preset));
});

sendButton.addEventListener("click", sendRequest);
resetAllDataButton?.addEventListener("click", resetAllData);
clearAllDataButton?.addEventListener("click", clearAllData);
loadPreset("availability");
