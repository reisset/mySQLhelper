# yourSQLfriend

Connect your SQLite databases to a local LLM through a webchat interface. Ask questions in plain English, get SQL queries and results. Built for offline environments.


https://github.com/user-attachments/assets/26c8eaf8-cd35-4c20-9427-a87385680cce


![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)
![Version](https://img.shields.io/badge/version-3.3-blue)
![Python](https://img.shields.io/badge/python-3.10%2B-blue)
![Flask](https://img.shields.io/badge/flask-3.x-green)

## Features

- **100% Offline**  => Runs on a local LLM via Ollama or LM Studio
- **Natural Language** => Ask "show me the top 5 customers" and get results + the exact SQL query
- **Search All Tables** => Find a value across your entire database in one click
- **Forensic Functions** => Built-in timestamp converters, Base64/Hex decode, pattern extractors
- **Interactive Tables** => Sort, filter, paginate results. Dark/light theme
- **Export Sessions** => Save your entire chat session as a formatted HTML file
- **Install as App** => Use Chrome/Edge/Brave to install as a standalone desktop app (PWA)

> **Note:** Designed for localhost use on a single workstation. For network deployment, set `SECRET_KEY` env var.

---

## Quick Start

### Linux/macOS

```bash
curl -fsSL https://raw.githubusercontent.com/reisset/yourSQLfriend/main/install.sh | sh
cd ~/yourSQLfriend
./run.sh
```

### Windows (PowerShell)

```powershell
irm https://raw.githubusercontent.com/reisset/yourSQLfriend/main/install.ps1 | iex
cd ~\yourSQLfriend
.\run.bat
```

### With Git (alternative)

```bash
git clone https://github.com/reisset/yourSQLfriend.git
cd yourSQLfriend
./run.sh          # Linux/macOS
run.bat           # Windows
```

The launcher script creates a virtual environment, installs dependencies, and opens the app in your default browser.

To use a different port: `./run.sh 8080` or `run.bat 8080`

### Install as Desktop App (Optional)

With the app running in Chrome, Edge, or Brave, click the **install icon** in the address bar to install yourSQLfriend as a standalone app. This gives you:

- Its own window (no browser tabs or address bar)
- A desktop icon / taskbar entry
- Full browser rendering quality

> **Note:** The Flask server must be running for the app to work. Use `./run.sh` to start it.

---

## LLM Setup

yourSQLfriend requires a local LLM. Set one up before you start:

### Option A: Ollama (Recommended)

```bash
# Install Ollama (see https://ollama.ai)
# Then pull a model:
ollama pull llama3.2

# Start the server:
ollama serve
```

### Option B: LM Studio

1. Download [LM Studio](https://lmstudio.ai)
2. Load a model
3. Start local server on port 1234

> **Recommended models:** Ministral-3:7b or 14b, devstral-small-2:24b, GLM 4.6v flash, GLM 4.7 (30b).

---

## Data Storage

yourSQLfriend stores its data in your home directory:

- **Linux/macOS:** `~/.yourSQLfriend/`
- **Windows:** `%APPDATA%\.yourSQLfriend\`

Contents:
- `uploads/` - Uploaded database files
- `logs/` - Analysis logs with daily rotation
- `sessions/` - Flask session data

---

## Forensic Integrity

- **Read-only guaranteed** - SQL validation + SQLite `mode=ro` block all writes
- **Chain of custody** - SHA256 hashes logged, timestamped exports
- **Audit logs** - All queries logged to `logs/` with daily rotation
- **Air-gap safe** - Zero telemetry, works fully offline

**Heads up:** The upload process excludes WAL files (`.db-wal`, `.db-shm`). Checkpoint your database first to include recent transactions.

---

## Technology Stack

Flask, Vanilla JS, CSS, HTML, SQLite, PWA, local LLM (OpenAI-compatible API)

---

## License

Apache 2.0 — see [LICENSE](LICENSE) and [NOTICE](NOTICE).

Built by [Reisset](https://github.com/reisset)
