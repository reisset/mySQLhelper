# mySQLhelper

**mySQLhelper** is a private, offline-first AI analytics tool that allows you to chat with your local SQLite databases. It bridges the gap between natural language questions and SQL execution, all running securely on your local machine.

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Python](https://img.shields.io/badge/python-3.10%2B-blue)
![Flask](https://img.shields.io/badge/flask-3.x-green)

## Features

*   **🔒 100% Offline:** No data leaves your network. Works with local LLMs (via LM Studio).
*   **📂 Drag-and-Drop:** Upload `.db` or `.sqlite` files instantly.
*   **💬 Natural Language Chat:** Ask "Who are the top 5 customers?" and get results.
*   **🧠 Transparent AI:** See the exact SQL generated before it runs.
*   **📊 Rich Visualization:** Interactive tables and Markdown explanations.
*   **💾 Exportable:** Save your entire analysis session as an HTML file.

## Prerequisites

1.  **Python 3.10+**
2.  **LM Studio** (or any OpenAI-compatible local LLM server) running on port `1234`.

## Quick Start

1.  **Clone the repository:**
    ```bash
    git clone https://github.com/yourusername/mysqlhelper.git
    cd mysqlhelper
    ```

2.  **Set up environment:**
    ```bash
    python -m venv venv
    # Windows:
    .\venv\Scripts\activate
    # Mac/Linux:
    source venv/bin/activate
    ```

3.  **Install dependencies:**
    ```bash
    pip install -r requirements.txt
    ```

4.  **Run the app:**
    ```bash
    flask run
    ```

5.  **Open in Browser:**
    Go to `http://127.0.0.1:5000`

## Architecture

*   **Backend:** Python Flask + Flask-Session
*   **Frontend:** Vanilla JS + CSS (Open WebUI inspired)
*   **AI Engine:** Local LLM via HTTP (e.g., Qwen 2.5 Coder)

## License

MIT
