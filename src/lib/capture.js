import { extractPage } from "./extract.js";
import { buildDelta, serializeDelta } from "./delta.js";

/**
 * Reads metadata, selection and readable content from a tab. Falls back to the
 * tab's title/URL on pages extensions can't script (browser pages, stores, PDFs).
 */
export async function readTab(tab, { content = true } = {}) {
  try {
    const [injection] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: extractPage,
      args: [{ content }],
    });
    if (injection?.result) return { ...injection.result, restricted: false };
  } catch {
    // Not scriptable: fall through.
  }
  return {
    title: tab.title || tab.url || "",
    url: tab.url || "",
    description: "",
    siteName: "",
    selection: null,
    blocks: [],
    words: 0,
    truncated: false,
    restricted: true,
  };
}

/** Plain-text selection (e.g. from a context menu) as blocks. */
export function selectionTextToBlocks(text) {
  return String(text || "")
    .split(/\n{2,}/)
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t) => ({ type: "p", runs: [{ text: t }] }));
}

/**
 * @param {object} page   result of readTab()
 * @param {"link"|"selection"|"full"} mode
 * @returns {{title: string, content: string}}
 */
export function composeNote(page, mode, { title, comment } = {}) {
  const finalTitle = String(title ?? page.title ?? "").replace(/\s+/g, " ").trim();
  const delta = buildDelta({
    title: finalTitle,
    comment,
    url: page.url,
    description: mode === "selection" ? "" : page.description,
    selection: mode === "selection" ? page.selection?.blocks : null,
    blocks: mode === "full" ? page.blocks : null,
    truncated: mode === "full" && page.truncated,
  });
  return { title: finalTitle, content: serializeDelta(delta) };
}
