# mySQLhelper

Chat with your SQLite databases using a local LLM. Ask questions in plain English, get SQL queries and results. Everything runs offline on your machine.

https://github.com/user-attachments/assets/22dd82a3-7108-41c8-8a25-b71f4dae7147

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Version](https://img.shields.io/badge/version-2.2-blue)
![Python](https://img.shields.io/badge/python-3.10%2B-blue)
![Flask](https://img.shields.io/badge/flask-3.x-green)

## Features

| Feature | What it does |
|---------|-------------|
| **100% Offline** | Your data never leaves your machine. Uses local LLMs via LM Studio |
| **Natural Language** | Ask "show me the top 5 customers" and get results |
| **See the SQL** | Every query is shown before execution - no black box |
| **Search All Tables** | Find a value across your entire database in one click |
| **Forensic Functions** | Built-in timestamp converters, Base64/Hex decode, pattern extractors |
| **Interactive Tables** | Sort, filter, paginate results. Dark/light theme |
| **Export Sessions** | Save your analysis as an HTML report with full audit trail |

> **Note:** Designed for localhost use on a single workstation. For network deployment, set `SECRET_KEY` env var.

## Quick Start

**1. Get [LM Studio](https://lmstudio.ai/)** and load a model (Qwen, Mistral, etc). Enable the local server on port `1234`.

**2. Clone and run:**
```bash
git clone https://github.com/reisset/mysqlhelper.git
cd mysqlhelper
python3 -m venv venv && source venv/bin/activate  # Windows: .\venv\Scripts\activate
pip install -r requirements.txt
flask run
```

**3. Open** [http://127.0.0.1:5000](http://127.0.0.1:5000) and drag in a `.db` file.

## For Forensic Analysts

- **Read-only guaranteed** - SQL validation + SQLite `mode=ro` blocks any writes
- **Chain of custody** - SHA256 hashes logged, timestamped exports
- **Audit logs** - All queries logged to `logs/` with daily rotation
- **Air-gapped safe** - Zero telemetry, no internet required

**Heads up:** WAL files (`.db-wal`, `.db-shm`) aren't uploaded with the main DB. Checkpoint first if you need recent transactions.

## Stack

Flask + Vanilla JS + SQLite + Local LLM (OpenAI-compatible API)

## License

MIT

---

Built by [Reisset](https://github.com/reisset)
