# Copyright 2025 Reisset
# Licensed under the Apache License, Version 2.0
# See LICENSE file for details

# Standard Library
import sqlite3
import os
import sys
import gc
import time
import logging
import re
import uuid
import socket
import argparse
import webbrowser
import threading
from datetime import datetime

from html import escape as html_escape

# Flask
from flask import Flask, render_template, request, jsonify, session, make_response, Response, stream_with_context
from flask_session import Session
from werkzeug.utils import secure_filename

# Internal modules
from yoursqlfriend import __version__ as VERSION
from yoursqlfriend.validation import validate_sql, strip_strings_and_comments
from yoursqlfriend.database import (
    get_readonly_connection, execute_and_parse_query, calculate_file_hash,
    validate_upload_file, convert_csv_to_sqlite, execute_sql_file,
    build_rich_schema,
)
from yoursqlfriend.llm import (
    LLM_API_URL, OLLAMA_URL, OLLAMA_MODEL,
    check_llm_available, check_ollama_available,
    build_schema_context, build_system_prompt, build_error_correction_prompt,
    call_llm_non_streaming, stream_llm_response,
)

# --- Paths ---

def get_data_dir():
    """Get user data directory for uploads, logs, sessions"""
    if sys.platform == 'win32':
        base = os.environ.get('APPDATA', os.path.expanduser('~'))
    else:
        base = os.path.expanduser('~')

    data_dir = os.path.join(base, '.yourSQLfriend')
    os.makedirs(data_dir, exist_ok=True)
    return data_dir

# Set up paths
BASE_PATH = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = get_data_dir()

app = Flask(__name__,
            template_folder=os.path.join(BASE_PATH, 'templates'),
            static_folder=os.path.join(BASE_PATH, 'static'))

# --- Configuration ---
# Use environment variable for secret key, or default for dev
app.secret_key = os.environ.get('SECRET_KEY', 'dev-secret-key-change-me')
app.config['SESSION_TYPE'] = 'filesystem'
app.config['SESSION_FILE_DIR'] = os.path.join(DATA_DIR, 'sessions')
app.config['SESSION_PERMANENT'] = False
app.config['SESSION_USE_SIGNER'] = True

# --- Logging Setup ---
# Ensure upload directory exists (defined early for logging)
UPLOAD_FOLDER = os.path.join(DATA_DIR, 'uploads')
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

# Ensure logs directory exists
LOG_DIR = os.path.join(DATA_DIR, 'logs')
os.makedirs(LOG_DIR, exist_ok=True)

# Ensure sessions directory exists
os.makedirs(app.config['SESSION_FILE_DIR'], exist_ok=True)

# Configure structured logging with daily rotation
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler(os.path.join(LOG_DIR, f'analysis_{datetime.now().strftime("%Y%m%d")}.log')),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)

# Log application startup
logger.info("=" * 60)
logger.info("yourSQLfriend Forensic Analysis Tool Started")
logger.info(f"Upload directory: {os.path.abspath(UPLOAD_FOLDER)}")
logger.info("=" * 60)

# Initialize Server-side Session
Session(app)

# LLM Provider Configuration
LLM_PROVIDER = os.environ.get('LLM_PROVIDER', 'lmstudio')  # 'lmstudio' or 'ollama'

# --- Constants ---
MAX_HISTORY_MESSAGES = 20
MAX_STORED_MESSAGES = 100


def update_chat_history_with_results(chat_history, sql_query, results_dict):
    """Attach SQL query and result preview to the last assistant message in history."""
    if chat_history:
        last_msg = chat_history[-1]
        if last_msg['role'] == 'assistant':
            last_msg['sql_query'] = sql_query
            last_msg['query_results_preview'] = results_dict[:5]
            last_msg['total_results'] = len(results_dict)


@app.route('/api/ollama/status', methods=['GET'])
def ollama_status():
    """
    Check if Ollama is running and return available models.
    Returns: { available: bool, models: [string], default_model: string, selected_model: string }
    """
    available, models = check_ollama_available()
    return jsonify({
        'available': available,
        'models': models,
        'default_model': OLLAMA_MODEL,
        'selected_model': session.get('ollama_model', OLLAMA_MODEL)
    })

@app.route('/api/ollama/model', methods=['POST'])
def set_ollama_model():
    """Set the active Ollama model for this session."""
    data = request.json
    if not data:
        return jsonify({'error': 'Invalid request body'}), 400

    model = data.get('model')
    if not model:
        return jsonify({'error': 'Model name required'}), 400

    session['ollama_model'] = model
    session.modified = True
    logger.info(f"Ollama model set to: {model}")

    return jsonify({'status': 'success', 'model': model})

@app.route('/api/provider/status', methods=['GET'])
def get_provider_status():
    """Return current provider configuration and status."""
    provider = request.args.get('provider', session.get('llm_provider', LLM_PROVIDER))

    if provider == 'ollama':
        available, models = check_ollama_available()
        return jsonify({
            'provider': 'ollama',
            'available': available,
            'models': models,
            'selected_model': session.get('ollama_model', OLLAMA_MODEL),
            'url': OLLAMA_URL
        })
    else:
        # LM Studio check
        available = check_llm_available()
        return jsonify({
            'provider': 'lmstudio',
            'available': available,
            'models': [],
            'selected_model': None,
            'url': LLM_API_URL
        })

@app.route('/service-worker.js')
def service_worker():
    """Serve service worker from root scope for PWA support.

    Version is injected from app.py so CACHE_NAME updates automatically.
    """
    sw_path = os.path.join(app.static_folder, 'service-worker.js')
    with open(sw_path, 'r', encoding='utf-8') as f:
        content = f.read()
    content = content.replace('%%VERSION%%', VERSION)
    return content, 200, {
        'Content-Type': 'application/javascript',
        'Service-Worker-Allowed': '/'
    }

@app.route('/')
def index():
    ascii_art = ''
    ascii_path = os.path.join(BASE_PATH, 'ascii.txt')
    if os.path.exists(ascii_path):
        with open(ascii_path, 'r', encoding='utf-8') as f:
            ascii_art = f.read()
    return render_template('index.html', ascii_art=ascii_art, version=VERSION)

@app.route('/api/version')
def get_version():
    """Return the application version."""
    return jsonify({'version': VERSION})

@app.route('/upload', methods=['POST'])
def upload_file():
    """
    Upload and process database files with forensic integrity tracking.
    Supports: SQLite (.db, .sqlite, .sqlite3), CSV (.csv), SQL dumps (.sql)
    """
    # === VALIDATION PHASE ===
    if 'database_file' not in request.files:
        logger.warning("Upload attempt with no file part")
        return jsonify({'error': 'No file part'}), 400

    file = request.files['database_file']
    if file.filename == '':
        logger.warning("Upload attempt with empty filename")
        return jsonify({'error': 'No selected file'}), 400

    # Validate file (extension, size, emptiness)
    is_valid, error_msg, file_ext = validate_upload_file(file)
    if not is_valid:
        logger.warning(f"File validation failed: {error_msg}")
        return jsonify({'error': error_msg}), 400

    # === UPLOAD PHASE ===
    original_filename = file.filename
    secure_name = secure_filename(original_filename)
    if not secure_name:
        secure_name = f"upload_{uuid.uuid4().hex[:8]}{file_ext}"
    temp_filepath = os.path.join(UPLOAD_FOLDER, f"temp_{secure_name}")
    final_filepath = os.path.join(UPLOAD_FOLDER, secure_name)

    try:
        # Save uploaded file to temp location
        file.save(temp_filepath)
        logger.info(f"File saved: {secure_name} ({os.path.getsize(temp_filepath) / (1024*1024):.2f}MB)")

        # === HASHING PHASE ===
        file_hash = calculate_file_hash(temp_filepath)
        logger.info(f"SHA256: {file_hash}")

        # === FORMAT-SPECIFIC PROCESSING ===
        schema = {}

        if file_ext in ['.db', '.sqlite', '.sqlite3']:
            # SQLite database - validate integrity
            try:
                conn = sqlite3.connect(temp_filepath)
                try:
                    cursor = conn.cursor()

                    # Integrity check
                    cursor.execute("PRAGMA integrity_check;")
                    integrity = cursor.fetchone()[0]
                    if integrity != 'ok':
                        raise sqlite3.DatabaseError(f"Database integrity check failed: {integrity}")

                    # Extract schema
                    cursor.execute("SELECT name FROM sqlite_master WHERE type='table';")
                    tables = cursor.fetchall()
                    for table_name in tables:
                        table_name = table_name[0]
                        cursor.execute(f'PRAGMA table_info("{table_name}");')
                        columns = cursor.fetchall()
                        schema[table_name] = [column[1] for column in columns]
                finally:
                    conn.close()
                    del cursor
                    del conn
                    gc.collect()
                logger.info(f"SQLite validated: {len(schema)} tables found")

                # Move to final location (retry for Windows file lock release)
                for attempt in range(5):
                    try:
                        os.replace(temp_filepath, final_filepath)
                        break
                    except PermissionError:
                        if attempt < 4:
                            time.sleep(0.1)
                        else:
                            raise

            except sqlite3.Error as e:
                for attempt in range(5):
                    try:
                        if os.path.exists(temp_filepath):
                            os.remove(temp_filepath)
                        break
                    except PermissionError:
                        if attempt < 4:
                            time.sleep(0.1)
                        else:
                            logger.warning(f"Could not remove temp file: {temp_filepath}")
                logger.error(f"SQLite validation failed: {str(e)}")
                return jsonify({'error': f'Invalid SQLite database: {str(e)}'}), 400

        elif file_ext == '.csv':
            # CSV file - convert to SQLite
            final_db_path = os.path.splitext(final_filepath)[0] + '.db'
            try:
                schema = convert_csv_to_sqlite(temp_filepath, final_db_path)
                final_filepath = final_db_path  # Update to use converted DB
                os.remove(temp_filepath)  # Clean up original CSV
            except Exception as e:
                if os.path.exists(temp_filepath):
                    os.remove(temp_filepath)
                logger.error(f"CSV conversion failed: {str(e)}")
                return jsonify({'error': f'CSV conversion failed: {str(e)}'}), 400

        elif file_ext == '.sql':
            # SQL file - execute to create database
            final_db_path = os.path.splitext(final_filepath)[0] + '.db'
            try:
                schema = execute_sql_file(temp_filepath, final_db_path)
                final_filepath = final_db_path  # Update to use created DB
                os.remove(temp_filepath)  # Clean up original SQL file
            except Exception as e:
                if os.path.exists(temp_filepath):
                    os.remove(temp_filepath)
                logger.error(f"SQL execution failed: {str(e)}")
                return jsonify({'error': f'SQL file execution failed: {str(e)}'}), 400

        # === SESSION UPDATE PHASE ===
        session['db_filepath'] = final_filepath
        session['db_hash'] = file_hash
        session['original_filename'] = original_filename
        session['upload_timestamp'] = datetime.now().isoformat()
        session['file_size_bytes'] = os.path.getsize(final_filepath)
        session['chat_history'] = []  # Reset chat history
        # Cache schema context so build_schema_context() isn't called every message
        session['schema_context_cache'] = build_schema_context(final_filepath)
        session.modified = True

        logger.info(f"Database loaded successfully: {original_filename}")
        logger.info(f"Final path: {final_filepath}")
        logger.info(f"Schema: {len(schema)} tables")

        try:
            rich_schema = build_rich_schema(final_filepath)
        except sqlite3.Error as e:
            logger.warning(f"Could not build rich schema: {e}")
            rich_schema = {name: {"columns": [{"name": c, "type": "TEXT", "pk": False, "fk": None} for c in cols],
                                  "foreign_keys": [], "row_count": None, "sample_rows": []}
                           for name, cols in schema.items()}

        return jsonify({
            'schema': schema,
            'rich_schema': rich_schema,
            'metadata': {
                'filename': original_filename,
                'hash': file_hash,
                'size_mb': os.path.getsize(final_filepath) / (1024*1024),
                'tables': len(schema)
            }
        })

    except Exception as e:
        # Clean up on any error (retry for Windows file lock release)
        for attempt in range(5):
            try:
                if os.path.exists(temp_filepath):
                    os.remove(temp_filepath)
                break
            except PermissionError:
                if attempt < 4:
                    time.sleep(0.1)
                else:
                    logger.warning(f"Could not remove temp file: {temp_filepath}")
        logger.error(f"Upload failed: {str(e)}", exc_info=True)
        return jsonify({'error': f'Upload processing failed: {str(e)}'}), 500


@app.route('/chat_stream', methods=['POST'])
def chat_stream():
    logger.info("--- Chat Request Start ---")

    # Validate request body
    data = request.json
    if not data:
        logger.warning("Chat request with invalid JSON body")
        return jsonify({'error': 'Invalid request body'}), 400

    user_message = data.get('message')
    provider = data.get('provider', session.get('llm_provider', LLM_PROVIDER))
    db_filepath = session.get('db_filepath')
    chat_history = session.get('chat_history', [])

    logger.info(f"Provider: {provider}")
    logger.debug(f"Loaded chat_history length: {len(chat_history)}")

    if not user_message:
        logger.warning("Chat request with empty message")
        return jsonify({'error': 'Empty message'}), 400

    # Health Check based on provider
    if provider == 'ollama':
        available, _ = check_ollama_available()
        if not available:
            logger.error("LLM Health Check Failed: Ollama not reachable")
            return jsonify({'error': f'Ollama is not running or not reachable at {OLLAMA_URL}. Run "ollama serve" to start it.'}), 503
    else:
        if not check_llm_available():
            logger.error("LLM Health Check Failed: LM Studio not reachable")
            return jsonify({'error': 'LM Studio is not running or not reachable at http://localhost:1234.'}), 503

    # Use cached schema context (built on upload), fall back to fresh build
    schema_context = ""
    if db_filepath:
        schema_context = session.get('schema_context_cache', '')
        if not schema_context:
            try:
                schema_context = build_schema_context(db_filepath)
                session['schema_context_cache'] = schema_context
                session.modified = True
            except sqlite3.Error as e:
                logger.error(f"Database access error during schema injection: {e}")
                return jsonify({'error': f"Database access error: {e}"}), 500

    # Append user message to history
    chat_history.append({
        "role": "user",
        "content": user_message,
        "id": str(uuid.uuid4())
    })

    # Build messages for LLM (strip metadata, cap history length)
    system_prompt = build_system_prompt(schema_context)
    recent_history = chat_history[-MAX_HISTORY_MESSAGES:]
    messages_to_send = [{"role": "system", "content": system_prompt}] + [
        {"role": msg["role"], "content": msg["content"]}
        for msg in recent_history
    ]
    logger.info(f"Messages to send count: {len(messages_to_send)}")

    # Stream based on provider
    model = session.get('ollama_model', OLLAMA_MODEL) if provider == 'ollama' else None
    if model:
        logger.info(f"Using Ollama model: {model}")
    return Response(stream_with_context(stream_llm_response(messages_to_send, provider, model)), content_type='text/plain')

@app.route('/save_assistant_message', methods=['POST'])
def save_assistant_message():
    data = request.json
    if not data:
        return jsonify({'error': 'Invalid request body'}), 400

    content = data.get('content')
    token_usage = data.get('token_usage')  # Optional: may be None

    if not content:
        return jsonify({'error': 'No content provided'}), 400

    chat_history = session.get('chat_history', [])

    # Build assistant message with optional token usage
    msg_id = str(uuid.uuid4())
    assistant_message = {
        "role": "assistant",
        "content": content,
        "id": msg_id
    }
    if token_usage:
        assistant_message['token_usage'] = token_usage

    chat_history.append(assistant_message)
    # Cap stored history to prevent unbounded session growth
    if len(chat_history) > MAX_STORED_MESSAGES:
        chat_history = chat_history[-MAX_STORED_MESSAGES:]
    session['chat_history'] = chat_history
    session.modified = True  # Critical: Force session update

    return jsonify({'status': 'success', 'message_id': msg_id})

@app.route('/execute_sql', methods=['POST'])
def execute_sql():
    data = request.json
    if not data:
        logger.warning("Execute SQL attempt with invalid JSON body")
        return jsonify({'error': 'Invalid request body'}), 400

    sql_query = data.get('sql_query')
    db_filepath = session.get('db_filepath')
    chat_history = session.get('chat_history', [])

    if not sql_query or not db_filepath:
        logger.warning("Execute SQL attempt missing query or database")
        return jsonify({'error': 'Missing SQL or Database'}), 400

    # Log the attempt
    logger.info(f"SQL Execution Attempt: {sql_query}")

    # SECURITY CHECK
    is_valid, error_msg = validate_sql(sql_query)
    if not is_valid:
        logger.warning(f"SQL Blocked by Validation: {error_msg} | Query: {sql_query}")
        return jsonify({'error': error_msg}), 403

    try:
        results_dict = execute_and_parse_query(db_filepath, sql_query)
        logger.info(f"SQL Executed Successfully. Rows returned: {len(results_dict)}")

        update_chat_history_with_results(chat_history, sql_query, results_dict)
        session['chat_history'] = chat_history

        return jsonify({
            'response': f"Found {len(results_dict)} results.",
            'query_results': results_dict
        })

    except sqlite3.Error as e:
        logger.warning(f"SQL Execution Error (will attempt retry): {e} | Query: {sql_query}")

        # Attempt auto-correction via LLM (max 1 retry)
        try:
            schema_context = build_schema_context(db_filepath, include_samples=False)
            correction_prompt = build_error_correction_prompt(str(e), sql_query, schema_context)

            provider = session.get('llm_provider', LLM_PROVIDER)
            model = session.get('ollama_model', OLLAMA_MODEL) if provider == 'ollama' else None
            messages = [
                {"role": "system", "content": "You are a SQL correction assistant. Output only the corrected SQL in a ```sql code block."},
                {"role": "user", "content": correction_prompt}
            ]

            llm_response = call_llm_non_streaming(messages, provider=provider, model=model)

            # Extract SQL from response
            sql_match = re.search(r'```sql\n([\s\S]*?)\n```', llm_response)
            if not sql_match:
                raise ValueError("LLM did not return corrected SQL")

            corrected_sql = sql_match.group(1).strip()
            logger.info(f"LLM suggested correction: {corrected_sql}")

            # Validate corrected SQL
            is_valid_retry, retry_error = validate_sql(corrected_sql)
            if not is_valid_retry:
                raise ValueError(f"Corrected SQL failed validation: {retry_error}")

            results_dict = execute_and_parse_query(db_filepath, corrected_sql)
            logger.info(f"Retry SQL Executed Successfully. Rows returned: {len(results_dict)}")

            update_chat_history_with_results(chat_history, corrected_sql, results_dict)
            session['chat_history'] = chat_history

            return jsonify({
                'response': f"Found {len(results_dict)} results.",
                'query_results': results_dict,
                'retried': True,
                'original_sql': sql_query,
                'corrected_sql': corrected_sql
            })

        except Exception as retry_error:
            logger.error(f"SQL retry also failed: {retry_error} | Original query: {sql_query}")
            return jsonify({'error': f"SQL Error: {e}"}), 500

@app.route('/search_all_tables', methods=['POST'])
def search_all_tables():
    """
    Search for a term across all text columns in all tables.
    Returns compact format: table -> column -> matched values.
    """
    data = request.json
    if not data:
        return jsonify({'error': 'Invalid request body'}), 400

    search_term = data.get('search_term', '').strip()
    case_sensitive = data.get('case_sensitive', False)
    db_filepath = session.get('db_filepath')

    if not search_term:
        return jsonify({'error': 'Search term is required'}), 400
    if not db_filepath:
        return jsonify({'error': 'No database loaded'}), 400

    logger.info(f"Search All Tables: '{search_term}' (case_sensitive={case_sensitive})")

    try:
        with get_readonly_connection(db_filepath) as conn:
            cursor = conn.cursor()

            # Get all tables (skip internal SQLite tables)
            cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
            tables = [row[0] for row in cursor.fetchall()]

            results = {}

            for table in tables:
                # Get column info for this table
                cursor.execute(f'PRAGMA table_info("{table}")')
                columns = cursor.fetchall()

                # Get all column names (SQLite is dynamically typed, search everything)
                all_columns = [col[1] for col in columns]

                if not all_columns:
                    continue

                table_matches = {'total_matches': 0, 'columns': {}}

                for col in all_columns:
                    try:
                        # Build query based on case sensitivity
                        if case_sensitive:
                            query = f'SELECT DISTINCT "{col}" FROM "{table}" WHERE "{col}" LIKE ? AND "{col}" GLOB ?'
                            # GLOB is case-sensitive, LIKE finds candidates
                            params = [f'%{search_term}%', f'*{search_term}*']
                        else:
                            query = f'SELECT DISTINCT "{col}" FROM "{table}" WHERE "{col}" LIKE ?'
                            params = [f'%{search_term}%']

                        cursor.execute(query, params)
                        rows = cursor.fetchall()

                        # Filter and collect matched values
                        matched_values = []
                        for row in rows:
                            val = row[0]
                            if val is not None:
                                val_str = str(val)
                                if case_sensitive:
                                    if search_term in val_str:
                                        matched_values.append(val_str)
                                else:
                                    if search_term.lower() in val_str.lower():
                                        matched_values.append(val_str)

                        if matched_values:
                            # Store first 3 unique values for display, plus total count
                            table_matches['columns'][col] = matched_values[:3]
                            table_matches['total_matches'] += len(matched_values)

                    except sqlite3.Error as e:
                        logger.warning(f"Search error in {table}.{col}: {e}")
                        continue

                if table_matches['total_matches'] > 0:
                    results[table] = table_matches

        total = sum(t['total_matches'] for t in results.values())
        logger.info(f"Search complete: {total} matches in {len(results)} tables")

        return jsonify({
            'results': results,
            'total_matches': total,
            'tables_with_matches': len(results)
        })

    except sqlite3.Error as e:
        logger.error(f"Search All Tables Error: {e}")
        return jsonify({'error': f'Database error: {e}'}), 500

def _get_css_content():
    css_path = os.path.join(BASE_PATH, 'static', 'style.css')
    try:
        with open(css_path, 'r', encoding='utf-8') as f:
            return f.read()
    except FileNotFoundError:
        return ""

def _generate_chat_html(chat_history):
    chat_html_parts = []
    cumulative_tokens = 0  # Track cumulative tokens for export

    for entry in chat_history:
        role = entry.get("role")
        content = entry.get("content", "")

        if role == "user":
            user_text = content.split("User Question: ")[-1] if "User Question: " in content else content
            chat_html_parts.append(f'<div class="chat-message user-message"><p>{html_escape(user_text)}</p></div>')

        elif role == "assistant":
            # Build token counter HTML if usage data exists
            token_html = ""
            token_usage = entry.get("token_usage")
            if token_usage:
                prompt_tokens = token_usage.get('prompt_tokens', 0)
                completion_tokens = token_usage.get('completion_tokens', 0)
                total_tokens = token_usage.get('total_tokens', 0)
                cumulative_tokens += total_tokens
                token_html = f'''<div class="token-counter" data-tokens="{total_tokens}">
                    <span title="Prompt: {prompt_tokens} | Completion: {completion_tokens}">{total_tokens} tokens ({cumulative_tokens} total)</span>
                </div>'''

            parts = [f"<p>{html_escape(content)}</p>"]
            if entry.get("sql_query"):
                parts.append(f"<pre><code>{html_escape(entry['sql_query'])}</code></pre>")

            preview = entry.get("query_results_preview")
            if preview:
                headers = preview[0].keys()
                table = "<table><thead><tr>" + "".join(f"<th>{html_escape(str(h))}</th>" for h in headers) + "</tr></thead><tbody>"
                for row in preview:
                    table += "<tr>" + "".join(f"<td>{html_escape(str(row[h]))}</td>" for h in headers) + "</tr>"
                table += "</tbody></table>"
                parts.append(f'<div class="results-table-container">{table}</div>')

            # Wrap in content-container with token counter
            content_html = f'<div class="content-container">{token_html}{"".join(parts)}</div>'
            chat_html_parts.append(f'<div class="chat-message bot-message">{content_html}</div>')

    return "\n".join(chat_html_parts)

@app.route('/api/row/lookup', methods=['POST'])
def row_lookup():
    """Look up rows in `table` where `column` == `value`. Parameterized; read-only.

    Used by the Row Inspector to follow foreign keys. Identifiers are
    validated against the actual schema (not substituted from user input).
    """
    data = request.json or {}
    table = data.get('table')
    column = data.get('column')
    value = data.get('value')
    limit = int(data.get('limit', 25))

    db_filepath = session.get('db_filepath')
    if not db_filepath:
        return jsonify({'error': 'No database loaded'}), 400
    if not table or not column:
        return jsonify({'error': 'table and column are required'}), 400

    try:
        with get_readonly_connection(db_filepath) as conn:
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()

            cursor.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name=?;",
                (table,),
            )
            if not cursor.fetchone():
                return jsonify({'error': f'Unknown table: {table}'}), 400

            cursor.execute(f'PRAGMA table_info("{table}");')
            valid_cols = {row[1] for row in cursor.fetchall()}
            if column not in valid_cols:
                return jsonify({'error': f'Unknown column: {column}'}), 400

            cursor.execute(
                f'SELECT * FROM "{table}" WHERE "{column}" = ? LIMIT ?;',
                (value, max(1, min(limit, 200))),
            )
            rows = [dict(r) for r in cursor.fetchall()]
        return jsonify({'rows': rows})

    except sqlite3.Error as e:
        logger.error(f"Row lookup error: {e}")
        return jsonify({'error': f'Database error: {e}'}), 500

EXPORT_CSS = """
:root {
  --bg:#f4efe4; --bg-2:#ece6d6; --ink:#1a1815; --ink-2:#3b372f;
  --ink-3:#6e6a5e; --ink-4:#a39e8e; --line:#d4ccb8; --line-2:#bdb39d;
  --accent:#c1522b; --accent-2:#9c3f1c; --accent-wash:#f5e0d3;
  --hilite:#fceeb0; --ok:#4a7a4a;
  --serif: Georgia, 'Times New Roman', serif;
  --mono: 'JetBrains Mono', ui-monospace, monospace;
}
* { box-sizing: border-box; }
body {
  margin: 0; background: var(--bg); color: var(--ink);
  font-family: -apple-system, 'Segoe UI', Roboto, sans-serif;
  font-size: 14px; line-height: 1.55;
}
.report { max-width: 900px; margin: 0 auto; padding: 40px 32px; }
.report-header {
  border-left: 3px solid var(--accent);
  background: var(--bg-2);
  padding: 18px 22px; margin-bottom: 28px;
  border-radius: 0 4px 4px 0;
}
.report-header .kicker {
  font-family: var(--mono); font-size: 10px;
  letter-spacing: .16em; text-transform: uppercase;
  color: var(--accent); font-weight: 600;
  margin-bottom: 6px;
}
.report-header h1 {
  margin: 0 0 10px;
  font-family: var(--serif); font-weight: 500; font-size: 24px;
  letter-spacing: -.01em; color: var(--ink);
}
.report-header .meta {
  display: grid; grid-template-columns: max-content 1fr;
  gap: 2px 14px;
  font-family: var(--mono); font-size: 11px; color: var(--ink-2);
}
.report-header .meta dt { color: var(--ink-3); }
.report-header .meta dd { margin: 0; word-break: break-all; }
.chat-message {
  padding: 10px 0 16px;
  border-bottom: 1px solid var(--line);
  margin-bottom: 12px;
}
.chat-message:last-child { border-bottom: none; }
.chat-message.user-message p {
  margin: 0; font-family: var(--serif); font-size: 18px;
  color: var(--ink); font-weight: 400; line-height: 1.4;
}
.chat-message.bot-message p { margin: 0 0 8px; color: var(--ink-2); }
.chat-message.bot-message pre {
  margin: 8px 0;
  padding: 10px 14px;
  background: var(--bg-2);
  border: 1px solid var(--line);
  border-radius: 4px;
  font-family: var(--mono); font-size: 12px;
  color: var(--ink); overflow-x: auto;
}
.token-counter { font-family: var(--mono); font-size: 10px; color: var(--ink-4); margin-bottom: 4px; }
.results-table-container {
  border: 1px solid var(--line);
  border-radius: 4px;
  overflow-x: auto;
  margin: 8px 0 4px;
  background: var(--bg);
}
.results-table-container table {
  width: 100%; border-collapse: collapse;
  font-family: var(--mono); font-size: 11.5px;
}
.results-table-container th {
  text-align: left; padding: 6px 10px;
  background: var(--bg-2); color: var(--ink-3);
  font-weight: 600; border-bottom: 1px solid var(--line);
}
.results-table-container td {
  padding: 5px 10px;
  color: var(--ink-2);
  border-bottom: 1px solid var(--line);
}
.results-table-container tr:last-child td { border-bottom: none; }
.footer-note {
  margin-top: 40px; padding-top: 16px;
  border-top: 1px solid var(--line);
  font-family: var(--mono); font-size: 10px; color: var(--ink-3);
  text-align: center;
}
"""


@app.route('/export_chat', methods=['GET'])
def export_chat():
    chat_history = session.get('chat_history', [])

    # Gather Metadata (escape user-provided values for XSS prevention)
    original_filename = html_escape(session.get('original_filename', 'Unknown'))
    db_hash = session.get('db_hash', 'N/A')
    upload_timestamp = html_escape(session.get('upload_timestamp', 'N/A'))
    file_size_bytes = session.get('file_size_bytes', 0)
    export_timestamp = datetime.now().isoformat()
    hostname = html_escape(socket.gethostname())
    file_size_mb = file_size_bytes / (1024*1024)
    safe_hash = html_escape(db_hash)
    hash_abbrev = (f"{db_hash[:16]}…{db_hash[-8:]}" if len(db_hash) >= 24 else db_hash)

    header_html = f"""
    <header class="report-header">
        <div class="kicker">Forensic Report</div>
        <h1>{original_filename}</h1>
        <dl class="meta">
            <dt>Size</dt><dd>{file_size_mb:.2f} MB</dd>
            <dt>SHA-256</dt><dd title="{safe_hash}">{html_escape(hash_abbrev)}</dd>
            <dt>Uploaded</dt><dd>{upload_timestamp}</dd>
            <dt>Exported</dt><dd>{html_escape(export_timestamp)}</dd>
            <dt>Host</dt><dd>{hostname}</dd>
            <dt>Mode</dt><dd>read-only</dd>
        </dl>
    </header>
    """

    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>Forensic Report — {original_filename}</title>
    <style>{EXPORT_CSS}</style>
</head>
<body>
    <div class="report">
        {header_html}
        {_generate_chat_html(chat_history)}
        <div class="footer-note">yourSQLfriend v{VERSION} · generated {html_escape(export_timestamp)}</div>
    </div>
</body>
</html>"""

    # Generate timestamped filename for the download
    safe_date = datetime.now().strftime("%Y%m%d_%H%M%S")
    filename = f"Analysis_Report_{safe_date}.html"

    resp = make_response(html)
    resp.headers["Content-Disposition"] = f"attachment; filename={filename}"
    return resp

@app.errorhandler(404)
def not_found_error(error):
    logger.warning(f"404 Error: {request.url}")
    return jsonify({'error': 'Resource not found'}), 404

@app.errorhandler(500)
def internal_error(error):
    logger.error(f"500 Error: {error}", exc_info=True)
    return jsonify({'error': 'Internal server error'}), 500

@app.errorhandler(Exception)
def unhandled_exception(e):
    logger.error(f"Unhandled Exception: {e}", exc_info=True)
    return jsonify({'error': str(e)}), 500

def main():
    parser = argparse.ArgumentParser(description='yourSQLfriend — SQLite forensic analysis tool')
    parser.add_argument('--port', type=int, default=5000, help='Port to run on (default: 5000)')
    parser.add_argument('--host', default='127.0.0.1', help='Host to bind to (default: 127.0.0.1)')
    parser.add_argument('--no-browser', action='store_true', help='Do not auto-open browser')
    args = parser.parse_args()

    if not args.no_browser:
        url = f'http://{args.host}:{args.port}'
        threading.Timer(1.5, webbrowser.open, args=[url]).start()

    app.run(
        host=args.host,
        port=args.port,
        debug=os.environ.get('FLASK_DEBUG', 'False').lower() == 'true'
    )

if __name__ == '__main__':
    main()
