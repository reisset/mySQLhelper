# Vendored frontend libraries

When upgrading a library here, replace the file, update this table, and bump the
app version in `pyproject.toml` — the service worker caches `/static/lib/` cache-first,
keyed by app version, so users only get the new file after a version bump.

| File | Library | Version | Source |
|------|---------|---------|--------|
| `purify.min.js` | DOMPurify | 3.4.11 | https://raw.githubusercontent.com/cure53/DOMPurify/3.4.11/dist/purify.min.js |
| `highlight.min.js` | Highlight.js | 11.11.1 | https://cdn.jsdelivr.net/npm/@highlightjs/cdn-assets@11.11.1/highlight.min.js |
| `styles/atom-one-dark.min.css` | Highlight.js theme | 11.11.1 | https://cdn.jsdelivr.net/npm/@highlightjs/cdn-assets@11.11.1/styles/atom-one-dark.min.css |
| `marked.min.js` | Marked | 17.0.1 | https://cdn.jsdelivr.net/npm/marked@17.0.1/marked.min.js |
| `gridjs.umd.js` | Grid.js | 6.2.0 | https://cdn.jsdelivr.net/npm/gridjs@6.2.0/dist/gridjs.umd.js |

Notes:
- DOMPurify is the XSS boundary for all LLM-rendered markdown (`ui.js` renderText).
  Keep it current — sanitizer-bypass CVEs are published regularly.
- Marked 18.x is a major release; 17.0.1 kept deliberately (verify `marked.parse`
  + custom highlight hook still work before crossing majors).
- Grid.js verified byte-identical to the official 6.2.0 UMD build (2026-07).
