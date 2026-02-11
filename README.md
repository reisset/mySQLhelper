<div align="center">

# yourSQLfriend

**Connect SQLite databases to a local LLM. Ask questions in plain English, get SQL queries and results.**

Built for offline analysis on a single workstation.

[![Version](https://img.shields.io/badge/version-3.5.0-00c896?style=for-the-badge&labelColor=0a0a0c)](https://github.com/reisset/yourSQLfriend/releases)
[![License](https://img.shields.io/badge/license-Apache%202.0-blue?style=for-the-badge&labelColor=0a0a0c)](LICENSE)
[![Python](https://img.shields.io/badge/python-3.10%2B-3776ab?style=for-the-badge&logo=python&logoColor=white&labelColor=0a0a0c)](https://python.org)
[![Flask](https://img.shields.io/badge/flask-3.x-green?style=for-the-badge&labelColor=0a0a0c)](https://flask.palletsprojects.com)

![yourSQLfriend](https://github.com/user-attachments/assets/9984c22c-53f8-4679-9443-6d99574f4280)


</div>

---

## ✨ Features
| | |
|---|---|
| 🔒 **100% Offline** | Runs on a local LLM via Ollama or LM Studio. Zero telemetry, air-gap safe |
| 💬 **Natural Language** | Ask "show me the top 5 customers" and get results + the exact SQL query |
| 🔍 **Search All Tables** | Find a value across your entire database in one click |
| 📊 **Chart Visualization** | One-click bar, line, pie, or scatter charts on any query result |
| 🗺️ **Schema Diagram** | Interactive ER diagram with drag, zoom, pan, and click-to-highlight |
| 📋 **Interactive Tables** | Sort, filter, paginate results with dark/light theme |
| 💾 **Export Sessions** | Save your entire chat session as a formatted HTML file |
| 🖥️ **Install as App** | PWA support — install as a standalone desktop app from Chrome/Edge/Brave |
> The Flask server must be running for the app to work. Use `./run.sh` to start it.
                        

---

## 🚀 Quick Start

### Linux 

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

<details>
<summary><strong>With Git (alternative)</strong></summary>

```bash
git clone https://github.com/reisset/yourSQLfriend.git
cd yourSQLfriend
./run.sh          # Linux/macOS
run.bat           # Windows
```

</details>

The launcher creates a virtual environment, installs dependencies, and opens the app in your browser.

Custom port: `./run.sh 8080` or `run.bat 8080`

---

## 🤖 LLM Setup

yourSQLfriend requires a local LLM. Set one up before you start:

### Option A: Ollama (Recommended)

```bash
ollama pull llama3.2
ollama serve
```

### Option B: LM Studio

1. Download [LM Studio](https://lmstudio.ai)
2. Load a model
3. Start local server on port 1234

> **Fair Warning:** The system prompt required to get better SQL query results is token-heavy. For optimal usage, a ~16 000 tokens context window is MINIMUM, and ~32 000 or more is highly recommended.
 
> **Recommended models:** Smallest => Qwen3:4B | Mid-Size => Qwen3:8B | Large => Ministral-3:14B OR Qwen3:14B | Largest => Qwen3-coder:30B


---

## 🛡️ Forensic Integrity

| | |
|---|---|
| **Read-only guaranteed** | SQL validation + SQLite `mode=ro` block all writes |
| **Chain of custody** | SHA256 hashes logged, timestamped exports |
| **Audit logs** | All queries logged to `logs/` with daily rotation |
| **Air-gap safe** | Zero telemetry, works fully offline |

> **Note:** The upload process excludes WAL files (`.db-wal`, `.db-shm`). Checkpoint your database first to include recent transactions.

---

## 📂 Data Storage

All data lives in your home directory:

| Platform | Path |
|---|---|
| Linux / macOS | `~/.yourSQLfriend/` |
| Windows | `%APPDATA%\.yourSQLfriend\` |

Contains `uploads/`, `logs/`, and `sessions/`.

---

## 🧰 Tech Stack

Flask, Vanilla JS, CSS, HTML, SQLite, PWA, local LLM (OpenAI-compatible API)

---

<div align="center">

Apache 2.0 — see [LICENSE](LICENSE) and [NOTICE](NOTICE)

Built by [Reisset](https://github.com/reisset)

</div>
