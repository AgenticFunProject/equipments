const presets = {
  health: { method: "GET", path: "/health", body: "" },
  listTypes: { method: "GET", path: "/equipment-types", body: "" },
  createType: {
    method: "POST",
    path: "/equipment-types",
    body: JSON.stringify({ code: "45HC", description: "45-foot High Cube", nominalLength: "45'", maxPayloadKg: 29500 }, null, 2)
  },
  registerContainer: {
    method: "POST",
    path: "/containers",
    body: JSON.stringify({ containerNumber: "MSKU1234567", equipmentType: "20FT", currentDepot: "NLRTM-01" }, null, 2)
  },
  listContainers: { method: "GET", path: "/containers?status=AVAILABLE", body: "" },
  overrideStatus: {
    method: "PATCH",
    path: "/containers/{id}/status",
    body: JSON.stringify({ status: "DISPATCHED" }, null, 2)
  },
  pickup: { method: "POST", path: "/containers/{id}/pickup", body: "" },
  return: { method: "POST", path: "/containers/{id}/return", body: "" },
  availability: { method: "GET", path: "/availability?depotCode=CNSHA-01", body: "" },
  reserve: {
    method: "POST",
    path: "/reservations",
    body: JSON.stringify({ bookingReference: "BKG-2026-00042", originDepot: "CNSHA-01", equipment: [{ type: "20FT", quantity: 2 }] }, null, 2)
  },
  release: { method: "DELETE", path: "/reservations/BKG-2026-00042", body: "" },
  event: {
    method: "POST",
    path: "/events",
    body: JSON.stringify({ eventType: "booking.cancelled", payload: { bookingReference: "BKG-2026-00042" } }, null, 2)
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
const sendButton = document.getElementById("send");
const resetAllDataButton = document.getElementById("resetAllData");

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
  resetResponseOutput();

  document.querySelectorAll(".preset").forEach((button) => {
    button.classList.toggle("active", button.dataset.preset === name);
  });
}

async function sendRequest() {
  const method = methodInput.value;
  const path = pathInput.value.trim();
  const rawBody = requestBodyInput.value.trim();

  if (!path) {
    setResponseStatus("Missing path", "Request blocked", "Add a path before sending the request.", "status-error");
    return;
  }

  const headers = {};
  const options = { method, headers };

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

async function resetAllData() {
  if (!resetAllDataButton) {
    return;
  }

  resetAllDataButton.disabled = true;
  setResponseStatus("Resetting", "Dev reset requested", "Clearing runtime data and restoring the seeded baseline.", "status-idle");
  responseTime.textContent = "Duration: -";

  const startedAt = performance.now();

  try {
    const response = await fetch("/dev/reset-all-data", { method: "POST" });
    const duration = Math.round(performance.now() - startedAt);
    const payload = JSON.stringify(await response.json(), null, 2);

    setResponseStatus(
      String(response.status),
      response.ok ? "Reset complete" : (response.statusText || "Reset failed"),
      response.ok ? "The service state was reset for local testing." : "Reset endpoint was unavailable or returned an error.",
      response.ok ? "status-ok" : "status-error"
    );
    responseTime.textContent = `Duration: ${duration} ms`;
    responseBodyInput.value = payload;
  } catch (error) {
    setResponseStatus("Request failed", "Network error", "The browser could not reach the reset endpoint.", "status-error");
    responseTime.textContent = "Duration: -";
    responseBodyInput.value = String(error);
  } finally {
    resetAllDataButton.disabled = false;
  }
}

document.querySelectorAll(".preset").forEach((button) => {
  button.addEventListener("click", () => loadPreset(button.dataset.preset));
});

sendButton.addEventListener("click", sendRequest);
resetAllDataButton?.addEventListener("click", resetAllData);
loadPreset("availability");
