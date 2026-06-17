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
5. Frontend extracts SQL via regex from `fullResponse`, calls `/execute_sql` for validation + execution
6. On `sqlite3.Error`: backend auto-retries once via `call_llm_non_streaming()` with a grammar-constrained JSON response (`{"sql": "..."}`) for reliable extraction, with a markdown regex as fallback; frontend shows collapsible "Auto-corrected" badge

## Key Constraints

- **Read-only databases**: All connections use `mode=ro` + `PRAGMA query_only = ON`
- **SQL validation** (`validate_sql()`): Strips string literals and comments first, then checks allowed statement starts (SELECT/WITH/EXPLAIN/PRAGMA) and blocks 13 forbidden keywords. Multi-statement queries rejected
- **PRAGMA table names must be double-quoted**: `PRAGMA table_info("table_name")` — not single quotes
- **Version**: `pyproject.toml` `version` is the single source of truth. Read at runtime via `importlib.metadata` in `__init__.py`. On release, update `pyproject.toml` version and add a `CHANGELOG.txt` entry. Template cache-bust `?v=` and service worker `CACHE_NAME` are injected automatically.
  - **PyPI release**: a GitHub Actions workflow (`.github/workflows/publish.yml`) publishes to PyPI automatically when a `v*` tag is pushed. Do not run `twine` or `python -m build` manually. Release steps: bump `pyproject.toml` version, update `CHANGELOG.txt`, commit and push to `main`, then `git tag vX.Y.Z <commit-sha> && git push origin vX.Y.Z`.
  - **Editable-install gotcha**: `pip install -e .` writes dist-info metadata at install time and does *not* re-read `pyproject.toml` on subsequent imports. After bumping the version, refresh the dev venv with `pip install -e . --force-reinstall --no-deps` — otherwise `importlib.metadata.version()` will keep returning the old version, and the template will inject stale `?v=` cache-bust tokens. Only affects contributors; pipx users always get fresh metadata.
- **User data**: stored in `~/.yourSQLfriend/` (Linux/macOS) or `%APPDATA%\.yourSQLfriend\` (Windows)
- **Session state**: Server-side filesystem sessions — set `session.modified = True` after updates
- **Grid.js table limit**: 2000 rows max for performance

## LLM Provider Setup

Supports LM Studio (OpenAI-compatible API at `localhost:1234`) and Ollama (`localhost:11434`). Configured via env vars `LLM_PROVIDER`, `LLM_API_URL`, `OLLAMA_URL`, `OLLAMA_MODEL`. Provider status polled every 30 seconds from frontend.

- **LM Studio**: always uses whichever model is currently loaded in the server — no model name needed in code.
- **Ollama**: model resolved at call time via `resolve_ollama_model()` — priority: user's session pick → `OLLAMA_MODEL` env var → first installed model → `None`. No model name is hardcoded; the codebase never goes stale. Run `ollama list` to see what's installed. The SQL auto-correction retry passes a JSON schema object in `format` (grammar-constrained output) — this requires **Ollama ≥ 0.5**. Older builds accept only `format: "json"` and may reject the schema; the retry degrades gracefully via the regex fallback in that case.

## Dependencies

Python: Flask, pandas, requests, Flask-Session (declared in `pyproject.toml`)

Frontend (vendored in `src/yoursqlfriend/static/lib/`): Grid.js, Highlight.js, Marked.js, DOMPurify

## Tests

```bash
pip install -e .
python -m pytest tests/ -v
```

125 pytest cases: SQL validation (63), Flask route tests (24), LLM module tests (38). No linter configured.
