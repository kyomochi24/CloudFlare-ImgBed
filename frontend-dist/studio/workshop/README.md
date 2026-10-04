# 丘丘美化工坊

A static, isolated SillyTavern appearance editor. SPDX-License-Identifier: AGPL-3.0-or-later (except separately licensed third-party fonts and Font Awesome files).

## Files

- `index.html`, `editor.css`, `editor.js`: responsive editor, dimensions/zoom, theme/project import and export, IndexedDB draft, read-only Studio album picker.
- `core.mjs`: pure import/export, viewport normalization, image URL validation and reversible avatar CSS patches.
- `frame.html`: selected DOM fragments from SillyTavern 1.19.0 commit `06bde939fb1e9c4c8d8641d810f0a916b5bce127`; simplified drawer contents.
- `frame.css`, `frame.js`: preview-only glue and simulated UI state. No SillyTavern API or original chat runtime is loaded.
- `vendor/sillytavern`: upstream style files and fonts. Two fonts are also embedded as data URLs in CSS because the sandbox has an opaque origin. The original standalone font bytes are retained.
- `NOTICE.html`, `licenses`: attribution, changes, scope and license texts.
- `workshop-source.zip`: corresponding source archive for users. Rebuild it whenever changing this module. Exclude the archive itself to avoid recursion; retain all editable files and third-party notices.

Serve over HTTP(S), not by opening index.html from file://. Place this directory at `/studio/workshop/`. The existing root Studio index only needs a link to this path. CSS previews and drafts work without signing in; the album picker requires an existing same-origin Studio login.

The sandbox has only `allow-scripts`, with no same-origin privilege. Parent/frame messages validate the source window and per-load channel. Only the trusted frame runtime has a CSP nonce. Imported CSS is assigned via `textContent`; sample text is escaped and passed through a deliberately limited formatter. Frames cannot fetch APIs or submit forms. External stylesheet/image/font references are still loaded as resources when supplied by the theme.

The UI explicitly separates viewport size from display scale. CSS breakpoints use iframe CSS-pixel dimensions, including when the display scale is 50%. Browser engine, device pixel ratio, OS keyboard and Tauri are not emulated.

User exports preserve unknown theme fields. Preview-only settings are saved in `.workshop.json` files, not SillyTavern theme JSON. Current IndexedDB draft is local to one browser and origin; users should export backups.

## Verification (2026-10-04)

- 7 Node tests: theme field preservation, project roundtrip, invalid JSON handling, scoped/reversible avatar rules, viewport limits, image URL filtering and sandbox configuration.
- Chromium browser checks at 1500×1000 and 390×844: CSS updates, real viewport breakpoints, zoom independence, user/parent CSS isolation, blocked parent DOM access, HTML/script text not executed, local font/icon loading, theme JSON roundtrip, avatar adjustments, element picking, menus/edit state, refresh/draft persistence, mobile tabs, scroll preservation, and album UI against mocked read-only API responses.
- No browser page/console errors or failed HTTP requests during these checks.
- Existing Studio homepage verified to differ only by the new navigation link.
- The real production album login/API and iOS Safari/Tauri have not been exercised by these local checks.

This package does not deploy or push changes to the original repository.
