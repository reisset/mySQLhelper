# GEMINI.md

## Project Overview

**mySQLhelper** is a robust, offline-first web application that empowers users to analyze local SQLite databases using natural language. Built with Python (Flask) and a vanilla JavaScript frontend, it mimics the aesthetics of modern chat interfaces like Open WebUI while keeping all data processing local.

### Core Features

- **Local & Offline:** Operates entirely on the user's machine. No data leaves the local network.
- **Dynamic Database Loading:** Users can upload and switch between SQLite database files (`.db`, `.sqlite`) instantly.
- **Natural Language Querying:** Integrates with local LLMs (via LM Studio) to translate English questions into SQL queries.
- **Streaming Responses:** Real-time text generation with a "Thinking..." indicator for a responsive UX.
- **Rich Data Visualization:**
    - Markdown rendering for text explanations.
    - Interactive data grids for SQL results.
    - Automatic schema visualization upon database load.
- **Safe Execution:** Read-only SQL execution prevents accidental data modification.
- **Chat Export:** Export the full conversation, including analysis and tables, to a self-contained HTML file.

## Architecture

The application follows a clean MVC-style pattern:

- **Backend (`app.py`):**
    - **Flask Server:** Handles HTTP requests and serves the frontend.
    - **Flask-Session:** Manages chat history and state on the server filesystem, bypassing cookie size limits.
    - **Stream Handler:** Implements a generator for streaming LLM tokens to the client.
    - **SQL Executor:** A dedicated endpoint to safely run generated SQL against the loaded database.
- **Frontend (`static/` & `templates/`):**
    - **Vanilla JS (`script.js`):** Manages the chat UI, handles streaming (TextDecoder), parses Markdown (via local `marked.js`), and coordinates the two-step execution flow.
    - **CSS (`style.css`):** A custom dark theme with flexbox layouts for a polished look.
- **Data Storage:**
    - **`uploads/`:** Temporarily stores the loaded SQLite database.
    - **`flask_session/`:** Stores active user session data (chat history, file paths).

## Building and Running

### 1. Environment Setup

It is recommended to use a Python virtual environment.

```bash
# Create a virtual environment
python -m venv venv

# Activate the virtual environment
# On Windows:
.\venv\Scripts\activate
# On macOS/Linux:
source venv/bin/activate
```

### 2. Install Dependencies

Install the required packages from `requirements.txt`:

```bash
pip install -r requirements.txt
```

**Key Dependencies:**
- `Flask`: Web framework.
- `Flask-Session`: Server-side session management.
- `requests`: HTTP client for communicating with the LLM.
- `pandas` & `SQLAlchemy`: Data manipulation (optional for future analysis features).

### 3. LLM Setup (LM Studio)

1. Download and install **LM Studio**.
2. Load a coding-capable model (e.g., `Qwen2.5-Coder-7B-Instruct`).
3. Start the Local Server with these settings:
   - **Port:** `1234`
   - **Cross-Origin-Resource-Sharing (CORS):** Enabled (On)
   - **Endpoint:** `http://localhost:1234/v1`

### 4. Running the Application

Start the Flask development server:

```bash
flask run
```
*Or on Windows:*
```bash
.\venv\Scripts\python.exe -m flask run
```

Access the application at `http://127.0.0.1:5000`.

## Usage Guide

1. **Load Database:** Click "Choose File" to select a SQLite database, then "Upload & Load". The schema will appear in the sidebar.
2. **Chat:** Type a question (e.g., "Show me the top 5 customers by sales").
3. **Analyze:** The LLM will explain its thought process, generate SQL, and the app will execute it and display the results table.
4. **Export:** Click "Export Chat" to save the entire session.

## Known Limitations

- **Large Datasets:** SQL results are currently capped at 2000 rows in the backend to prevent browser performance issues. The frontend displays results in batches of 20.
- **Single Session:** The application is designed for a single user per browser session. Multi-user concurrency would require a production WSGI server (like Gunicorn) and more robust session key management.