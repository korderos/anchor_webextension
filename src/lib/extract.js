// Runs INSIDE the web page via chrome.scripting.executeScript({ func: extractPage }).
// It must stay fully self-contained: no imports, no references to outer scope.
//
// Returns page metadata, the current selection and (optionally) the readable
// article content as structured blocks:
//   { type: "p" | "h" | "li" | "code", runs: [{ text, link?, bold?, italic?, underline?, strike? }],
//     level?, ordered?, indent?, quote? }

export function extractPage(options = {}) {
  const MAX_CHARS = options.maxChars ?? 60000;
  const wantContent = options.content !== false;

  const SKIP_TAGS = new Set([
    "SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "SVG", "CANVAS", "IFRAME", "OBJECT", "EMBED",
    "VIDEO", "AUDIO", "NAV", "FOOTER", "ASIDE", "FORM", "BUTTON", "SELECT", "INPUT", "TEXTAREA",
    "DIALOG", "MENU", "IMG", "PICTURE", "MATH", "LINK", "META", "HEAD",
  ]);
  const INLINE_TAGS = new Set([
    "A", "ABBR", "B", "BDI", "BDO", "BIG", "CITE", "CODE", "DATA", "DEL", "DFN", "EM", "FONT", "I",
    "INS", "KBD", "LABEL", "MARK", "Q", "S", "SAMP", "SMALL", "SPAN", "STRIKE", "STRONG", "SUB",
    "SUP", "TIME", "TT", "U", "VAR", "WBR",
  ]);
  const BLOCK_SELECTOR =
    "address,article,blockquote,div,dl,fieldset,figure,h1,h2,h3,h4,h5,h6,header,hr,li,main,ol,p,pre,section,table,ul";
  const SKIP_ROLES = new Set([
    "navigation", "banner", "contentinfo", "complementary", "search", "dialog", "alertdialog",
    "menu", "menubar", "toolbar", "tablist",
  ]);
  const NOISE_TOKEN =
    /^(comments?|share|sharing|social|related|newsletter|subscribe|advert|advertisement|ads?|sponsor|sponsored|cookie|cookies|breadcrumbs?|sidebar|promo|paywall|popup|modal)([-_]|$)/i;

  let total = 0;
  let truncated = false;

  // ---------------------------------------------------------------- helpers

  const meta = (...names) => {
    for (const n of names) {
      const el = document.querySelector(`meta[name="${n}"], meta[property="${n}"]`);
      const v = el?.getAttribute("content")?.trim();
      if (v) return v;
    }
    return "";
  };

  function isNoise(el) {
    const tokens = `${typeof el.className === "string" ? el.className : ""} ${el.id || ""}`.split(/\s+/);
    return tokens.some((t) => t && NOISE_TOKEN.test(t));
  }

  function shouldSkip(el, lenient) {
    const tag = el.tagName.toUpperCase();
    if (SKIP_TAGS.has(tag)) return true;
    if (el.hidden || el.getAttribute("aria-hidden") === "true") return true;
    const role = el.getAttribute("role");
    if (role && SKIP_ROLES.has(role)) return true;
    if (lenient) return false;
    if (isNoise(el)) return true;
    if (el.isConnected) {
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden") return true;
    }
    return false;
  }

  function inlineFormat(el, fmt) {
    const tag = el.tagName.toUpperCase();
    const next = { ...fmt };
    if (tag === "A") {
      const href = el.href;
      if (href && /^(https?|mailto):/i.test(href)) next.link = href;
    } else if (tag === "B" || tag === "STRONG") next.bold = true;
    else if (tag === "I" || tag === "EM" || tag === "CITE" || tag === "DFN") next.italic = true;
    else if (tag === "U" || tag === "INS") next.underline = true;
    else if (tag === "S" || tag === "DEL" || tag === "STRIKE") next.strike = true;
    return next;
  }

  function pushText(runs, raw, fmt) {
    const text = raw.replace(/[\s\u200b\u00ad]+/g, " ");
    if (text) runs.push({ text, ...fmt });
  }

  // Rendered children: open shadow roots replace light DOM; slots yield their assigned nodes.
  function kids(node) {
    if (node.shadowRoot) return node.shadowRoot.childNodes;
    if (node.tagName === "SLOT") {
      const assigned = node.assignedNodes({ flatten: true });
      return assigned.length ? assigned : node.childNodes;
    }
    return node.childNodes;
  }

  // Flattens an element's content into inline runs. Nested lists are left to the
  // caller (list items), other nested blocks are joined with a space.
  function collectInline(node, fmt, runs, ctx) {
    for (const child of kids(node)) {
      if (child.nodeType === Node.TEXT_NODE) {
        pushText(runs, child.nodeValue, fmt);
        continue;
      }
      if (child.nodeType !== Node.ELEMENT_NODE || shouldSkip(child, ctx.lenient)) continue;
      const tag = child.tagName.toUpperCase();
      if (tag === "BR") {
        runs.push({ text: "\n" });
        continue;
      }
      if (ctx.skipLists && (tag === "UL" || tag === "OL")) continue;
      const isBlock = !INLINE_TAGS.has(tag);
      if (isBlock) runs.push({ text: " " });
      collectInline(child, inlineFormat(child, fmt), runs, ctx);
      if (isBlock) runs.push({ text: " " });
    }
    return runs;
  }

  const sameFormat = (a, b) =>
    a.link === b.link && !!a.bold === !!b.bold && !!a.italic === !!b.italic &&
    !!a.underline === !!b.underline && !!a.strike === !!b.strike;

  // Merges runs, collapses spaces across run boundaries and trims each line.
  function tidy(runs) {
    const out = [];
    for (const r of runs) {
      if (!r.text) continue;
      const prev = out[out.length - 1];
      let text = r.text;
      if (prev && /[ \n]$/.test(prev.text)) text = text.replace(/^ +/, "");
      if (!text) continue;
      if (text === "\n" && prev) prev.text = prev.text.replace(/ +$/, "");
      if (prev && sameFormat(prev, r)) prev.text += text;
      else out.push({ ...r, text });
    }
    if (out.length) {
      out[0].text = out[0].text.replace(/^[ \n]+/, "");
      const last = out[out.length - 1];
      last.text = last.text.replace(/[ \n]+$/, "");
    }
    return out.filter((r) => r.text);
  }

  function addBlock(blocks, block, ctx) {
    if (total >= MAX_CHARS) {
      truncated = true;
      return;
    }
    if (block.type !== "code") block.runs = tidy(block.runs);
    const len = block.runs.reduce((n, r) => n + r.text.length, 0);
    if (!block.runs.some((r) => r.text.trim())) return;
    if (ctx.quote) block.quote = true;
    total += len;
    blocks.push(block);
  }

  function list(el, blocks, ctx, depth) {
    const ordered = el.tagName.toUpperCase() === "OL";
    for (const li of el.children) {
      if (total >= MAX_CHARS) break;
      if (li.tagName.toUpperCase() !== "LI" || shouldSkip(li, ctx.lenient)) continue;
      const runs = collectInline(li, {}, [], { ...ctx, skipLists: true });
      addBlock(blocks, { type: "li", ordered, indent: Math.min(depth, 7), runs }, ctx);
      for (const nested of li.querySelectorAll("ul, ol")) {
        if (nested.parentElement?.closest("li") === li) list(nested, blocks, ctx, depth + 1);
      }
    }
  }

  function table(el, blocks, ctx) {
    let rows = 0;
    for (const tr of el.querySelectorAll("tr")) {
      if (tr.closest("table") !== el) continue; // nested tables are read through their cell
      if (rows++ > 300 || total >= MAX_CHARS) break;
      const runs = [];
      [...tr.cells].forEach((cell, i) => {
        if (i) runs.push({ text: " | " });
        const cellRuns = collectInline(cell, cell.tagName === "TH" ? { bold: true } : {}, [], ctx);
        runs.push(...cellRuns.map((r) => (r.text === "\n" ? { ...r, text: " " } : r)));
      });
      addBlock(blocks, { type: "p", runs }, ctx);
    }
  }

  function walk(el, blocks, ctx) {
    let buf = [];
    const flush = () => {
      if (buf.length) addBlock(blocks, { type: "p", runs: buf }, ctx);
      buf = [];
    };
    for (const child of kids(el)) {
      if (total >= MAX_CHARS) {
        truncated = true;
        break;
      }
      if (child.nodeType === Node.TEXT_NODE) {
        pushText(buf, child.nodeValue, {});
        continue;
      }
      if (child.nodeType !== Node.ELEMENT_NODE || shouldSkip(child, ctx.lenient)) continue;
      const tag = child.tagName.toUpperCase();

      if (tag === "BR") {
        buf.push({ text: "\n" });
        continue;
      }
      if (INLINE_TAGS.has(tag) && !child.shadowRoot && !child.querySelector(BLOCK_SELECTOR)) {
        collectInline(child, inlineFormat(child, {}), buf, ctx);
        continue;
      }

      flush();
      if (/^H[1-6]$/.test(tag)) {
        const runs = collectInline(child, {}, [], ctx);
        addBlock(blocks, { type: "h", level: Math.min(Number(tag[1]), 3), runs }, ctx);
      } else if (tag === "P") {
        addBlock(blocks, { type: "p", runs: collectInline(child, {}, [], ctx) }, ctx);
      } else if (tag === "UL" || tag === "OL") {
        list(child, blocks, ctx, 0);
      } else if (tag === "BLOCKQUOTE") {
        walk(child, blocks, { ...ctx, quote: true });
      } else if (tag === "PRE") {
        const text = (child.innerText ?? child.textContent ?? "").replace(/\r\n?/g, "\n").replace(/\n+$/, "");
        if (text.trim()) addBlock(blocks, { type: "code", runs: [{ text }] }, ctx);
      } else if (tag === "TABLE") {
        table(child, blocks, ctx);
      } else if (tag !== "HR") {
        walk(child, blocks, ctx);
      }
    }
    flush();
    return blocks;
  }

  // Readability-lite: score every prose element by its non-link text (links-heavy
  // menus and footers score low), add it to all ancestors, then pick the deepest
  // element that still holds most of the page's prose.
  function pickRoot() {
    const body = document.body;
    if (!body) return null;
    const explicit = document.querySelector('[itemprop="articleBody"]');
    if (explicit && explicit.textContent.trim().length > 200) return explicit;

    const CHROME = "nav, footer, aside, [role=navigation], [role=banner], [role=contentinfo], [role=complementary]";
    const scores = new Map();
    for (const el of body.querySelectorAll("p, pre, blockquote, h2, h3, h4, li, dd, td")) {
      if (el.closest(CHROME)) continue;
      if ((el.tagName === "LI" || el.tagName === "TD" || el.tagName === "DD") && el.querySelector("p, li, pre")) continue;
      const len = el.textContent.trim().length;
      if (len < 20) continue;
      let linkLen = 0;
      for (const a of el.querySelectorAll("a")) linkLen += a.textContent.trim().length;
      const weight = Math.max(0, len - linkLen * 1.5);
      if (!weight) continue;
      for (let node = el.parentElement; node; node = node.parentElement) {
        scores.set(node, (scores.get(node) || 0) + weight);
        if (node === body) break;
      }
    }
    const total = scores.get(body) || 0;
    if (total < 200) return document.querySelector("main, [role=main], article") || body;

    let best = body;
    let bestDepth = 0;
    for (const [el, score] of scores) {
      if (score < total * 0.7) continue;
      let depth = 0;
      for (let n = el; n && n !== body; n = n.parentElement) depth++;
      if (depth > bestDepth) {
        best = el;
        bestDepth = depth;
      }
    }
    // Pull in an intro/lede that sits beside the body inside the same article/main.
    const container = best.parentElement?.closest("article, main, [role=main]");
    if (container && (scores.get(container) || 0) <= (scores.get(best) || 0) * 1.3) return container;
    return best;
  }

  // ---------------------------------------------------------------- output

  const title = (document.title || meta("og:title", "twitter:title") || location.hostname).trim();
  const description = meta("description", "og:description", "twitter:description");
  const siteName = meta("og:site_name", "application-name");

  let selection = null;
  const sel = window.getSelection?.();
  if (sel && !sel.isCollapsed && sel.rangeCount) {
    const text = sel.toString().trim();
    if (text) {
      const container = document.createElement("div");
      for (let i = 0; i < sel.rangeCount; i++) container.appendChild(sel.getRangeAt(i).cloneContents());
      let blocks = walk(container, [], { lenient: true });
      if (!blocks.length) {
        blocks = text.split(/\n{2,}/).map((t) => ({ type: "p", runs: [{ text: t.trim() }] }));
      }
      selection = { text, blocks };
      total = 0;
      truncated = false;
    }
  }

  let blocks = [];
  if (wantContent) {
    const root = pickRoot();
    if (root) blocks = walk(root, [], {});
  }

  const words = blocks.reduce((n, b) => n + b.runs.reduce((m, r) => m + (r.text.match(/\S+/g)?.length || 0), 0), 0);

  return {
    title,
    url: location.href,
    description,
    siteName,
    selection,
    blocks,
    words,
    truncated,
  };
}
