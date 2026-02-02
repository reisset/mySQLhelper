# yourSQLfriend

Connect your SQLite databases to a pretty webchat interface, then obtain help from a local LLM. Ask questions in plain English, get SQL queries and results. Built to be used in offline environments.


https://github.com/user-attachments/assets/26c8eaf8-cd35-4c20-9427-a87385680cce


![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Version](https://img.shields.io/badge/version-2.9-blue)
![Python](https://img.shields.io/badge/python-3.10%2B-blue)
![Flask](https://img.shields.io/badge/flask-3.x-green)

## Features

- **100% Offline**  => Utilizes Local LLM deployment via Ollama/LM studio
- **Natural Language** => Ask "show me the top 5 customers" and get results + exact SQL query used
- **Search All Tables** => Find a value across your entire database in one click 
- **Forensic Functions** => Built-in timestamp converters, Base64/Hex decode, pattern extractors 
- **Interactive Tables** => Sort, filter, paginate results. Dark/light theme 
- **Export Sessions** => Save your entire chat session via a nicely formatted HTML file

> **Note:** Designed for localhost use on a single workstation. For network deployment, set `SECRET_KEY` env var.

## Quick Start

**1. Download and Configure either Ollama or LM Studio** and load a model. For LM Studio, make sure to enable the local server on port `1234`.

> **LLM Model recommendation:** Ministral-3:7b or 14b, devstral-small-2:24b, GLM 4.6v flash, GLM 4.7 (30b). 

**2. Clone and run:**
```bash
git clone https://github.com/reisset/yourSQLfriend.git
cd yourSQLfriend
## Once inside the "yourSQLfriend" directory, activate the python virtual environment
python3 -m venv venv && source venv/bin/activate  # Windows: .\venv\Scripts\activate
pip install -r requirements.txt
## Finally, run the WebApp server, still from the command line:
flask run
```

**3. Open** [http://127.0.0.1:5000](http://127.0.0.1:5000) and drag in a `.db` file.

## For Forensic Purposes

- **Read-only guaranteed** - SQL validation + SQLite `mode=ro` blocks any writes
- **Chain of custody** - SHA256 hashes logged, timestamped exports
- **Audit logs** - All queries logged to `logs/` with daily rotation
- **Air-gapped safe** - Zero telemetry, no internet required

**Heads up:** WAL files (`.db-wal`, `.db-shm`) aren't uploaded with the main DB. Checkpoint first if you need recent transactions.

## Technology Stack

Flask, Vanilla JS, CSS for styling, HTML, and SQLite + Local LLM (OpenAI-compatible API)

## License

MIT

---

Built by [Reisset](https://github.com/reisset)
