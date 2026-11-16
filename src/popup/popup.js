import { AnchorClient } from "../lib/api.js";
import { composeNote, readTab } from "../lib/capture.js";
import { NOTE_COLORS } from "../lib/colors.js";
import { getSettings, isConfigured, saveSettings } from "../lib/settings.js";

const $ = (id) => document.getElementById(id);

const state = {
  settings: null,
  client: null,
  tab: null,
  page: null, // filled once the content script returns
  tags: [],
  selectedTags: new Set(),
  background: null,
  saving: false,
};

init().catch((err) => showError(err.message || String(err)));

async function init() {
  state.settings = await getSettings();
  const { settings } = state;

  $("open-settings").addEventListener("click", openSettings);
  $("setup-btn").addEventListener("click", openSettings);

  if (!isConfigured(settings)) {
    show("view-setup");
    $("open-anchor").hidden = true;
    return;
  }

  state.client = new AnchorClient(settings);
  $("server-host").textContent = safeHost(settings.serverUrl);
  $("open-anchor").addEventListener("click", () => openTab(settings.serverUrl));

  [state.tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = state.tab;

  // Render immediately from tab info; refine once the page has been read.
  $("title").value = tab?.title || "";
  $("source-url").textContent = displayUrl(tab?.url);
  $("source-url").title = tab?.url || "";
  if (tab?.favIconUrl && /^(https?|data):/.test(tab.favIconUrl)) {
    $("favicon").src = tab.favIconUrl;
    $("favicon").hidden = false;
    $("favicon").onerror = () => ($("favicon").hidden = true);
  }

  setMode(settings.popupMode === "full" ? "full" : "link");
  setModeHint("Reading page…");
  renderColors();
  if (settings.rememberTags) for (const id of settings.lastTagIds || []) state.selectedTags.add(id);

  wireForm();
  show("view-form");
  $("title").focus();
  $("title").select();

  await Promise.all([loadPage(), loadTags(), checkDuplicate()]);
}

// ------------------------------------------------------------------ page

async function loadPage() {
  state.page = await readTab(state.tab, { content: true });
  const { page } = state;
  // Prefer what the page reports, unless the user already edited the title.
  if (page.title && $("title").value === (state.tab.title || "")) $("title").value = page.title;

  const hasSelection = Boolean(page.selection?.blocks?.length);
  modeInput("selection").disabled = !hasSelection;
  modeInput("full").disabled = page.restricted || !page.blocks.length;
  if (hasSelection) setMode("selection");
  else if (modeInput(currentMode()).disabled) setMode("link");
  updateModeHint();
}

function modeInput(mode) {
  return document.querySelector(`input[name="mode"][value="${mode}"]`);
}
function currentMode() {
  return document.querySelector('input[name="mode"]:checked')?.value || "link";
}
function setMode(mode) {
  modeInput(mode).checked = true;
}
function setModeHint(text) {
  $("mode-hint").textContent = text;
}

function updateModeHint() {
  const { page } = state;
  if (!page) return;
  if (page.restricted) {
    setModeHint("This page can't be read by extensions, so only the link will be saved.");
    return;
  }
  const n = (x) => x.toLocaleString();
  switch (currentMode()) {
    case "link":
      setModeHint(page.description ? "Saves the link and the page description." : "Saves the link.");
      break;
    case "selection": {
      const words = page.selection?.text.match(/\S+/g)?.length || 0;
      setModeHint(`Saves the link and your selection (${n(words)} ${words === 1 ? "word" : "words"}) as a quote.`);
      break;
    }
    case "full":
      setModeHint(
        `Saves the link and the page's readable text (~${n(page.words)} words${page.truncated ? ", trimmed" : ""}).`,
      );
      break;
  }
}

// ------------------------------------------------------------------ duplicate check

async function checkDuplicate() {
  const url = state.tab?.url;
  if (!url || !/^https?:/.test(url)) return;
  try {
    const notes = await state.client.searchNotes(url, 5);
    const match = Array.isArray(notes) && notes.find((note) => (note.content || "").includes(url));
    if (match) {
      $("duplicate-link").href = state.client.noteUrl(match.id);
      $("duplicate").hidden = false;
    }
  } catch {
    // Non-essential; connection problems surface when saving.
  }
}

// ------------------------------------------------------------------ tags

async function loadTags() {
  try {
    const tags = await state.client.listTags();
    state.tags = Array.isArray(tags) ? tags : [];
    // Forget remembered tags that no longer exist.
    const known = new Set(state.tags.map((t) => t.id));
    for (const id of state.selectedTags) if (!known.has(id)) state.selectedTags.delete(id);
  } catch (err) {
    showError(err.message);
  }
  renderTags();
}

function renderTags() {
  const container = $("tags");
  const query = $("tag-input").value.trim();
  const q = query.toLowerCase();
  container.replaceChildren();

  // Selected tags first, then the rest; filter by the query.
  const visible = state.tags
    .filter((t) => !q || t.name.toLowerCase().includes(q))
    .sort((a, b) => Number(state.selectedTags.has(b.id)) - Number(state.selectedTags.has(a.id)));

  for (const tag of visible.slice(0, 40)) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "tag";
    chip.textContent = tag.name;
    chip.setAttribute("aria-pressed", String(state.selectedTags.has(tag.id)));
    chip.addEventListener("click", () => toggleTag(tag.id));
    container.append(chip);
  }

  const exact = state.tags.some((t) => t.name.toLowerCase() === q);
  if (query && !exact) {
    const create = document.createElement("button");
    create.type = "button";
    create.className = "tag create";
    create.textContent = `+ Create “${query}”`;
    create.addEventListener("click", () => createTag(query));
    container.append(create);
  }

  if (!container.children.length && !state.tags.length) {
    const empty = document.createElement("span");
    empty.className = "tags-empty";
    empty.textContent = "No tags yet. Type a name to create one.";
    container.append(empty);
  }
}

function toggleTag(id) {
  if (state.selectedTags.has(id)) state.selectedTags.delete(id);
  else state.selectedTags.add(id);
  renderTags();
}

async function createTag(name) {
  try {
    const tag = await state.client.createTag(name);
    state.tags.push(tag);
    state.tags.sort((a, b) => a.name.localeCompare(b.name));
    state.selectedTags.add(tag.id);
    $("tag-input").value = "";
    renderTags();
    $("tag-input").focus();
  } catch (err) {
    showError(err.message);
  }
}

// ------------------------------------------------------------------ colors

function renderColors() {
  const container = $("colors");
  for (const color of NOTE_COLORS) {
    const swatch = document.createElement("button");
    swatch.type = "button";
    swatch.className = `swatch${color.id ? "" : " default"}`;
    swatch.title = color.name;
    swatch.setAttribute("role", "radio");
    swatch.setAttribute("aria-label", color.name);
    swatch.style.setProperty("--swatch-bg", color.bg);
    swatch.style.setProperty("--swatch-border", color.border);
    swatch.addEventListener("click", () => setColor(color));
    swatch.dataset.id = color.id ?? "";
    container.append(swatch);
  }
  setColor(NOTE_COLORS[0]);
}

function setColor(color) {
  state.background = color.id;
  for (const el of $("colors").children) el.setAttribute("aria-checked", String(el.dataset.id === (color.id ?? "")));
  const card = $("note-card");
  if (color.id) {
    card.style.setProperty("--card-bg", color.bg);
    card.style.setProperty("--card-border", color.border);
  } else {
    card.style.removeProperty("--card-bg");
    card.style.removeProperty("--card-border");
  }
}

// ------------------------------------------------------------------ form

function wireForm() {
  const form = $("view-form");
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    save();
  });
  form.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      save();
    }
  });
  for (const input of document.querySelectorAll('input[name="mode"]')) input.addEventListener("change", updateModeHint);

  const tagInput = $("tag-input");
  tagInput.addEventListener("input", renderTags);
  tagInput.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" || e.ctrlKey || e.metaKey) return;
    e.preventDefault();
    const q = tagInput.value.trim();
    if (!q) return;
    const exact = state.tags.find((t) => t.name.toLowerCase() === q.toLowerCase());
    if (exact) {
      state.selectedTags.add(exact.id);
      tagInput.value = "";
      renderTags();
    } else {
      createTag(q);
    }
  });

  // Plain Enter in the title saves, like most "add" dialogs.
  $("title").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      save();
    }
  });

  const comment = $("comment");
  comment.addEventListener("input", () => {
    comment.style.height = "auto";
    comment.style.height = `${comment.scrollHeight}px`;
  });
}

async function save() {
  if (state.saving) return;
  hideError();
  state.saving = true;
  setSaving(true);
  try {
    const page = state.page ?? (await readTab(state.tab, { content: true }));
    const mode = page.restricted ? "link" : currentMode();
    const note = composeNote(page, mode, { title: $("title").value, comment: $("comment").value });
    const tagIds = [...state.selectedTags];
    const created = await state.client.createNote({
      ...note,
      tagIds,
      background: state.background,
      isPinned: $("pin").checked,
    });
    if (state.settings.rememberTags) await saveSettings({ lastTagIds: tagIds });

    $("done-title").textContent = note.title || page.url;
    const link = $("done-open");
    if (created?.id) link.href = state.client.noteUrl(created.id);
    else link.hidden = true;
    $("done-close").onclick = () => window.close();
    show("view-done");
    link.focus();
  } catch (err) {
    showError(err.message || String(err));
  } finally {
    state.saving = false;
    setSaving(false);
  }
}

function setSaving(on) {
  const btn = $("save");
  btn.disabled = on;
  btn.querySelector(".spinner").hidden = !on;
  btn.querySelector(".label").textContent = on ? "Saving…" : "Save note";
}

// ------------------------------------------------------------------ utils

function show(id) {
  for (const view of document.querySelectorAll(".view")) view.hidden = view.id !== id;
}

function showError(message) {
  const el = $("error");
  el.textContent = message;
  el.hidden = false;
  if ($("view-form").hidden && $("view-setup").hidden) show("view-form");
}
function hideError() {
  $("error").hidden = true;
}

function openSettings() {
  chrome.runtime.openOptionsPage();
  window.close();
}
function openTab(url) {
  chrome.tabs.create({ url });
  window.close();
}

function safeHost(url) {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
function displayUrl(url) {
  return String(url || "").replace(/^https?:\/\/(www\.)?/, "");
}
