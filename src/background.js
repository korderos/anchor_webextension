import { AnchorClient } from "./lib/api.js";
import { getSettings, isConfigured } from "./lib/settings.js";
import { composeNote, readTab, selectionTextToBlocks } from "./lib/capture.js";

const MENU = {
  PAGE: "anchor-save-page",
  PAGE_FULL: "anchor-save-page-full",
  SELECTION: "anchor-save-selection",
  LINK: "anchor-save-link",
};

// Notification id → note URL, so clicking a "Saved" notification opens the note.
const notificationTargets = new Map();

function createMenus() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: MENU.PAGE, title: "Save page to Anchor", contexts: ["page"] });
    chrome.contextMenus.create({ id: MENU.PAGE_FULL, title: "Save page with full text to Anchor", contexts: ["page"] });
    chrome.contextMenus.create({ id: MENU.SELECTION, title: "Save selection to Anchor", contexts: ["selection"] });
    chrome.contextMenus.create({ id: MENU.LINK, title: "Save link to Anchor", contexts: ["link"] });
  });
}

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  createMenus();
  if (reason === "install") {
    const settings = await getSettings();
    if (!isConfigured(settings)) chrome.runtime.openOptionsPage();
  }
});
chrome.runtime.onStartup?.addListener(createMenus);

chrome.contextMenus.onClicked.addListener((info, tab) => {
  handleMenu(info, tab).catch((err) => reportError(tab, err));
});

chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command !== "quick-save") return;
  const target = tab ?? (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
  if (!target) return;
  const { quickSaveMode } = await getSettings();
  quickSave(target, quickSaveMode === "full" ? "full" : "link").catch((err) => reportError(target, err));
});

chrome.notifications?.onClicked.addListener((id) => {
  const url = notificationTargets.get(id);
  if (url) chrome.tabs.create({ url });
  notificationTargets.delete(id);
  chrome.notifications.clear(id);
});

async function handleMenu(info, tab) {
  switch (info.menuItemId) {
    case MENU.PAGE:
      return quickSave(tab, "link");
    case MENU.PAGE_FULL:
      return quickSave(tab, "full");
    case MENU.SELECTION: {
      const page = await readTab(tab, { content: false });
      if (!page.selection?.blocks?.length) {
        page.selection = { text: info.selectionText, blocks: selectionTextToBlocks(info.selectionText) };
      }
      return save(tab, page, "selection");
    }
    case MENU.LINK: {
      const url = info.linkUrl;
      // Firefox exposes the anchor text; Chrome only the selection, if any.
      const title = (info.linkText || info.selectionText || "").trim() || url;
      const page = { title, url, description: "", selection: null, blocks: [] };
      return save(tab, page, "link");
    }
  }
}

async function quickSave(tab, mode) {
  const page = await readTab(tab, { content: mode === "full" });
  return save(tab, page, mode);
}

async function save(tab, page, mode) {
  const settings = await getSettings();
  if (!isConfigured(settings)) {
    chrome.runtime.openOptionsPage();
    throw new Error("Connect the extension to your Anchor server first.");
  }
  setBadge(tab, "…", "#6b7280");
  const client = new AnchorClient(settings);
  const note = composeNote(page, mode);
  // The server silently ignores tag ids that no longer exist.
  const tagIds = settings.rememberTags ? settings.lastTagIds : [];
  const created = await client.createNote({ ...note, tagIds });
  setBadge(tab, "✓", "#15803d", 2500);
  if (settings.notify) {
    notify(`Saved to Anchor`, note.title || page.url, created?.id ? client.noteUrl(created.id) : null);
  }
  return created;
}

function reportError(tab, err) {
  console.error("[Save to Anchor]", err);
  setBadge(tab, "!", "#b91c1c", 5000);
  notify("Couldn't save to Anchor", err?.message || String(err));
}

function setBadge(tab, text, color, clearAfterMs) {
  if (!tab?.id || tab.id < 0) return;
  const tabId = tab.id;
  chrome.action.setBadgeBackgroundColor({ tabId, color }).catch(() => {});
  chrome.action.setBadgeText({ tabId, text }).catch(() => {});
  if (clearAfterMs) setTimeout(() => chrome.action.setBadgeText({ tabId, text: "" }).catch(() => {}), clearAfterMs);
}

function notify(title, message, openUrl) {
  if (!chrome.notifications) return;
  chrome.notifications.create(
    {
      type: "basic",
      iconUrl: chrome.runtime.getURL("icons/icon-128.png"),
      title,
      message: `${message.slice(0, 180)}${openUrl ? "\nClick to open the note." : ""}`,
    },
    (id) => {
      if (openUrl && id) notificationTargets.set(id, openUrl);
    },
  );
}
