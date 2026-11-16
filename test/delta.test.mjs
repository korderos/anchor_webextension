import { test } from "node:test";
import assert from "node:assert/strict";
import { blockToOps, buildDelta, compactOps, serializeDelta, shortenUrl } from "../src/lib/delta.js";
import { normalizeServerUrl } from "../src/lib/settings.js";
import { composeNote, selectionTextToBlocks } from "../src/lib/capture.js";

const text = (delta) => delta.ops.map((o) => o.insert).join("");

test("link-only note: link line with full URL attribute and description", () => {
  const delta = buildDelta({ url: "https://www.example.com/a/b?q=1", description: "A page." });
  assert.deepEqual(delta.ops, [
    { insert: "🔗 " },
    { insert: "example.com/a/b?q=1", attributes: { link: "https://www.example.com/a/b?q=1" } },
    { insert: "\n" },
    { insert: "A page.", attributes: { italic: true } },
    { insert: "\n" },
  ]);
});

test("always ends with a newline, even when empty", () => {
  assert.deepEqual(buildDelta({}).ops, [{ insert: "\n" }]);
});

test("comment comes first, keeps its line breaks", () => {
  const delta = buildDelta({ comment: "Read later\nfor the talk", url: "https://x.dev" });
  assert.ok(text(delta).startsWith("Read later\nfor the talk\n🔗 "));
});

test("headers, lists with indent, code blocks, inline formats", () => {
  const ops = compactOps([
    ...blockToOps({ type: "h", level: 2, runs: [{ text: "Intro" }] }),
    ...blockToOps({ type: "p", runs: [{ text: "Hello " }, { text: "bold", bold: true }, { text: " " }, { text: "link", link: "https://a.b" }] }),
    ...blockToOps({ type: "li", ordered: false, indent: 0, runs: [{ text: "one" }] }),
    ...blockToOps({ type: "li", ordered: true, indent: 2, runs: [{ text: "two" }] }),
    ...blockToOps({ type: "code", runs: [{ text: "a = 1\nb = 2" }] }),
  ]);
  assert.deepEqual(ops, [
    { insert: "Intro" },
    { insert: "\n", attributes: { header: 2 } },
    { insert: "Hello " },
    { insert: "bold", attributes: { bold: true } },
    { insert: " " },
    { insert: "link", attributes: { link: "https://a.b" } },
    { insert: "\none" },
    { insert: "\n", attributes: { list: "bullet" } },
    { insert: "two" },
    { insert: "\n", attributes: { list: "ordered", indent: 2 } },
    { insert: "a = 1" },
    { insert: "\n", attributes: { "code-block": "plain" } },
    { insert: "b = 2" },
    { insert: "\n", attributes: { "code-block": "plain" } },
  ]);
});

test("line-format newlines are never merged with following text", () => {
  const ops = compactOps([
    { insert: "\n", attributes: { header: 1 } },
    { insert: "\n", attributes: { header: 1 } },
  ]);
  assert.equal(ops.length, 2);
});

test("selection is rendered as blockquote lines, overriding list/header formats", () => {
  const delta = buildDelta({
    selection: [
      { type: "p", runs: [{ text: "quoted" }] },
      { type: "li", ordered: true, runs: [{ text: "item" }] },
    ],
  });
  const newlines = delta.ops.filter((o) => o.insert === "\n");
  assert.ok(newlines.every((o) => o.attributes?.blockquote === true));
});

test("embedded line breaks split a block into lines with the same format", () => {
  const ops = blockToOps({ type: "li", runs: [{ text: "a\nb" }] });
  assert.deepEqual(ops, [
    { insert: "a" },
    { insert: "\n", attributes: { list: "bullet" } },
    { insert: "b" },
    { insert: "\n", attributes: { list: "bullet" } },
  ]);
});

test("drops a leading heading that repeats the title", () => {
  const delta = buildDelta({
    title: "My Post | Blog",
    blocks: [
      { type: "h", level: 1, runs: [{ text: "My  Post" }] },
      { type: "p", runs: [{ text: "Body" }] },
    ],
  });
  assert.equal(text(delta), "Body\n");
});

test("header level is clamped to 1-3 and control characters are stripped", () => {
  const ops = blockToOps({ type: "h", level: 6, runs: [{ text: "T\x07itle" }] });
  assert.deepEqual(ops, [{ insert: "Title" }, { insert: "\n", attributes: { header: 3 } }]);
});

test("truncation marker is appended to page content", () => {
  const delta = buildDelta({ blocks: [{ type: "p", runs: [{ text: "x" }] }], truncated: true });
  assert.ok(text(delta).includes("[Content truncated]"));
});

test("serialized content matches the Anchor storage format", () => {
  const json = serializeDelta(buildDelta({ url: "https://x.dev" }));
  const parsed = JSON.parse(json);
  assert.deepEqual(Object.keys(parsed), ["ops"]);
  // Anchor's search does a substring match on stored content: the raw URL must appear.
  assert.ok(json.includes("https://x.dev"));
});

test("shortenUrl strips scheme and truncates", () => {
  assert.equal(shortenUrl("https://www.a.com/x"), "a.com/x");
  assert.equal(shortenUrl(`https://a.com/${"x".repeat(200)}`).length, 80);
});

test("composeNote picks content by mode", () => {
  const page = {
    title: "  Page   title ",
    url: "https://p.dev",
    description: "desc",
    selection: { text: "sel", blocks: selectionTextToBlocks("sel one\n\nsel two") },
    blocks: [{ type: "p", runs: [{ text: "full body" }] }],
  };
  const link = composeNote(page, "link");
  assert.equal(link.title, "Page title");
  assert.ok(link.content.includes("desc") && !link.content.includes("full body") && !link.content.includes("sel one"));

  const sel = composeNote(page, "selection");
  assert.ok(sel.content.includes("sel two") && !sel.content.includes("desc"));

  const full = composeNote(page, "full", { title: "Custom", comment: "mine" });
  assert.equal(full.title, "Custom");
  assert.ok(full.content.includes("full body") && full.content.includes("mine"));
});

test("normalizeServerUrl", () => {
  assert.equal(normalizeServerUrl("app-anchor.igjkkb.easypanel.host/"), "https://app-anchor.igjkkb.easypanel.host");
  assert.equal(normalizeServerUrl("https://x.dev/api/"), "https://x.dev");
  assert.equal(normalizeServerUrl("http://localhost:3000/notes"), "http://localhost:3000/notes");
  assert.equal(normalizeServerUrl("  "), "");
});
