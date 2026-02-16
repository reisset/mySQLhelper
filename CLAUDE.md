# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Running the App

```bash
# Launcher script (recommended — handles venv + deps + browser open)
./run.sh                   # Linux/macOS
run.bat                    # Windows

# Or manually
source venv/bin/activate
python app.py              # Auto-opens browser at http://127.0.0.1:5000
python app.py --port 8080  # Custom port
python app.py --no-browser # Don't auto-open browser
```

## Architecture

**Single-page Flask app** with vanilla JS frontend. No build step, no bundler, no framework. Installable as a PWA from Chrome/Edge/Brave.

- `app.py` — All backend logic: routes, SQL validation, LLM streaming (SSE), file upload handling, security features (hashing, audit logging, read-only enforcement)
- `static/js/` — ES modules: `app.js` (entry), `state.js`, `ui.js`, `chat.js`, `sql.js`, `charts.js`, `upload.js`, `providers.js`, `search.js`, `notes.js`, `erdiagram.js`
- `static/style.css` — Dark/light forensic terminal theme
- `templates/index.html` — Jinja2 single-page template, loads vendored libs from `static/lib/`
- `static/manifest.json` — PWA manifest (standalone display, app icons)
- `static/service-worker.js` — Service worker for PWA installability + static asset caching
- `run.sh` / `run.bat` — Launcher scripts (venv setup, dep install, app launch)
- `install.sh` — One-line curl installer for Linux/macOS (no git required)

### Request Flow

1. User types natural language question → streams to `/chat_stream` via SSE
2. Backend builds schema context (`build_schema_context()`: DDL + foreign keys + 3 sample rows per table) and system prompt with decision framework
3. LLM responds with SQL in fenced code blocks (or plain text for non-SQL questions)
4. Frontend extracts SQL via regex, calls `/execute_sql` for validation + execution
5. On `sqlite3.Error`: backend auto-retries once via `call_llm_non_streaming()` with error correction prompt; frontend shows collapsible "Auto-corrected" badge

## Key Constraints

- **Read-only databases**: All connections use `mode=ro` + `PRAGMA query_only = ON`
- **SQL validation** (`validate_sql()`): Strips string literals and comments first, then checks allowed statement starts (SELECT/WITH/EXPLAIN/PRAGMA) and blocks 13 forbidden keywords. Multi-statement queries rejected
- **PRAGMA table names must be double-quoted**: `PRAGMA table_info("table_name")` — not single quotes
- **Version**: `app.py` `VERSION` is the single source of truth. Template cache-bust `?v=` and service worker `CACHE_NAME` are injected automatically. Only update `app.py` and `CHANGELOG.txt` on release.
- **User data**: stored in `~/.yourSQLfriend/` (Linux/macOS) or `%APPDATA%\.yourSQLfriend\` (Windows)
- **Session state**: Server-side filesystem sessions — set `session.modified = True` after updates
- **Grid.js table limit**: 2000 rows max for performance

## LLM Provider Setup

Supports LM Studio (OpenAI-compatible API at `localhost:1234`) and Ollama (`localhost:11434`). Configured via env vars `LLM_PROVIDER`, `LLM_API_URL`, `OLLAMA_URL`, `OLLAMA_MODEL`. Provider status polled every 30 seconds from frontend.

## Dependencies

Python: Flask, pandas, requests, Flask-Session

Frontend (vendored in `static/lib/`): Grid.js, Highlight.js, Marked.js, DOMPurify, Chart.js

## Tests

```bash
source venv/bin/activate
python -m pytest tests/ -v
```

63 pytest cases covering `validate_sql()` and `strip_strings_and_comments()` — the SQL security boundary. No linter configured.
