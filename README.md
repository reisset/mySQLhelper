# yourSQLfriend

Connect your SQLite databases to a pretty webchat interface, then obtain help from a local LLM. Ask questions in plain English, get SQL queries and results. Built to be used in offline environments.


https://github.com/user-attachments/assets/26c8eaf8-cd35-4c20-9427-a87385680cce


![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)
![Version](https://img.shields.io/badge/version-3.1-blue)
![Python](https://img.shields.io/badge/python-3.10%2B-blue)
![Flask](https://img.shields.io/badge/flask-3.x-green)

## Features

- **100% Offline**  => Utilizes Local LLM deployment via Ollama/LM studio
- **Natural Language** => Ask "show me the top 5 customers" and get results + exact SQL query used
- **Search All Tables** => Find a value across your entire database in one click
- **Forensic Functions** => Built-in timestamp converters, Base64/Hex decode, pattern extractors
- **Interactive Tables** => Sort, filter, paginate results. Dark/light theme
- **Export Sessions** => Save your entire chat session via a nicely formatted HTML file
- **Desktop App** => Native window application (no browser required)

> **Note:** Designed for localhost use on a single workstation. For network deployment, set `SECRET_KEY` env var.

---

## Quick Start (Desktop App)

### Windows

1. Download `yourSQLfriend.exe` from the [Releases](https://github.com/reisset/yourSQLfriend/releases) page
2. Double-click to run
3. That's it!

### Linux

1. Install WebKitGTK (one-time setup):

   | Distro | Command |
   |--------|---------|
   | Ubuntu/Debian | `sudo apt install gir1.2-webkit2-4.1` |
   | Fedora | `sudo dnf install webkit2gtk4.1` |
   | Arch | `sudo pacman -S webkit2gtk-4.1` |
   | openSUSE | `sudo zypper install webkit2gtk3` |

2. Download `yourSQLfriend` from the [Releases](https://github.com/reisset/yourSQLfriend/releases) page
3. Make executable: `chmod +x yourSQLfriend`
4. Run: `./yourSQLfriend`

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

## Running from Source

If you prefer to run from source instead of using the desktop app:

```bash
git clone https://github.com/reisset/yourSQLfriend.git
cd yourSQLfriend

# Create and activate virtual environment
python3 -m venv venv && source venv/bin/activate  # Windows: .\venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Run as web app (opens in browser)
flask run

# OR run as desktop app (native window)
python main.py
```

Then open [http://127.0.0.1:5000](http://127.0.0.1:5000) (web app) or the native window will appear (desktop app).

---

## Building from Source

To build your own standalone executable:

### Linux

```bash
./build_linux.sh
# Output: dist/yourSQLfriend
```

### Windows

```batch
build_windows.bat
REM Output: dist\yourSQLfriend.exe
```

---

## Data Storage

The desktop app stores data in your home directory:

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

Flask, Vanilla JS, CSS for styling, HTML, SQLite, pywebview (desktop), and Local LLM (OpenAI-compatible API)

---

## License

Apache 2.0 - See [LICENSE](LICENSE) and [NOTICE](NOTICE) files.

Built by [Reisset](https://github.com/reisset)
