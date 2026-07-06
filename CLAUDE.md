# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Running the App

```bash
# End users (installed via pipx)
yoursqlfriend                   # Launch on default port 5000
yoursqlfriend --port 8080       # Custom port
yoursqlfriend --no-browser      # Don't auto-open browser

# Developer (from git clone)
./run.sh                        # Linux/macOS
run.bat                         # Windows

# Or manually
source venv/bin/activate
pip install -e .
python -m yoursqlfriend.app
```

## Architecture

**Single-page Flask app** with vanilla JS frontend. No build step, no bundler, no framework. Installable as a PWA from Chrome/Edge/Brave. Distributed via PyPI (`pipx install yoursqlfriend`).

UI is a three-pane **Forensic Atelier** workbench: left pane = schema browser + in-session query history, center = conversation (chat + inline SQL + result tables), right = Row Inspector. Header carries the instrument cluster (model pill + ctx bar + theme toggle + settings gear). The settings popover hosts Provider/Model selectors, Replace DB, and Export. Charts, schema-diagram, and notes features were removed in the redesign.

- `src/yoursqlfriend/app.py` — Flask routes, session management, HTML export
- `src/yoursqlfriend/validation.py` — `validate_sql()`, `strip_strings_and_comments()` (SQL security boundary)
- `src/yoursqlfriend/llm.py` — LLM provider abstraction, prompts, streaming/non-streaming calls
- `src/yoursqlfriend/database.py` — Read-only connections, query execution, file hashing, upload handling
- `src/yoursqlfriend/static/js/` — ES modules: `app.js` (entry), `state.js`, `ui.js`, `chat.js`, `sql.js`, `upload.js`, `providers.js`, `search.js`, `inspector.js` (Row Inspector: expands selected result row, renders FK links)
- `src/yoursqlfriend/static/style.css` — Forensic Atelier theme (warm cream paper + burnt umber accent, with dark-mode variants)
- `src/yoursqlfriend/templates/index.html` — Jinja2 single-page template, loads vendored libs from `static/lib/`
- `src/yoursqlfriend/static/manifest.json` — PWA manifest (standalone display, app icons)
- `src/yoursqlfriend/static/service-worker.js` — Service worker for PWA installability + static asset caching
- `pyproject.toml` — Package metadata, dependencies, entry point
- `run.sh` / `run.bat` — Dev launcher scripts (venv setup, editable install, app launch)
- `install.sh` / `install.ps1` — One-line installers (pipx-based, no git required)

### Request Flow

1. User types natural language question → `POST /chat_stream` → response is `text/event-stream` (proper SSE)
2. Backend builds schema context (`build_schema_context()`: DDL + foreign keys + 3 sample rows per table, capped at `SCHEMA_CONTEXT_CHAR_BUDGET` chars; samples are omitted and flagged when over budget) and system prompt with decision framework
3. LLM streams tokens → backend yields `event: token` frames; sends `event: done` with token-usage JSON once complete; `event: error` on failure. Periodic `: keep-alive` comments prevent proxy drops during slow generation.
4. Frontend accumulates `event: token` chunks into `fullResponse`, renders progressively. On `event: done`: updates token counter. On `event: error`: renders error UI.
5. Frontend extracts SQL from `fullResponse` with a tolerant regex (case-insensitive `sql`/`sqlite` tags, single-line fences), calls `/execute_sql` for validation + execution
6. On `sqlite3.Error`: backend auto-retries once via `call_llm_non_streaming()` with a grammar-constrained JSON response (`{"sql": "..."}`); fallback is `extract_sql_from_response()` in `llm.py` (tolerant fences → untagged fence → bare SQL — everything extracted still passes `validate_sql()`); frontend shows collapsible "Auto-corrected" badge

## Key Constraints

- **Read-only databases**: All connections use `mode=ro` + `PRAGMA query_only = ON`
- **SQL validation** (`validate_sql()`): Strips string literals and comments first, then checks allowed statement starts (SELECT/WITH/EXPLAIN/PRAGMA) and blocks 13 forbidden keywords. Multi-statement queries rejected
- **Cross-site POST guard**: a `before_request` hook in `app.py` rejects POSTs whose `Origin` or `Host` header isn't loopback/matching (CSRF + DNS-rebinding defense; session cookie is `SameSite=Lax`). Route tests that POST must not set a foreign `Origin`/`Host` header, or they'll get 403
- **Stop button / abort causes**: while streaming, the Send button becomes Stop. Every abort sets `abortCause` on `state.activeStreamController` (`'user'` | `'watchdog'` | `'superseded'`); a user stop keeps and saves the partial text and **never executes SQL from a truncated response**. Preserve this contract when touching `chat.js`
- **Reduced motion**: `@media (prefers-reduced-motion: reduce)` in `style.css` suppresses all animations *except* `.status-shimmer` — that exemption is deliberate (essential progress indicator; Windows commonly reports reduce because "Animation effects" ships disabled). Don't re-suppress it
- **Pane-header alignment**: the three pane headers (sidebar search row, `.cp-head`, `.rp-head`) share the `--pane-head-h` token so their bottom rules stay pixel-aligned — change the token, never individual header heights
- **Contrast tokens**: `--ink-3`/`--ink-4` are tuned to ≥4.5:1 WCAG AA against `--bg`/`--bg-2` in both themes; don't lighten them for aesthetics
- **Session secret**: random per-install key persisted at `DATA_DIR/secret_key` (`SECRET_KEY` env var overrides). Never reintroduce a hardcoded fallback
- **Error responses**: the global exception handler returns a generic message; never echo `str(e)` to the client — exception text goes to the log only
- **Schema-context degradation** (`build_schema_context`): over `SCHEMA_CONTEXT_CHAR_BUDGET`, sample rows degrade gradually (3 → 1 → 0 per table) before DDL is hard-truncated with a visible marker
- **PRAGMA table names must be double-quoted**: `PRAGMA table_info("table_name")` — not single quotes
- **Version**: `pyproject.toml` `version` is the single source of truth. Read at runtime via `importlib.metadata` in `__init__.py`. On release, update `pyproject.toml` version and add a `CHANGELOG.txt` entry. Template cache-bust `?v=` and service worker `CACHE_NAME` are injected automatically.
  - **PyPI release**: a GitHub Actions workflow (`.github/workflows/publish.yml`) publishes to PyPI automatically when a `v*` tag is pushed. Do not run `twine` or `python -m build` manually. Release steps: bump `pyproject.toml` version, update `CHANGELOG.txt`, commit and push to `main`, then `git tag vX.Y.Z <commit-sha> && git push origin vX.Y.Z`.
  - **Git authorship**: commit with the repo-local `user.email` (a GitHub noreply address, already configured). The public history was deliberately scrubbed of personal email addresses — never commit with one.
  - **Editable-install gotcha**: `pip install -e .` writes dist-info metadata at install time and does *not* re-read `pyproject.toml` on subsequent imports. After bumping the version, refresh the dev venv with `pip install -e . --force-reinstall --no-deps` — otherwise `importlib.metadata.version()` will keep returning the old version, and the template will inject stale `?v=` cache-bust tokens. Only affects contributors; pipx users always get fresh metadata.
- **User data**: stored in `~/.yourSQLfriend/` (Linux/macOS) or `%APPDATA%\.yourSQLfriend\` (Windows)
- **Session state**: Server-side filesystem sessions — set `session.modified = True` after updates
- **Grid.js table limit**: 2000 rows max for performance

## LLM Provider Setup

Supports LM Studio (OpenAI-compatible API at `localhost:1234`) and Ollama (`localhost:11434`). Configured via env vars `LLM_PROVIDER`, `LLM_API_URL`, `OLLAMA_URL`, `OLLAMA_MODEL`. Provider status polled every 30 seconds from frontend.

- **LM Studio**: current LM Studio builds return **400 Bad Request if the payload has no `model` id** (older builds ignored it). `resolve_lmstudio_model()` queries `/v1/models` at call time, skips embedding models, and the field is omitted when unresolvable so old builds still work. Do not remove the model field from the payload.
- **Reasoning models via LM Studio** (e.g. qwen3.6) can finish with an empty `content` and the real answer in `reasoning_content`; `_extract_llm_content()` falls back to it. Keep that fallback when touching response parsing.
- **Ollama**: model resolved at call time via `resolve_ollama_model()` — priority: user's session pick → `OLLAMA_MODEL` env var → first installed model → `None`. Both providers go through `resolve_provider_model()` at the two call sites in `app.py`. No model name is hardcoded; the codebase never goes stale. Run `ollama list` to see what's installed. The SQL auto-correction retry passes a JSON schema object in `format` (grammar-constrained output) — this requires **Ollama ≥ 0.5**. Older builds accept only `format: "json"` and may reject the schema; the retry degrades gracefully via the extraction fallback in that case.
- **Tests must mock model resolution**: route tests for the retry path patch `yoursqlfriend.app.resolve_provider_model` (alongside `call_llm_non_streaming`) — otherwise the suite makes real HTTP calls to localhost:1234 and slows/flakes.

## Dependencies

Python: Flask, pandas, requests, Flask-Session (declared in `pyproject.toml`)

Frontend (vendored in `src/yoursqlfriend/static/lib/`): Grid.js, Highlight.js, Marked.js, DOMPurify. Exact versions + source URLs live in `static/lib/VERSIONS.md` — when swapping a lib file, update that table and bump the app version (the service worker caches `/static/lib/` cache-first, keyed by app version, so users only get the new file after a bump). DOMPurify is the XSS boundary for all LLM-rendered markdown; keep it current.

## Tests

```bash
pip install -e .
python -m pytest tests/ -v
ruff check .
```

180 pytest cases: SQL validation (63), Flask routes (36), LLM module (64), database (17). Ruff is configured in `pyproject.toml` (`E/F/W/B/UP`, lint-only — no formatter); keep `ruff check .` clean.

For end-to-end verification (launch the app, upload a DB, drive chat/stop/focus flows in a real browser against a local LLM), follow the recipe in `.claude/skills/verify/SKILL.md`.

**CI**: `.github/workflows/test.yml` runs pytest (Python 3.10 + 3.13) and ruff on every push/PR to `main`. `publish.yml` gates the PyPI publish on a passing test job — a `v*` tag with failing tests will not release.
