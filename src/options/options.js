import { AnchorClient } from "../lib/api.js";
import { getSettings, normalizeServerUrl, originPattern, saveSettings } from "../lib/settings.js";

const $ = (id) => document.getElementById(id);

init();

async function init() {
  const settings = await getSettings();

  $("server-url").value = settings.serverUrl;
  $("api-token").value = settings.apiToken;
  $("popup-mode").value = settings.popupMode;
  $("quick-mode").value = settings.quickSaveMode;
  $("remember-tags").checked = settings.rememberTags;
  $("notify").checked = settings.notify;
  $("disconnect").hidden = !settings.apiToken;
  updateAnchorSettingsLink();

  if (settings.apiToken) {
    setStatus("info", "Checking connection…");
    testConnection(settings.serverUrl, settings.apiToken, { quiet: true });
  } else {
    $("api-token").focus();
  }

  $("server-url").addEventListener("input", updateAnchorSettingsLink);
  $("toggle-token").addEventListener("click", () => {
    const input = $("api-token");
    const show = input.type === "password";
    input.type = show ? "text" : "password";
    $("toggle-token").textContent = show ? "Hide" : "Show";
  });
  $("connection").addEventListener("submit", onSaveConnection);
  $("disconnect").addEventListener("click", onDisconnect);

  const autosave = (id, key, read) =>
    $(id).addEventListener("change", async () => {
      await saveSettings({ [key]: read($(id)) });
      toast();
    });
  autosave("popup-mode", "popupMode", (el) => el.value);
  autosave("quick-mode", "quickSaveMode", (el) => el.value);
  autosave("remember-tags", "rememberTags", (el) => el.checked);
  autosave("notify", "notify", (el) => el.checked);
}

function onSaveConnection(event) {
  event.preventDefault();
  let serverUrl;
  try {
    serverUrl = normalizeServerUrl($("server-url").value);
  } catch {
    setStatus("error", "That server URL doesn't look valid.");
    return;
  }
  const apiToken = $("api-token").value.trim();
  if (!serverUrl || !apiToken) {
    setStatus("error", "Enter both the server URL and the API token.");
    return;
  }
  $("server-url").value = serverUrl;

  // Must be requested synchronously inside the click (user gesture), before any await.
  // Host access lets requests through even if the server restricts CORS origins.
  const permission = chrome.permissions
    .request({ origins: [originPattern(serverUrl)] })
    .catch(() => false);

  (async () => {
    setBusy(true);
    await permission;
    const ok = await testConnection(serverUrl, apiToken);
    if (ok) {
      await saveSettings({ serverUrl, apiToken });
      $("disconnect").hidden = false;
    }
    setBusy(false);
  })();
}

async function testConnection(serverUrl, apiToken, { quiet = false } = {}) {
  if (!quiet) setStatus("info", "Connecting…");
  try {
    const { tagCount } = await new AnchorClient({ serverUrl, apiToken }).testConnection();
    setStatus(
      "success",
      `Connected to ${new URL(serverUrl).host}. ${tagCount} ${tagCount === 1 ? "tag" : "tags"} found. You're ready to save.`,
    );
    return true;
  } catch (err) {
    setStatus("error", err.message || String(err));
    return false;
  }
}

async function onDisconnect() {
  await saveSettings({ apiToken: "", lastTagIds: [] });
  $("api-token").value = "";
  $("disconnect").hidden = true;
  setStatus("info", "Disconnected. The token was removed from this browser.");
}

function updateAnchorSettingsLink() {
  let base = "";
  try {
    base = normalizeServerUrl($("server-url").value);
  } catch {
    // ignore while typing
  }
  const link = $("open-anchor-settings");
  link.hidden = !base;
  if (base) link.href = `${base}/settings`;
}

function setStatus(kind, message) {
  const el = $("status");
  el.className = `alert alert-${kind}`;
  el.textContent = message;
  el.hidden = false;
}

function setBusy(on) {
  const btn = $("save-connection");
  btn.disabled = on;
  btn.querySelector(".spinner").hidden = !on;
}

let toastTimer;
function toast() {
  const el = $("saved-toast");
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 1400);
}
