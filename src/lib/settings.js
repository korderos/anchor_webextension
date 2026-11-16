// Persisted extension settings (chrome.storage.local).

export const DEFAULT_SERVER_URL = "https://app-anchor.igjkkb.easypanel.host";

export const DEFAULTS = Object.freeze({
  serverUrl: DEFAULT_SERVER_URL,
  apiToken: "",
  // What "Save page" (context menu / quick-save shortcut) captures: "link" | "full".
  quickSaveMode: "link",
  // Default capture mode preselected in the popup: "link" | "full".
  popupMode: "link",
  notify: true,
  rememberTags: true,
  lastTagIds: [],
});

export async function getSettings() {
  const stored = await chrome.storage.local.get(Object.keys(DEFAULTS));
  return { ...DEFAULTS, ...stored };
}

export async function saveSettings(patch) {
  await chrome.storage.local.set(patch);
}

export function isConfigured(settings) {
  return Boolean(settings.serverUrl && settings.apiToken);
}

/** Trims, adds https:// when no scheme is given and drops trailing slashes / an "/api" suffix. */
export function normalizeServerUrl(input) {
  let url = String(input || "").trim();
  if (!url) return "";
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  const parsed = new URL(url);
  let path = parsed.pathname.replace(/\/+$/, "");
  if (path.toLowerCase().endsWith("/api")) path = path.slice(0, -4);
  return `${parsed.origin}${path}`;
}

/** Match pattern used to request host permission for the server. */
export function originPattern(serverUrl) {
  return `${new URL(serverUrl).origin}/*`;
}
