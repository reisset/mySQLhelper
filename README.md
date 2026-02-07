# yourSQLfriend

Connect your SQLite databases to a pretty webchat interface, then obtain help from a local LLM. Ask questions in plain English, get SQL queries and results. Built to be used in offline environments.


https://github.com/user-attachments/assets/26c8eaf8-cd35-4c20-9427-a87385680cce


![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)
![Version](https://img.shields.io/badge/version-3.3-blue)
![Python](https://img.shields.io/badge/python-3.10%2B-blue)
![Flask](https://img.shields.io/badge/flask-3.x-green)

## Features

- **100% Offline**  => Utilizes Local LLM deployment via Ollama/LM studio
- **Natural Language** => Ask "show me the top 5 customers" and get results + exact SQL query used
- **Search All Tables** => Find a value across your entire database in one click
- **Forensic Functions** => Built-in timestamp converters, Base64/Hex decode, pattern extractors
- **Interactive Tables** => Sort, filter, paginate results. Dark/light theme
- **Export Sessions** => Save your entire chat session via a nicely formatted HTML file
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

The launcher script handles everything: creates a virtual environment, installs dependencies, and opens the app in your default browser.

To use a different port: `./run.sh 8080` or `run.bat 8080`

### Install as Desktop App (Optional)

Once the app is running in Chrome, Edge, or Brave, click the **install icon** in the address bar to install yourSQLfriend as a standalone app. This gives you:

- Its own window (no browser tabs or address bar)
- A desktop icon / taskbar entry
- Full browser rendering quality

> **Note:** The Flask server must be running for the app to work. Use `./run.sh` to start it.

---

## LLM Setup

Before using yourSQLfriend, you need a local LLM running:

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

> **LLM Model recommendation:** Ministral-3:7b or 14b, devstral-small-2:24b, GLM 4.6v flash, GLM 4.7 (30b).

---

## Running Manually

If you prefer not to use the launcher scripts:

```bash
# Create and activate virtual environment
python3 -m venv venv && source venv/bin/activate  # Windows: .\venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Run (auto-opens browser)
python app.py

# Or with options:
python app.py --port 8080          # Custom port
python app.py --no-browser         # Don't auto-open browser
```

---

## Data Storage

yourSQLfriend stores data in your home directory:

- **Linux/macOS:** `~/.yourSQLfriend/`
- **Windows:** `%APPDATA%\.yourSQLfriend\`

Contents:
- `uploads/` - Uploaded database files
- `logs/` - Analysis logs with daily rotation
- `sessions/` - Flask session data

---

## For Forensic Purposes

- **Read-only guaranteed** - SQL validation + SQLite `mode=ro` blocks any writes
- **Chain of custody** - SHA256 hashes logged, timestamped exports
- **Audit logs** - All queries logged to `logs/` with daily rotation
- **Air-gapped safe** - Zero telemetry, no internet required

**Heads up:** WAL files (`.db-wal`, `.db-shm`) aren't uploaded with the main DB. Checkpoint first if you need recent transactions.

---

## Technology Stack

Flask, Vanilla JS, CSS, HTML, SQLite, PWA, and Local LLM (OpenAI-compatible API)

---

## License

Apache 2.0 - See [LICENSE](LICENSE) and [NOTICE](NOTICE) files.

Built by [Reisset](https://github.com/reisset)
