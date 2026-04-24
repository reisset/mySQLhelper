<div align="center">

# yourSQLfriend

**Connect SQLite databases to a local LLM. Ask questions in plain English, get SQL queries and results.**

Built for offline forensic analysis on a single workstation — no cloud, no telemetry, nothing leaves your machine.

[![Version](https://img.shields.io/badge/version-3.9.0-c1522b?style=for-the-badge&labelColor=0a0a0c)](https://github.com/reisset/yourSQLfriend/releases)
[![License](https://img.shields.io/badge/license-Apache%202.0-blue?style=for-the-badge&labelColor=0a0a0c)](LICENSE)
[![Python](https://img.shields.io/badge/python-3.10%2B-3776ab?style=for-the-badge&logo=python&logoColor=white&labelColor=0a0a0c)](https://python.org)
[![Flask](https://img.shields.io/badge/flask-3.x-green?style=for-the-badge&labelColor=0a0a0c)](https://flask.palletsprojects.com)

<img width="1769" alt="yourSQLfriend — load a database and get started" src="https://github.com/user-attachments/assets/7fc453e2-08f7-40f3-8ee1-8421238a734a" />

</div>

---

**yourSQLfriend is for analysts, investigators, and developers who need to interrogate SQLite databases without sending data anywhere.** Load a `.db`, `.sqlite`, `.csv`, or `.sql` file, ask questions in plain English, and get parameterised read-only SQL with full results — air-gap safe, forensic-grade.

---

## ✨ Features

| | |
|---|---|
| 🔒 **100% Offline** | Runs on a local LLM via Ollama or LM Studio. Zero telemetry, air-gap safe |
| 💬 **Natural Language** | Ask "show me the top 5 customers" and get results + the exact SQL query |
| 🔍 **Search All Tables** | Find a value across your entire database (`⌘K` / `Ctrl+K`) |
| 🪟 **Three-Pane Workbench** | Schema browser · conversation · Row Inspector |
| 🔎 **Row Inspector** | Click any result row to expand it; foreign keys become clickable links |
| 🕘 **Query History** | Per-session panel of every question asked; click to jump back to that turn |
| 📋 **Interactive Tables** | Sort, filter, paginate results with dark/light theme |
| 💾 **Export Sessions** | Save your entire chat session as a formatted HTML file with hashes + timestamps |
| 🖥️ **Install as App** | PWA support — install as a standalone desktop app from Chrome/Edge/Brave |

Ask a question in plain English — the LLM writes parameterised read-only SQL, runs it, and returns results you can sort, filter, and export.

<img width="1059" alt="Workbench — question, generated SQL, and paginated results" src="https://github.com/user-attachments/assets/f9483143-a6e4-4330-ad8c-2f8a9eb0e194" />

<details>
<summary><strong>Schema browser & query history</strong></summary>
<br>

Browse all tables, columns, types, and row counts in the left pane. Query history lives at the bottom — click any entry to jump back.

<img width="342" alt="Schema browser and query history" src="https://github.com/user-attachments/assets/d681458a-5a94-4db4-b650-043d82c2b9a0" />

</details>

<details>
<summary><strong>Row Inspector</strong></summary>
<br>

Click any result row to expand it. Foreign key references become navigable links — follow relationships without writing another query.

<img width="414" alt="Row Inspector with foreign key navigation" src="https://github.com/user-attachments/assets/6a882305-ac01-43d2-8099-6bed8631a122" />

</details>

---

## 🤖 LLM Setup

**yourSQLfriend requires a local LLM running before you launch.** Set one up first:

### Option A: Ollama

```bash
ollama pull gemma4:26b
ollama serve
```

### Option B: LM Studio

1. Download [LM Studio](https://lmstudio.ai)
2. Load a model
3. Start local server on port 1234

Once connected, the provider indicator in the top bar turns green.

<img width="451" alt="Settings panel — provider connected" src="https://github.com/user-attachments/assets/f7b78356-daaf-468e-86f8-8326ba7adff5" />

> **Context window:** The system prompt is token-heavy by design. A 16K context window is the minimum; 32K or more is strongly recommended for complex schemas.

> **LLM model sizes:** Smallest → 4B | Mid → 8-9B | Large → 14B | Largest → 26-30B

> **Recommended LLM families:** Qwen | Gemma | Mistral / Devstral

---

## 🚀 Quick Start

**Prerequisite:** [Python 3.10+](https://python.org) must be installed, and your LLM must be running (see above).

### Linux / macOS

```bash
curl -fsSL https://raw.githubusercontent.com/reisset/yourSQLfriend/main/install.sh | sh
```

### Windows (PowerShell)

```powershell
irm https://raw.githubusercontent.com/reisset/yourSQLfriend/main/install.ps1 | iex
```

Then launch from any terminal: yoursqlfriend

Options: `yoursqlfriend --port 8080`, `--no-browser`, `--host 0.0.0.0`

> **Note:** The Flask server must be running for the app to work. `yoursqlfriend` starts it automatically — do not close the terminal.

<details>
<summary><strong>Install with pipx (manual)</strong></summary>

```bash
pipx install yoursqlfriend
```

</details>

<details>
<summary><strong>From source (developers)</strong></summary>

```bash
git clone https://github.com/reisset/yourSQLfriend.git
cd yourSQLfriend
./run.sh          # Linux/macOS
run.bat           # Windows
```

</details>

---

## 🛡️ Forensic Integrity

| | |
|---|---|
| **Read-only guaranteed** | SQL validation + SQLite `mode=ro` block all writes |
| **Chain of custody** | SHA256 hashes logged, timestamped exports |
| **Audit logs** | All queries logged to `logs/` with daily rotation |
| **Air-gap safe** | Zero telemetry, works fully offline |

> **WAL files:** The upload process excludes `.db-wal` and `.db-shm` files. Checkpoint your database first to ensure recent transactions are included.

---

## ⚠️ Known Limitations

- **Model quality matters.** Smaller models will produce incorrect or incomplete SQL on complex schemas. If results look wrong, the query is the first thing to check.
- **SQLite only.** No support for Postgres, MySQL, or other engines.
- **Single database per session.** You can replace the loaded database mid-session, but results from different databases are not cross-queryable.
- **Complex queries may fail.** Heavily nested subqueries, window functions, and non-standard SQLite extensions may exceed what the LLM generates reliably.

---

## 📂 Data Storage

All data lives in your home directory:

| Platform | Path |
|---|---|
| Linux / macOS | `~/.yourSQLfriend/` |
| Windows | `%APPDATA%\.yourSQLfriend\` |

Contains `uploads/`, `logs/`, and `sessions/`.

---

<div align="center">

Apache 2.0 — see [LICENSE](LICENSE) and [NOTICE](NOTICE)

Built by [Reisset](https://github.com/reisset)

</div>
