// Builds Anchor note content: a Quill Delta serialized as {"ops":[...]}, the
// canonical storage format of the Anchor web/mobile editors. Only formats the
// Anchor editor supports are emitted: bold, italic, underline, strike, link,
// header (1-3), list (bullet/ordered), indent, blockquote, code-block.

const CONTROL_CHARS = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;

const clean = (text) => String(text ?? "").replace(/\r\n?/g, "\n").replace(CONTROL_CHARS, "");

function inlineAttributes(run) {
  const attrs = {};
  if (run.bold) attrs.bold = true;
  if (run.italic) attrs.italic = true;
  if (run.underline) attrs.underline = true;
  if (run.strike) attrs.strike = true;
  if (run.link) attrs.link = run.link;
  return Object.keys(attrs).length ? attrs : undefined;
}

function lineAttributes(block) {
  if (block.quote) return { blockquote: true };
  switch (block.type) {
    case "h":
      return { header: Math.max(1, Math.min(3, Number(block.level) || 2)) };
    case "li": {
      const attrs = { list: block.ordered ? "ordered" : "bullet" };
      if (block.indent > 0) attrs.indent = Math.min(block.indent, 7);
      return attrs;
    }
    case "code":
      return { "code-block": "plain" };
    default:
      return undefined;
  }
}

const op = (insert, attributes) => (attributes ? { insert, attributes } : { insert });

/** Converts one extracted block into Delta ops. Embedded "\n" start new lines with the same line format. */
export function blockToOps(block) {
  const lineAttrs = lineAttributes(block);
  const ops = [];

  if (block.type === "code" && !block.quote) {
    const text = clean(block.runs.map((r) => r.text).join(""));
    for (const line of text.split("\n")) {
      if (line) ops.push(op(line));
      ops.push(op("\n", lineAttrs));
    }
    return ops;
  }

  let lineHasText = false;
  for (const run of block.runs) {
    const parts = clean(run.text).split("\n");
    parts.forEach((part, i) => {
      if (i > 0) {
        if (lineHasText) ops.push(op("\n", lineAttrs));
        lineHasText = false;
      }
      if (part) {
        ops.push(op(part, inlineAttributes(run)));
        if (part.trim()) lineHasText = true;
      }
    });
  }
  if (lineHasText) ops.push(op("\n", lineAttrs));
  return ops;
}

const sameAttributes = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** Merges adjacent text inserts that share attributes (what Quill does itself). */
export function compactOps(ops) {
  const out = [];
  for (const o of ops) {
    const prev = out[out.length - 1];
    // Never merge into a line-formatted "\n": its attributes describe that line only.
    if (prev && sameAttributes(prev.attributes, o.attributes) && !prev.attributes?.header &&
        !prev.attributes?.list && !prev.attributes?.blockquote && !prev.attributes?.["code-block"]) {
      prev.insert += o.insert;
    } else {
      out.push({ ...o });
    }
  }
  return out;
}

const paragraph = (text, run = {}) => blockToOps({ type: "p", runs: [{ ...run, text }] });

export function shortenUrl(url, max = 80) {
  const display = String(url).replace(/^https?:\/\/(www\.)?/i, "");
  return display.length > max ? `${display.slice(0, max - 1)}…` : display;
}

const normalize = (s) => String(s ?? "").replace(/\s+/g, " ").trim().toLowerCase();

/**
 * @param {object} p
 * @param {string} [p.title]       note title, used to drop a duplicated leading heading
 * @param {string} [p.comment]     the user's own text, placed first
 * @param {string} [p.url]         source page, rendered as a link line
 * @param {string} [p.description] page meta description
 * @param {Array}  [p.selection]   selected blocks, rendered as a quote
 * @param {Array}  [p.blocks]      full page content blocks
 * @param {boolean}[p.truncated]   whether page content was cut at the size limit
 * @returns {{ops: Array}}
 */
export function buildDelta({ title, comment, url, description, selection, blocks, truncated } = {}) {
  const ops = [];

  const commentText = clean(comment).trim();
  if (commentText) {
    for (const line of commentText.split("\n")) {
      ops.push(...(line.trim() ? paragraph(line) : [op("\n")]));
    }
  }

  if (url) ops.push(op("🔗 "), op(shortenUrl(url), { link: url }), op("\n"));

  const desc = clean(description).trim();
  if (desc) ops.push(...paragraph(desc, { italic: true }));

  for (const block of selection || []) ops.push(...blockToOps({ ...block, quote: true }));

  const content = [...(blocks || [])];
  const first = content[0];
  // Pages usually repeat the title as their first heading ("Post" vs tab title "Post | Blog").
  const firstHeading = first?.type === "h" ? normalize(first.runs.map((r) => r.text).join("")) : "";
  if (firstHeading && title && normalize(title).includes(firstHeading)) content.shift();
  for (const block of content) ops.push(...blockToOps(block));
  if (truncated && content.length) ops.push(...paragraph("[Content truncated]", { italic: true }));

  if (!ops.length || ops[ops.length - 1].insert.endsWith?.("\n") !== true) ops.push(op("\n"));
  return { ops: compactOps(ops) };
}

export const serializeDelta = (delta) => JSON.stringify({ ops: delta.ops });
