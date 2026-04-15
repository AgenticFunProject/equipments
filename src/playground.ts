import { readFileSync } from "node:fs";

import type { RuntimeConfig } from "./persistence.js";

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
  const backendPath = config.path ? escapeHtml(config.path) : "";
  const backendDescription = config.path
    ? `Using ${backendLabel} persistence at <code>${backendPath}</code>.`
    : `Using ${backendLabel} persistence for this service instance.`;
  const resetSection = devMode
    ? '<div class="dev-tools"><button id="resetAllData" class="danger" type="button">Reset All Data</button><p class="dev-tools-copy">Dev-only action. Clears runtime state and restores the seeded baseline.</p></div>'
    : '<div class="dev-tools is-disabled"><p class="dev-tools-copy">Reset controls are unavailable outside development mode.</p></div>';

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
