# mySQLhelper

**mySQLhelper** is a private, offline-first AI analytics tool that allows you to chat with your local LLM about SQLite databases. It bridges the gap between natural language questions and SQL execution, all running securely on your local machine.

> **⚠️ Local Deployment Only**
> This tool is designed to run on `localhost` (127.0.0.1) only and assumes a single trusted user on a forensic workstation. If exposing to a network, set the `SECRET_KEY` environment variable to a secure random value. All security responsibilities (firewall, user permissions, system hardening) remain with the deploying analyst.


https://github.com/user-attachments/assets/22dd82a3-7108-41c8-8a25-b71f4dae7147




![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Version](https://img.shields.io/badge/version-2.0-blue)
![Python](https://img.shields.io/badge/python-3.10%2B-blue)
![Flask](https://img.shields.io/badge/flask-3.x-green)

## Features

*   **🔒 100% Offline:** No data leaves your network. Works with local LLMs (via LM Studio).
*   **🔐 Defense-in-Depth Security:** Two-layer read-only enforcement (validation + SQLite database mode).
*   **📂 Visual Drag-and-Drop:** dedicated drop zone for uploading `.db` or `.sqlite` files instantly with visual feedback.
*   **💬 Natural Language Chat:** Ask "Who are the top 5 customers?" and get results.
*   **🧠 Transparent AI:** See the exact SQL generated before it runs.
*   **🔍 Advanced Analytics:** Support for CTEs (WITH clauses), EXPLAIN queries, and PRAGMA commands for deep database analysis.
*   **🔎 Search All Tables:** Full-text search across all tables with compact grouped results and case sensitivity toggle.
*   **🧮 Forensic SQL Functions:** Built-in functions for timestamp conversion (Unix, WebKit, iOS, Windows FILETIME), Base64/Hex encoding, and pattern extraction (emails, IPs, URLs, phones).
*   **📊 Rich Visualization:** Interactive tables with multi-column sorting, regex filtering, and quick pattern buttons.
*   **🌓 Dark/Light Theme:** Toggle between dark and light modes with persistent preference.
*   **📤 CSV Export:** Export query results with metadata headers for documentation.
*   **✨ Polished UI/UX:** Responsive theme with optimized scrolling for large datasets.
*   **🛡️ Safe Mode:** Confirmation dialogs and browser warnings prevent accidental data loss.
*   **💾 Exportable:** Save your entire analysis session as an HTML file with high-fidelity layout.


## Prerequisites

Before running the application, you need to set up your environment.

### 1. Python
Ensure you have **Python 3.10** or higher installed. You can download it from [python.org](https://www.python.org/).

### 2. Local AI Server (LM Studio)
This application relies on a local AI model to function.

1.  **Download & Install:** Get **[LM Studio](https://lmstudio.ai/)** (or any OpenAI-compatible local server).
2.  **Get a Model:** Search for and download a model of your choice.
    *   *Recommendations:* `RNJ1`, `Qwen3-Coder-30b `, or `Mistral (devstral-small-2) and ministral3-14b-reasoning`.
    *   *Tip:* Pick a model size (quantization) that fits your computer's RAM/VRAM.
3.  **Enable Server Mode:**
    *   Click the **Developer** tab (the `>_` icon) on the left sidebar.
    *   Toggle **"Start Local Server"** to ON.
    *   Ensure the port is set to `1234` (default).
4.  **Load the Model:**
    *   Select your downloaded model from the top dropdown.
    *   Adjust settings if needed (Context Length, Max Tokens, Temperature).
    *   Wait for the green bar to indicate the model is loaded.
5.  **Done! 🔥** Your AI brain is ready.

## Quick Start Guide

Follow these steps to get the app running on your computer.

### Step 1: Get the Code
Open your terminal (Command Prompt, PowerShell, or Terminal on Mac) and run the following command to download the project:

```bash
git clone https://github.com/reisset/mysqlhelper.git
```

### Step 2: Navigate to the Project
Move into the newly created folder:

```bash
cd mysqlhelper
```

### Step 3: Create a Virtual Environment
This isolates the project's libraries from your system. Run the command for your OS:

*   **Windows:**
    ```bash
    python -m venv venv
    .\venv\Scripts\activate
    ```
*   **Mac / Linux:**
    ```bash
    python3 -m venv venv
    source venv/bin/activate
    ```

### Step 4: Install Dependencies
Install all the required Python tools:

```bash
pip install -r requirements.txt
```

### Step 5: Run the App
Start the web server:

```bash
flask run
```

### Step 6: Use It!
Open your web browser (Chrome, Firefox, Edge) and go to:
[http://127.0.0.1:5000](http://127.0.0.1:5000)

## Forensic Analyst Notes

This tool is designed with digital forensics workflows in mind.

*   **Non-Destructive:** The application works on a **copy** of your database uploaded to the `uploads/` directory. The original evidence file is never accessed or modified.
*   **Read-Only Enforcement:** The backend strictly enforces `SELECT`-only queries via regex validation. `DROP`, `INSERT`, `UPDATE`, and other modification commands are blocked at the application level.
*   **Chain of Custody:** The "Export Chat" feature provides a timestamped HTML report of the entire analysis session, including the exact SQL queries generated and executed, suitable for case documentation.
*   **Audit Logging:** Comprehensive activity logs are generated in the `logs/` directory with daily rotation, capturing file uploads (with SHA256 hashes), SQL execution attempts, and system errors for post-analysis review.
*   **Air-Gapped Safe:** The tool has zero telemetry and requires no internet connection (when used with a local LLM), ensuring sensitive case data never leaves the forensic workstation.
*   **Limitation (WAL Files):** Currently, the tool uploads a single `.db` or `.sqlite` file. If your target database has active Write-Ahead Logging (WAL) files (`.db-wal`, `.db-shm`), you must merge them (checkpoint) or export the database before uploading, otherwise recent transactions may be missing.

## Architecture

*   **Backend:** Python Flask + Flask-Session
*   **Frontend:** Vanilla JS + CSS (Open WebUI inspired)
*   **AI Engine:** Local LLM via HTTP (e.g., Qwen 2.5 Coder)

## License

MIT - Use freely in your projects

## Author

Created by Reisset
