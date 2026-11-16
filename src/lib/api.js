// Minimal client for the Anchor REST API (https://github.com/zhfahim/anchor).
// Authenticates with the personal API token from Anchor → Settings → API token,
// which the server accepts as a Bearer token on every /api/notes and /api/tags route.

export class AnchorError extends Error {
  constructor(message, { status = 0, cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = "AnchorError";
    this.status = status;
  }
}

const TIMEOUT_MS = 20000;

export class AnchorClient {
  constructor({ serverUrl, apiToken }) {
    this.serverUrl = String(serverUrl || "").replace(/\/+$/, "");
    this.apiToken = String(apiToken || "").trim();
  }

  async request(path, { method = "GET", body, query } = {}) {
    if (!this.serverUrl) throw new AnchorError("Set your Anchor server URL in the extension settings.");
    if (!this.apiToken) throw new AnchorError("Add your Anchor API token in the extension settings.");

    const url = new URL(`${this.serverUrl}${path}`);
    for (const [k, v] of Object.entries(query || {})) {
      if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let response;
    try {
      response = await fetch(url, {
        method,
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${this.apiToken}`,
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
        credentials: "omit",
      });
    } catch (cause) {
      const timedOut = cause?.name === "AbortError";
      throw new AnchorError(
        timedOut
          ? "Anchor server did not respond in time."
          : `Can't reach Anchor at ${this.serverUrl}. Check the URL and your connection.`,
        { cause },
      );
    } finally {
      clearTimeout(timer);
    }

    const text = await response.text();
    let data = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }

    if (!response.ok) throw new AnchorError(describeError(response.status, data), { status: response.status });
    return data;
  }

  listTags() {
    return this.request("/api/tags");
  }

  createTag(name) {
    return this.request("/api/tags", { method: "POST", body: { name } });
  }

  createNote({ title, content, tagIds, background, isPinned }) {
    const body = { title: title ?? "", content };
    if (tagIds?.length) body.tagIds = tagIds;
    if (background) body.background = background;
    if (isPinned) body.isPinned = true;
    return this.request("/api/notes", { method: "POST", body });
  }

  /** Active notes whose title or stored content contains `search`. */
  searchNotes(search, limit = 5) {
    return this.request("/api/notes", { query: { search, limit } });
  }

  /** Lightweight authenticated call used to validate URL + token. */
  async testConnection() {
    const tags = await this.listTags();
    return { tagCount: Array.isArray(tags) ? tags.length : 0 };
  }

  noteUrl(id) {
    return `${this.serverUrl}/notes/${encodeURIComponent(id)}`;
  }
}

function describeError(status, data) {
  const serverMessage = Array.isArray(data?.message) ? data.message.join(", ") : data?.message;
  if (status === 401) {
    if (/pending/i.test(serverMessage || "")) return "Your Anchor account is pending approval.";
    return "Anchor rejected the API token. Generate one in Anchor → Settings → API token.";
  }
  if (status === 404) return "Anchor API not found at this URL. Check the server URL.";
  if (status === 413) return "This page is too large to save. Try saving just the link or a selection.";
  if (status === 426) return serverMessage || "Your Anchor server version is not compatible.";
  if (status >= 500) return `Anchor server error (${status}). Try again later.`;
  return serverMessage ? `Anchor: ${serverMessage}` : `Request failed (${status}).`;
}
