import type { RuntimeConfig } from "./persistence.js";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function renderApiPlayground(config: RuntimeConfig): string {
  const backendLabel = escapeHtml(config.backend);
  const backendPath = config.path ? escapeHtml(config.path) : "";
  const backendDescription = config.path
    ? `Using ${backendLabel} persistence at <code>${backendPath}</code>.`
    : `Using ${backendLabel} persistence for this service instance.`;

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Equipments API Playground</title>
    <style>
      :root {
        color-scheme: dark;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background: #0f172a;
        color: #e2e8f0;
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        min-height: 100vh;
        background:
          radial-gradient(circle at top left, rgba(14, 165, 233, 0.18), transparent 28%),
          radial-gradient(circle at top right, rgba(96, 165, 250, 0.18), transparent 22%),
          #0f172a;
      }

      main {
        width: min(1160px, calc(100vw - 28px));
        margin: 0 auto;
        padding: 18px 0 28px;
      }

      .hero {
        display: grid;
        gap: 6px;
        margin-bottom: 16px;
      }

      .hero-heading {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 12px;
        flex-wrap: wrap;
      }

      .hero-copy {
        display: grid;
        gap: 6px;
        min-width: 0;
      }

      .hero-top {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        margin-bottom: 2px;
      }

      .brand-lockup {
        display: inline-flex;
        align-items: center;
        gap: 12px;
        min-width: 0;
      }

      .brand-mark {
        display: grid;
        grid-template-columns: repeat(2, 10px);
        gap: 4px;
        padding: 8px;
        border-radius: 14px;
        background: linear-gradient(180deg, rgba(14, 165, 233, 0.18), rgba(37, 99, 235, 0.08));
        border: 1px solid rgba(125, 211, 252, 0.2);
        box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04);
      }

      .brand-mark span {
        width: 10px;
        height: 10px;
        border-radius: 999px;
        background: linear-gradient(135deg, #7dd3fc, #2563eb);
        opacity: 0.95;
      }

      .brand-mark span:nth-child(2) {
        opacity: 0.7;
      }

      .brand-mark span:nth-child(3) {
        opacity: 0.8;
      }

      .brand-name {
        margin: 0 0 2px;
        color: #f8fafc;
        font-size: 0.9rem;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }

      h1 {
        margin: 0;
        font-size: clamp(2rem, 5vw, 3.25rem);
        line-height: 1;
      }

      .subtitle {
        margin: 0;
        color: #94a3b8;
        max-width: 70ch;
      }

      .layout {
        display: grid;
        grid-template-columns: minmax(250px, 300px) minmax(0, 1fr);
        gap: 16px;
      }

      .panel {
        background: rgba(15, 23, 42, 0.82);
        border: 1px solid rgba(148, 163, 184, 0.18);
        border-radius: 18px;
        box-shadow: 0 18px 54px rgba(2, 6, 23, 0.34);
        backdrop-filter: blur(16px);
      }

      .panel-body {
        padding: 15px;
      }

      .catalog {
        display: grid;
        gap: 10px;
      }

      .catalog-group {
        display: grid;
        gap: 6px;
      }

      .catalog-group h2,
      .workspace h2 {
        margin: 0;
        font-size: 0.95rem;
        line-height: 1;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: #7dd3fc;
      }

      .catalog-group h2 {
        margin: 0 0 10px;
      }

      .request-section {
        display: grid;
        gap: 0;
      }

      .backend-chip {
        display: grid;
        gap: 2px;
        min-width: 0;
        padding: 7px 10px;
        border: 1px solid rgba(125, 211, 252, 0.24);
        border-radius: 12px;
        background: rgba(8, 47, 73, 0.45);
      }

      .backend-label {
        font-size: 0.68rem;
        letter-spacing: 0.1em;
        text-transform: uppercase;
        color: #94a3b8;
      }

      .backend-value {
        color: #e0f2fe;
        font-size: 0.84rem;
      }

      .backend-detail {
        color: #94a3b8;
        font-size: 0.75rem;
      }

      .backend-detail code {
        color: #e2e8f0;
      }

      button,
      select,
      input,
      textarea {
        font: inherit;
      }

      .preset {
        width: 100%;
        padding: 10px 12px;
        border: 1px solid rgba(148, 163, 184, 0.14);
        border-radius: 12px;
        background: rgba(30, 41, 59, 0.65);
        color: inherit;
        text-align: left;
        cursor: pointer;
      }

      .preset:hover,
      .preset.active {
        border-color: rgba(125, 211, 252, 0.55);
        background: rgba(14, 165, 233, 0.16);
      }

      .preset strong {
        display: block;
        margin-bottom: 4px;
      }

      .preset span {
        color: #94a3b8;
        font-size: 0.9rem;
      }

      .workspace {
        display: grid;
        gap: 12px;
      }

      .request-grid {
        display: grid;
        grid-template-columns: 116px minmax(0, 1fr) 112px;
        gap: 10px;
      }

      label {
        display: grid;
        gap: 4px;
        color: #cbd5e1;
        font-size: 0.88rem;
      }

      select,
      input,
      textarea {
        width: 100%;
        padding: 10px 12px;
        border-radius: 12px;
        border: 1px solid rgba(148, 163, 184, 0.16);
        background: rgba(15, 23, 42, 0.8);
        color: inherit;
      }

      textarea {
        min-height: 220px;
        resize: vertical;
        font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace;
        line-height: 1.4;
      }

      .editor-grid {
        display: grid;
        grid-template-columns: minmax(0, 0.94fr) minmax(0, 1.06fr);
        gap: 12px;
      }

      .send {
        align-self: end;
        padding: 10px 14px;
        border: 0;
        border-radius: 12px;
        background: linear-gradient(135deg, #38bdf8, #2563eb);
        color: white;
        cursor: pointer;
        font-weight: 700;
      }

      .send:hover {
        filter: brightness(1.08);
      }

      .meta {
        display: grid;
        grid-template-columns: minmax(0, 1.2fr) auto;
        gap: 10px;
        align-items: stretch;
      }

      .pill {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 8px 11px;
        border-radius: 12px;
        background: rgba(30, 41, 59, 0.65);
        color: #94a3b8;
        font-size: 0.86rem;
      }

      .meta-side {
        display: grid;
        gap: 10px;
        justify-items: end;
      }

      .status-chip {
        display: grid;
        gap: 4px;
        min-width: 0;
        padding: 10px 12px;
        border: 1px solid rgba(148, 163, 184, 0.16);
        border-radius: 14px;
        background: rgba(15, 23, 42, 0.92);
      }

      .status-label {
        font-size: 0.74rem;
        letter-spacing: 0.1em;
        text-transform: uppercase;
        color: #94a3b8;
      }

      .status-main {
        display: flex;
        align-items: baseline;
        gap: 8px;
        flex-wrap: wrap;
      }

      .status-code {
        font-size: 1rem;
        font-weight: 700;
        color: #f8fafc;
      }

      .status-text {
        font-size: 0.86rem;
        color: #cbd5e1;
      }

      .status-detail {
        font-size: 0.8rem;
        color: #64748b;
      }

      .status-idle {
        border-color: rgba(148, 163, 184, 0.16);
      }

      .status-ok {
        border-color: rgba(34, 197, 94, 0.35);
        background: linear-gradient(180deg, rgba(21, 128, 61, 0.16), rgba(15, 23, 42, 0.92));
      }

      .status-ok .status-code {
        color: #86efac;
      }

      .status-error {
        border-color: rgba(244, 63, 94, 0.35);
        background: linear-gradient(180deg, rgba(190, 24, 93, 0.16), rgba(15, 23, 42, 0.92));
      }

      .status-error .status-code {
        color: #fda4af;
      }

      .tip {
        justify-self: end;
        max-width: 32ch;
      }

      @media (max-width: 900px) {
        .layout,
        .editor-grid,
        .request-grid,
        .meta {
          grid-template-columns: 1fr;
        }

        .hero-top {
          align-items: flex-start;
          flex-direction: column;
        }

        .hero-heading {
          flex-direction: column;
        }

        .backend-chip {
          width: 100%;
        }

        .send {
          width: 100%;
        }

        .meta-side,
        .tip {
          justify-items: stretch;
          justify-self: stretch;
          max-width: none;
        }
      }
    </style>
  </head>
  <body>
    <main>
      <section class="hero">
        <div class="hero-top">
          <div class="brand-lockup" aria-label="Equipments brand">
            <div class="brand-mark" aria-hidden="true">
              <span></span>
              <span></span>
              <span></span>
              <span></span>
            </div>
            <div>
              <p class="brand-name">Equipments</p>
              <p class="subtitle">Container operations toolkit</p>
            </div>
          </div>
          <p class="pill">Local tooling for manual API calls</p>
        </div>
        <div class="hero-heading">
          <div class="hero-copy">
            <h1>Equipments API Playground</h1>
            <p class="subtitle">
              Load a common workflow, tweak the path or JSON body, and send requests directly to the running service.
            </p>
          </div>
          <div class="backend-chip" aria-live="polite">
            <span class="backend-label">Active Backend</span>
            <strong class="backend-value">${backendLabel}</strong>
            <span class="backend-detail">${backendDescription}</span>
          </div>
        </div>
      </section>

      <section class="layout">
        <aside class="panel panel-body catalog" aria-label="Request presets">
          <div class="catalog-group">
            <h2>Catalog</h2>
            <button class="preset" data-preset="health"><strong>Health Check</strong><span>GET /health</span></button>
            <button class="preset" data-preset="listTypes"><strong>List Equipment Types</strong><span>GET /equipment-types</span></button>
            <button class="preset" data-preset="createType"><strong>Create Equipment Type</strong><span>POST /equipment-types</span></button>
          </div>

          <div class="catalog-group">
            <h2>Containers</h2>
            <button class="preset" data-preset="registerContainer"><strong>Register Container</strong><span>POST /containers</span></button>
            <button class="preset" data-preset="listContainers"><strong>List Containers</strong><span>GET /containers</span></button>
            <button class="preset" data-preset="overrideStatus"><strong>Override Status</strong><span>PATCH /containers/{id}/status</span></button>
            <button class="preset" data-preset="pickup"><strong>Pickup Container</strong><span>POST /containers/{id}/pickup</span></button>
            <button class="preset" data-preset="return"><strong>Return Container</strong><span>POST /containers/{id}/return</span></button>
          </div>

          <div class="catalog-group">
            <h2>Reservations</h2>
            <button class="preset active" data-preset="availability"><strong>Availability</strong><span>GET /availability</span></button>
            <button class="preset" data-preset="reserve"><strong>Create Reservation</strong><span>POST /reservations</span></button>
            <button class="preset" data-preset="release"><strong>Release Reservation</strong><span>DELETE /reservations/{bookingReference}</span></button>
            <button class="preset" data-preset="event"><strong>Send Event</strong><span>POST /events</span></button>
          </div>
        </aside>

        <section class="panel panel-body workspace">
          <div class="request-section">
            <h2>Request</h2>
            <div class="request-grid">
              <label>
                Method
                <select id="method">
                  <option>GET</option>
                  <option>POST</option>
                  <option>PUT</option>
                  <option>PATCH</option>
                  <option>DELETE</option>
                </select>
              </label>
              <label>
                Path
                <input id="path" type="text" spellcheck="false" />
              </label>
              <button id="send" class="send" type="button">Send Request</button>
            </div>
          </div>

          <div class="editor-grid">
            <label>
              JSON request body
              <textarea id="requestBody" spellcheck="false"></textarea>
            </label>
            <label>
              Response
              <textarea id="responseBody" spellcheck="false" readonly></textarea>
            </label>
          </div>

          <div class="meta">
            <div id="responseStatus" class="status-chip status-idle" aria-live="polite">
              <span class="status-label">Response Status</span>
              <div class="status-main">
                <strong id="responseCode" class="status-code">Waiting</strong>
                <span id="responseText" class="status-text">Ready to send</span>
              </div>
              <span id="responseDetail" class="status-detail">The next response will appear in the panel on the right.</span>
            </div>
            <div class="meta-side">
              <div id="responseTime" class="pill">Duration: -</div>
              <div class="pill tip">Tip: placeholders like <code>{id}</code> can be edited directly in the path field.</div>
            </div>
          </div>
        </section>
      </section>
    </main>

    <script>
      const presets = {
        health: { method: 'GET', path: '/health', body: '' },
        listTypes: { method: 'GET', path: '/equipment-types', body: '' },
        createType: {
          method: 'POST',
          path: '/equipment-types',
          body: JSON.stringify({ code: '45HC', description: '45-foot High Cube', nominalLength: "45'", maxPayloadKg: 29500 }, null, 2)
        },
        registerContainer: {
          method: 'POST',
          path: '/containers',
          body: JSON.stringify({ containerNumber: 'MSKU1234567', equipmentType: '20FT', currentDepot: 'NLRTM-01' }, null, 2)
        },
        listContainers: { method: 'GET', path: '/containers?status=AVAILABLE', body: '' },
        overrideStatus: {
          method: 'PATCH',
          path: '/containers/{id}/status',
          body: JSON.stringify({ status: 'DISPATCHED' }, null, 2)
        },
        pickup: { method: 'POST', path: '/containers/{id}/pickup', body: '' },
        return: { method: 'POST', path: '/containers/{id}/return', body: '' },
        availability: { method: 'GET', path: '/availability?depotCode=CNSHA-01', body: '' },
        reserve: {
          method: 'POST',
          path: '/reservations',
          body: JSON.stringify({ bookingReference: 'BKG-2026-00042', originDepot: 'CNSHA-01', equipment: [{ type: '20FT', quantity: 2 }] }, null, 2)
        },
        release: { method: 'DELETE', path: '/reservations/BKG-2026-00042', body: '' },
        event: {
          method: 'POST',
          path: '/events',
          body: JSON.stringify({ eventType: 'booking.cancelled', payload: { bookingReference: 'BKG-2026-00042' } }, null, 2)
        }
      };

      const methodInput = document.getElementById('method');
      const pathInput = document.getElementById('path');
      const requestBodyInput = document.getElementById('requestBody');
      const responseBodyInput = document.getElementById('responseBody');
      const responseStatus = document.getElementById('responseStatus');
      const responseCode = document.getElementById('responseCode');
      const responseText = document.getElementById('responseText');
      const responseDetail = document.getElementById('responseDetail');
      const responseTime = document.getElementById('responseTime');

      function setResponseStatus(code, text, detail, tone) {
        responseCode.textContent = code;
        responseText.textContent = text;
        responseDetail.textContent = detail;
        responseStatus.className = 'status-chip ' + tone;
      }

      function loadPreset(name) {
        const preset = presets[name];
        if (!preset) {
          return;
        }

        methodInput.value = preset.method;
        pathInput.value = preset.path;
        requestBodyInput.value = preset.body;

        document.querySelectorAll('.preset').forEach((button) => {
          button.classList.toggle('active', button.dataset.preset === name);
        });
      }

      async function sendRequest() {
        const method = methodInput.value;
        const path = pathInput.value.trim();
        const rawBody = requestBodyInput.value.trim();

        if (!path) {
          setResponseStatus('Missing path', 'Request blocked', 'Add a path before sending the request.', 'status-error');
          return;
        }

        const headers = {};
        const options = { method, headers };

        if (rawBody) {
          try {
            options.body = JSON.stringify(JSON.parse(rawBody));
            headers['content-type'] = 'application/json';
          } catch (error) {
            setResponseStatus('Invalid JSON', 'Request blocked', 'Fix the request body and try again.', 'status-error');
            responseBodyInput.value = String(error);
            return;
          }
        }

        const startedAt = performance.now();

        try {
          const response = await fetch(path, options);
          const duration = Math.round(performance.now() - startedAt);
          const contentType = response.headers.get('content-type') || '';
          const payload = contentType.includes('application/json')
            ? JSON.stringify(await response.json(), null, 2)
            : await response.text();

          setResponseStatus(String(response.status), response.statusText || 'Response received', response.ok ? 'Request completed successfully.' : 'Inspect the payload for error details.', response.ok ? 'status-ok' : 'status-error');
          responseTime.textContent = 'Duration: ' + duration + ' ms';
          responseBodyInput.value = payload;
        } catch (error) {
          setResponseStatus('Request failed', 'Network error', 'The browser could not reach the running service.', 'status-error');
          responseTime.textContent = 'Duration: -';
          responseBodyInput.value = String(error);
        }
      }

      document.querySelectorAll('.preset').forEach((button) => {
        button.addEventListener('click', () => loadPreset(button.dataset.preset));
      });
      document.getElementById('send').addEventListener('click', sendRequest);

      loadPreset('availability');
    </script>
  </body>
</html>`;
}
