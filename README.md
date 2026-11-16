# Save to Anchor: browser extension

Save web pages as notes in your self-hosted [Anchor](https://github.com/zhfahim/anchor) server.
Works in **Chrome, Edge, Brave** and other Chromium browsers, and in **Firefox** (128+).

- **Toolbar popup** (`Alt+Shift+A`): edit the title, add a comment, choose what to capture, pick or create tags, set a note color, pin.
- **Three capture modes**
  - **Link**: the page link plus its description.
  - **Selection**: your highlighted text as a quote, with formatting and links preserved.
  - **Full page**: the readable article text (headings, paragraphs, lists, quotes, code blocks, links), without menus, sidebars and footers.
- **Right-click menus**: *Save page*, *Save page with full text*, *Save selection*, *Save link*.
- **Quick save** (`Alt+Shift+S`) saves the current page without opening the popup.
- **Already saved?** The popup tells you when you've saved the page before and links to that note.
- Notes are written in Anchor's native rich-text format, so they look and edit like any other note, on web and mobile.

## Setup

1. **Get an API token.** In Anchor, open **Settings → API token** and click **Generate**. Copy the token.
2. **Install the extension** (see below).
3. The settings page opens on install (you can reopen it from the popup's ⚙ button). The server URL is prefilled
   with `https://app-anchor.igjkkb.easypanel.host`. Paste your token and click **Save & test connection**.
   Allow access to your server when the browser asks.

## Install

### Chrome / Edge / Brave (unpacked)

1. Open `chrome://extensions` (Edge: `edge://extensions`).
2. Turn on **Developer mode**.
3. Click **Load unpacked** and select this folder (the one containing `manifest.json`).
4. Optional: pin the extension to the toolbar using the puzzle-piece menu.

### Firefox

- **Temporary install** (removed on restart): open `about:debugging#/runtime/this-firefox`, click
  **Load Temporary Add-on…** and pick `manifest.json`.
- **Permanent install:** Firefox only installs permanently from signed add-ons. Run `npm run package`, upload
  `dist/save-to-anchor-*-firefox.zip` to [addons.mozilla.org](https://addons.mozilla.org/developers/) as an
  **unlisted** add-on (signed automatically, never published), then install the signed `.xpi` it returns.

## Development

Requires Node 18+. There are no npm dependencies.

```sh
npm test          # unit tests for the note builder
npm run package   # builds dist/save-to-anchor-<version>-chrome.zip and -firefox.zip
npm run icons     # regenerates icons/*.png
```

```
manifest.json          MV3 manifest (Chromium + Firefox)
src/background.js      context menus, quick-save shortcut, notifications
src/popup/             toolbar popup
src/options/           settings page
src/lib/api.js         Anchor REST client (Bearer API token)
src/lib/extract.js     in-page extractor: metadata, selection, readable content
src/lib/delta.js       converts extracted blocks to Anchor's Quill Delta note content
src/lib/capture.js     glue: read tab → compose note
```

### How it talks to Anchor

| Purpose           | Request                                             |
| ----------------- | --------------------------------------------------- |
| Test connection   | `GET /api/tags`                                     |
| List / create tag | `GET /api/tags`, `POST /api/tags {name}`            |
| Duplicate check   | `GET /api/notes?search=<url>&limit=5`               |
| Save note         | `POST /api/notes {title, content, tagIds, background, isPinned}` |

All requests send `Authorization: Bearer <API token>`. `content` is a Quill Delta serialized as
`{"ops":[...]}`, the same format Anchor's editors store.

## Privacy

The extension reads a page only when you save it (popup, context menu or shortcut). Data goes only to the Anchor server you
configure. The token is stored in the browser's local extension storage. Nothing else is collected or sent anywhere.

## Troubleshooting

- **"Anchor rejected the API token"**: the token was revoked or regenerated. Generate a new one in Anchor.
- **"Can't reach Anchor"**: check the URL opens in your browser. If your server sets `CORS_ORIGINS`, make sure
  you allowed host access when saving the settings (the extension requests it for your server's origin).
- **Full page / Selection greyed out**: browsers don't let extensions read some pages (browser settings pages,
  extension stores, built-in PDF viewer). Only the link can be saved there.

## License

[GNU AGPL v3.0](LICENSE)
