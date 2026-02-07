# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Running the App

```bash
# Development (web browser)
source venv/bin/activate
flask run                  # http://127.0.0.1:5000

# Desktop app (native window via pywebview)
python main.py
```

## Building Standalone Executables

```bash
# Linux — requires gir1.2-webkit2-4.1 system package
./build_linux.sh           # Output: dist/yourSQLfriend

# Windows — requires Python 3.12 (pythonnet compatibility)
build_windows.bat          # Output: dist\yourSQLfriend.exe
```

Both scripts create a venv, install deps + PyInstaller, and run `pyinstaller yourSQLfriend.spec --clean`. The Linux script uses `--system-site-packages` for PyGObject/gi access.

## Architecture

**Single-page Flask app** with vanilla JS frontend. No build step, no bundler, no framework.

- `app.py` — All backend logic: routes, SQL validation, LLM streaming (SSE), UDFs, file upload handling, forensic features (hashing, audit logging, read-only enforcement)
- `main.py` — pywebview desktop wrapper. Exposes `Api` class with `open_file_dialog()` and `save_file_dialog()` to JS via `js_api`
- `static/script.js` — Chat UI, SQL execution, Grid.js table rendering, LLM provider management, theme toggle
- `static/style.css` — Dark/light forensic terminal theme
- `templates/index.html` — Jinja2 single-page template, loads vendored libs from `static/lib/`

### Request Flow

1. User types natural language question → streams to `/chat_stream` via SSE
2. Backend builds schema context (`build_schema_context()`: DDL + foreign keys + 3 sample rows per table) and system prompt with decision framework
3. LLM responds with SQL in fenced code blocks (or plain text for non-SQL questions)
4. Frontend extracts SQL via regex, calls `/execute_sql` for validation + execution
5. On `sqlite3.Error`: backend auto-retries once via `call_llm_non_streaming()` with error correction prompt; frontend shows collapsible "Auto-corrected" badge

### Desktop vs Web Detection

JS checks `window.pywebview && window.pywebview.api` to switch between native file dialogs (path-based upload via `/upload_path`) and browser file input (multipart via `/upload`).

## Key Constraints

- **Read-only databases**: All connections use `mode=ro` + `PRAGMA query_only = ON`
- **SQL validation** (`validate_sql()`): Strips string literals and comments first, then checks allowed statement starts (SELECT/WITH/EXPLAIN/PRAGMA) and blocks 13 forbidden keywords. Multi-statement queries rejected
- **PRAGMA table names must be double-quoted**: `PRAGMA table_info("table_name")` — not single quotes
- **All UDFs use `except Exception:`** — never bare `except:`
- **Version tracked in 3 places**: `app.py` (`VERSION`), `templates/index.html` (CSS/JS cache bust `?v=`), `README.md` (badge)
- **PyInstaller path resolution**: `sys._MEIPASS` for bundled resources; user data stored in `~/.yourSQLfriend/` (Linux/macOS) or `%APPDATA%\.yourSQLfriend\` (Windows)
- **Session state**: Server-side filesystem sessions — set `session.modified = True` after updates
- **Grid.js table limit**: 2000 rows max for performance

## LLM Provider Setup

Supports LM Studio (OpenAI-compatible API at `localhost:1234`) and Ollama (`localhost:11434`). Configured via env vars `LLM_PROVIDER`, `LLM_API_URL`, `OLLAMA_URL`, `OLLAMA_MODEL`. Provider status polled every 30 seconds from frontend.

## Dependencies

Python: Flask, pandas, requests, Flask-Session, pywebview>=5.0

Frontend (vendored in `static/lib/`): Grid.js, Highlight.js, Marked.js, DOMPurify

## No Test Suite or Linter

There is currently no automated testing infrastructure or linting/formatting configuration.
