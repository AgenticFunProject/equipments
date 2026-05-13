import { readFileSync } from "node:fs";

import type { RuntimeConfig } from "./persistence/index.js";

const playgroundHtmlTemplate = readFileSync(new URL("./playground/index.html", import.meta.url), "utf8");
const playgroundStyle = readFileSync(new URL("./playground/playground.css", import.meta.url), "utf8");
const playgroundScript = readFileSync(new URL("./playground/playground.js", import.meta.url), "utf8");

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function renderApiPlayground(config: RuntimeConfig, devMode: boolean): string {
  const backendLabel = escapeHtml(config.backend);
  const backendLocation = config.displayPath || config.path;
  const backendPath = backendLocation ? escapeHtml(backendLocation) : "";
  const backendDescription = backendLocation
    ? `Using ${backendLabel} persistence at <code>${backendPath}</code>.`
    : `Using ${backendLabel} persistence for this service instance.`;
  const resetSection = devMode
    ? '<div class="dev-tools"><div class="dev-tools-actions"><button id="resetAllData" class="danger" type="button">Reset All Data</button><button id="clearAllData" class="danger" type="button">Clear All Data</button></div><p class="dev-tools-copy">Dev-only actions. Reset restores the seeded baseline. Clear removes all runtime data and leaves the service empty until you recreate data or restart.</p></div>'
    : '<div class="dev-tools is-disabled"><p class="dev-tools-copy">Dev-only data controls are unavailable outside development mode.</p></div>';

  return playgroundHtmlTemplate
    .replaceAll("__BACKEND_LABEL__", backendLabel)
    .replaceAll("__BACKEND_DESCRIPTION__", backendDescription)
    .replaceAll("__RESET_SECTION__", resetSection);
}

export function getPlaygroundStyle(): string {
  return playgroundStyle;
}

export function getPlaygroundScript(): string {
  return playgroundScript;
}
