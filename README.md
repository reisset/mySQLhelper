<div align="center">

# yourSQLfriend

**Connect SQLite databases to a local LLM. Ask questions in plain English, get SQL queries and results.**

Built for offline forensic analysis on a single workstation.

[![Version](https://img.shields.io/badge/version-3.4.1-00c896?style=for-the-badge&labelColor=0a0a0c)](https://github.com/reisset/yourSQLfriend/releases)
[![License](https://img.shields.io/badge/license-Apache%202.0-blue?style=for-the-badge&labelColor=0a0a0c)](LICENSE)
[![Python](https://img.shields.io/badge/python-3.10%2B-3776ab?style=for-the-badge&logo=python&logoColor=white&labelColor=0a0a0c)](https://python.org)
[![Flask](https://img.shields.io/badge/flask-3.x-green?style=for-the-badge&labelColor=0a0a0c)](https://flask.palletsprojects.com)

https://github.com/user-attachments/assets/26c8eaf8-cd35-4c20-9427-a87385680cce

</div>

---

## Features

| | |
|---|---|
| **100% Offline** | Runs on a local LLM via Ollama or LM Studio. Zero telemetry, air-gap safe |
| **Natural Language** | Ask "show me the top 5 customers" and get results + the exact SQL query |
| **Search All Tables** | Find a value across your entire database in one click |
| **Forensic Functions** | Built-in timestamp converters, Base64/Hex decode, pattern extractors |
| **Chart Visualization** | One-click bar, line, pie, or scatter charts on any query result |
| **Schema Diagram** | Interactive ER diagram with drag, zoom, pan, and click-to-highlight |
| **Interactive Tables** | Sort, filter, paginate results with dark/light theme |
| **Export Sessions** | Save your entire chat session as a formatted HTML file |
| **Install as App** | PWA support — install as a standalone desktop app from Chrome/Edge/Brave |

---

## Quick Start

### Linux / macOS

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

## LLM Setup

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

> **Recommended models:** Ministral-3:7b or 14b, devstral-small-2:24b, GLM 4.6v flash, GLM 4.7 (30b).

---

## Install as Desktop App

With the app running in Chrome, Edge, or Brave, click the **install icon** in the address bar. This gives you its own window, a desktop icon, and full browser rendering quality.

> The Flask server must be running for the app to work. Use `./run.sh` to start it.

---

## Forensic Integrity

| | |
|---|---|
| **Read-only guaranteed** | SQL validation + SQLite `mode=ro` block all writes |
| **Chain of custody** | SHA256 hashes logged, timestamped exports |
| **Audit logs** | All queries logged to `logs/` with daily rotation |
| **Air-gap safe** | Zero telemetry, works fully offline |

> **Note:** The upload process excludes WAL files (`.db-wal`, `.db-shm`). Checkpoint your database first to include recent transactions.

---

## Data Storage

All data lives in your home directory:

| Platform | Path |
|---|---|
| Linux / macOS | `~/.yourSQLfriend/` |
| Windows | `%APPDATA%\.yourSQLfriend\` |

Contains `uploads/`, `logs/`, and `sessions/`.

---

## Tech Stack

Flask, Vanilla JS, CSS, HTML, SQLite, PWA, local LLM (OpenAI-compatible API)

---

<div align="center">

Apache 2.0 — see [LICENSE](LICENSE) and [NOTICE](NOTICE)

Built by [Reisset](https://github.com/reisset)

</div>
