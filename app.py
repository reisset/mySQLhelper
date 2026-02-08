# Copyright 2025 Reisset
# Licensed under the Apache License, Version 2.0
# See LICENSE file for details

# Standard Library
import sqlite3
import os
import sys
import hashlib
import logging
import re
import json
import uuid
import argparse
import webbrowser
import threading
from datetime import datetime, timedelta
import base64
from html import escape as html_escape

# Third-party
import requests
import pandas as pd

# Flask
from flask import Flask, render_template, request, jsonify, session, make_response, Response, stream_with_context
from flask_session import Session
from werkzeug.utils import secure_filename

# --- Version ---
VERSION = "3.4.1"

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
LLM_API_URL = os.environ.get('LLM_API_URL', "http://localhost:1234/v1/chat/completions")
OLLAMA_URL = os.environ.get('OLLAMA_URL', "http://localhost:11434")
OLLAMA_MODEL = os.environ.get('OLLAMA_MODEL', 'llama3.2')

def strip_strings_and_comments(sql):
    """
    Remove string literals and comments from SQL for security analysis.
    This prevents false positives from content inside strings/comments.
    """
    result = []
    i = 0
    in_single_quote = False
    in_double_quote = False

    while i < len(sql):
        # Handle single-line comments (-- style)
        if not in_single_quote and not in_double_quote and sql[i:i+2] == '--':
            # Skip to end of line
            while i < len(sql) and sql[i] != '\n':
                i += 1
            continue

        # Handle multi-line comments (/* */ style)
        if not in_single_quote and not in_double_quote and sql[i:i+2] == '/*':
            i += 2
            while i < len(sql) - 1 and sql[i:i+2] != '*/':
                i += 1
            i += 2  # Skip closing */
            continue

        # Handle single quotes (with escape handling)
        if sql[i] == "'" and not in_double_quote:
            if in_single_quote:
                # Check for escaped quote ('')
                if i + 1 < len(sql) and sql[i+1] == "'":
                    i += 2
                    continue
                in_single_quote = False
            else:
                in_single_quote = True
            i += 1
            continue

        # Handle double quotes
        if sql[i] == '"' and not in_single_quote:
            if in_double_quote:
                if i + 1 < len(sql) and sql[i+1] == '"':
                    i += 2
                    continue
                in_double_quote = False
            else:
                in_double_quote = True
            i += 1
            continue

        # Only include characters outside of strings
        if not in_single_quote and not in_double_quote:
            result.append(sql[i])

        i += 1

    return ''.join(result)


def validate_sql(sql):
    """
    Validates that SQL queries are read-only and safe for forensic analysis.

    Allowed: SELECT, WITH (CTEs), EXPLAIN, read-only PRAGMAs
    Blocked: Any data modification commands
    """
    sql_stripped = sql.strip()

    # Skip leading SQL comments (-- style) to find the actual query start
    lines = sql_stripped.split('\n')
    first_code_line = ''
    for line in lines:
        stripped_line = line.strip()
        if stripped_line and not stripped_line.startswith('--'):
            first_code_line = stripped_line
            break

    sql_upper = sql_stripped.upper()
    first_code_upper = first_code_line.upper()

    # Rule 1: Allow read-only query patterns
    allowed_starts = ["SELECT", "WITH", "EXPLAIN", "PRAGMA"]
    if not any(first_code_upper.startswith(start) for start in allowed_starts):
        return False, f"Query must start with: {', '.join(allowed_starts)}"

    # Rule 2: No multiple statements
    # Strip strings and comments first to avoid false positives
    sql_for_analysis = strip_strings_and_comments(sql)
    sql_trimmed = sql_for_analysis.rstrip().rstrip(';').rstrip()
    if ';' in sql_trimmed:
        return False, "Security Warning: Multiple SQL statements are not allowed."

    # Rule 3: Strict blocklist of modification keywords
    forbidden_keywords = [
        "DROP", "DELETE", "INSERT", "UPDATE", "ALTER",
        "TRUNCATE", "EXEC", "GRANT", "REVOKE", "CREATE",
        "ATTACH", "DETACH", "REPLACE", "VACUUM",
        "SAVEPOINT", "RELEASE", "REINDEX"
    ]
    for keyword in forbidden_keywords:
        if re.search(r'\b' + keyword + r'\b', sql_upper):
            return False, f"Security Warning: Query contains forbidden keyword '{keyword}'."

    # Rule 4: Validate CTEs contain SELECT
    if sql_upper.startswith("WITH"):
        if "SELECT" not in sql_upper:
            return False, "CTE (WITH clause) must contain a SELECT statement."

    # Rule 5: PRAGMA safety check - block write-capable PRAGMAs
    if sql_upper.startswith("PRAGMA"):
        write_pragmas = [
            "PRAGMA JOURNAL_MODE", "PRAGMA LOCKING_MODE", "PRAGMA WRITABLE_SCHEMA",
            "PRAGMA AUTO_VACUUM", "PRAGMA INCREMENTAL_VACUUM"
        ]
        for write_pragma in write_pragmas:
            if write_pragma in sql_upper:
                return False, f"Security Warning: {write_pragma} is not allowed (can modify database)."

    return True, None

# === Custom SQL Functions (UDFs) for Forensic Analysis ===

def unix_to_datetime(timestamp):
    """Convert Unix timestamp (seconds since 1970-01-01) to ISO datetime."""
    if timestamp is None:
        return None
    try:
        return datetime.utcfromtimestamp(float(timestamp)).isoformat()
    except Exception:
        return None

def webkit_to_datetime(timestamp):
    """Convert WebKit timestamp (microseconds since 1601-01-01) to ISO datetime."""
    if timestamp is None:
        return None
    try:
        webkit_epoch = datetime(1601, 1, 1)
        return (webkit_epoch + timedelta(microseconds=float(timestamp))).isoformat()
    except Exception:
        return None

def ios_to_datetime(timestamp):
    """Convert iOS/Mac Core Data timestamp (seconds since 2001-01-01) to ISO datetime."""
    if timestamp is None:
        return None
    try:
        ios_epoch = datetime(2001, 1, 1)
        return (ios_epoch + timedelta(seconds=float(timestamp))).isoformat()
    except Exception:
        return None

def filetime_to_datetime(timestamp):
    """Convert Windows FILETIME (100ns intervals since 1601-01-01) to ISO datetime."""
    if timestamp is None:
        return None
    try:
        filetime_epoch = datetime(1601, 1, 1)
        return (filetime_epoch + timedelta(microseconds=float(timestamp) / 10)).isoformat()
    except Exception:
        return None

def decode_base64(text):
    """Decode base64 encoded string to UTF-8 text."""
    if text is None:
        return None
    try:
        return base64.b64decode(text).decode('utf-8', errors='replace')
    except Exception:
        return None

def encode_base64(text):
    """Encode text to base64 string."""
    if text is None:
        return None
    try:
        return base64.b64encode(str(text).encode('utf-8')).decode('ascii')
    except Exception:
        return None

def decode_hex(hex_string):
    """Decode hex string to UTF-8 text."""
    if hex_string is None:
        return None
    try:
        return bytes.fromhex(hex_string).decode('utf-8', errors='replace')
    except Exception:
        return None

def to_hex(text):
    """Convert text to hexadecimal representation."""
    if text is None:
        return None
    try:
        return str(text).encode('utf-8').hex()
    except Exception:
        return None

def extract_email(text):
    """Extract first email address from text."""
    if text is None:
        return None
    try:
        match = re.search(r'[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}', str(text))
        return match.group(0) if match else None
    except Exception:
        return None

def extract_ip(text):
    """Extract first IPv4 address from text."""
    if text is None:
        return None
    try:
        match = re.search(r'\b(?:\d{1,3}\.){3}\d{1,3}\b', str(text))
        return match.group(0) if match else None
    except Exception:
        return None

def extract_url(text):
    """Extract first URL from text."""
    if text is None:
        return None
    try:
        match = re.search(r'https?://[^\s<>"\']+', str(text))
        return match.group(0) if match else None
    except Exception:
        return None

def extract_phone(text):
    """Extract first phone number (US format) from text."""
    if text is None:
        return None
    try:
        # Matches: (123) 456-7890, 123-456-7890, 123.456.7890, 1234567890
        match = re.search(r'(?:\+?1[-.\s]?)?\(?[0-9]{3}\)?[-.\s]?[0-9]{3}[-.\s]?[0-9]{4}', str(text))
        return match.group(0) if match else None
    except Exception:
        return None

def register_custom_functions(conn):
    """Register all custom SQL functions with the SQLite connection."""
    # Timestamp converters
    conn.create_function('unix_to_datetime', 1, unix_to_datetime)
    conn.create_function('webkit_to_datetime', 1, webkit_to_datetime)
    conn.create_function('ios_to_datetime', 1, ios_to_datetime)
    conn.create_function('filetime_to_datetime', 1, filetime_to_datetime)
    # Encode/decode functions
    conn.create_function('decode_base64', 1, decode_base64)
    conn.create_function('encode_base64', 1, encode_base64)
    conn.create_function('decode_hex', 1, decode_hex)
    conn.create_function('to_hex', 1, to_hex)
    # String extractors
    conn.create_function('extract_email', 1, extract_email)
    conn.create_function('extract_ip', 1, extract_ip)
    conn.create_function('extract_url', 1, extract_url)
    conn.create_function('extract_phone', 1, extract_phone)

def calculate_file_hash(filepath):
    """
    Calculate SHA256 hash of file for evidence integrity verification.
    Uses chunked reading to handle large files efficiently.

    Returns:
        str: Hexadecimal SHA256 hash
    """
    sha256 = hashlib.sha256()
    with open(filepath, 'rb') as f:
        for chunk in iter(lambda: f.read(8192), b''):
            sha256.update(chunk)
    return sha256.hexdigest()

def validate_upload_file(file, max_size_bytes=1024 * 1024 * 1024):
    """
    Validate uploaded file meets security and forensic requirements.

    Args:
        file: Werkzeug FileStorage object
        max_size_bytes: Maximum allowed file size (default 1GB)

    Returns:
        tuple: (is_valid: bool, error_message: str or None, file_type: str)
    """
    # Check file extension
    allowed_extensions = {'.db', '.sqlite', '.sqlite3', '.sql', '.csv'}
    file_ext = os.path.splitext(file.filename)[1].lower()

    if file_ext not in allowed_extensions:
        return False, f'Invalid file type. Allowed: {", ".join(allowed_extensions)}', None

    # Check file size
    file.seek(0, os.SEEK_END)
    file_size = file.tell()
    file.seek(0)

    if file_size > max_size_bytes:
        return False, f'File too large: {file_size / (1024*1024*1024):.2f}GB. Maximum is {max_size_bytes / (1024*1024*1024):.0f}GB.', None

    if file_size == 0:
        return False, 'File is empty.', None

    logger.info(f"File validation passed: {file.filename} ({file_size / (1024*1024):.2f}MB)")

    return True, None, file_ext

def convert_csv_to_sqlite(csv_filepath, db_filepath):
    """
    Convert CSV file to SQLite database for querying.

    Args:
        csv_filepath: Path to source CSV file
        db_filepath: Path to target SQLite database

    Returns:
        dict: Schema dictionary (table_name -> [columns])

    Raises:
        Exception: If conversion fails
    """
    try:
        # Read CSV with pandas (handles encoding, delimiters automatically)
        df = pd.read_csv(csv_filepath, encoding_errors='replace')

        # Sanitize column names (remove special chars, spaces)
        df.columns = [re.sub(r'[^\w]', '_', col) for col in df.columns]

        # Create SQLite database and insert data
        conn = sqlite3.connect(db_filepath)
        table_name = 'csv_data'  # Default table name
        df.to_sql(table_name, conn, if_exists='replace', index=False)

        # Extract schema
        cursor = conn.cursor()
        cursor.execute(f'PRAGMA table_info("{table_name}");')
        columns = cursor.fetchall()
        schema = {table_name: [column[1] for column in columns]}

        conn.close()
        logger.info(f"CSV converted to SQLite: {len(df)} rows, {len(df.columns)} columns")

        return schema

    except Exception as e:
        logger.error(f"CSV conversion failed: {str(e)}")
        raise

def execute_sql_file(sql_filepath, db_filepath):
    """
    Execute SQL file to create database schema and load data.
    Supports CREATE TABLE, INSERT statements (blocks destructive commands).

    Args:
        sql_filepath: Path to .sql file
        db_filepath: Path to target SQLite database

    Returns:
        dict: Schema dictionary (table_name -> [columns])

    Raises:
        Exception: If SQL execution fails or contains forbidden commands
    """
    try:
        with open(sql_filepath, 'r') as f:
            sql_content = f.read()

        # Security check: block destructive operations
        forbidden = ['DROP DATABASE', 'DROP SCHEMA', 'TRUNCATE DATABASE']
        sql_upper = sql_content.upper()
        for keyword in forbidden:
            if keyword in sql_upper:
                raise ValueError(f"SQL file contains forbidden keyword: {keyword}")

        # Execute SQL file
        conn = sqlite3.connect(db_filepath)
        cursor = conn.cursor()
        cursor.executescript(sql_content)

        # Extract schema
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table';")
        tables = cursor.fetchall()
        schema = {}
        for table_name in tables:
            table_name = table_name[0]
            cursor.execute(f'PRAGMA table_info("{table_name}");')
            columns = cursor.fetchall()
            schema[table_name] = [column[1] for column in columns]

        conn.close()
        logger.info(f"SQL file executed: {len(schema)} tables created")

        return schema

    except Exception as e:
        logger.error(f"SQL file execution failed: {str(e)}")
        raise

def check_llm_available():
    """
    Check if LM Studio is running and responsive.

    Returns:
        bool: True if LM Studio is accessible
    """
    try:
        test_url = LLM_API_URL.replace('/chat/completions', '/models')
        response = requests.get(test_url, timeout=2)
        return response.status_code == 200
    except Exception:
        return False

def check_ollama_available():
    """
    Check if Ollama is running and return available models.

    Returns:
        tuple: (available: bool, models: list)
    """
    try:
        response = requests.get(f"{OLLAMA_URL}/api/tags", timeout=2)
        if response.status_code == 200:
            data = response.json()
            models = [m['name'] for m in data.get('models', [])]
            return True, models
    except requests.exceptions.RequestException:
        pass
    return False, []

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
    """Serve service worker from root scope for PWA support."""
    return app.send_static_file('service-worker.js'), 200, {
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
    return render_template('index.html', ascii_art=ascii_art)

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
    is_valid, error_msg, file_ext = validate_upload_file(file, max_size_bytes=1024 * 1024 * 1024)
    if not is_valid:
        logger.warning(f"File validation failed: {error_msg}")
        return jsonify({'error': error_msg}), 400

    # === UPLOAD PHASE ===
    original_filename = file.filename
    secure_name = secure_filename(original_filename)
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

                conn.close()
                logger.info(f"SQLite validated: {len(schema)} tables found")

                # Move to final location
                os.replace(temp_filepath, final_filepath)

            except sqlite3.Error as e:
                if os.path.exists(temp_filepath):
                    os.remove(temp_filepath)
                logger.error(f"SQLite validation failed: {str(e)}")
                return jsonify({'error': f'Invalid SQLite database: {str(e)}'}), 400

        elif file_ext == '.csv':
            # CSV file - convert to SQLite
            final_db_path = final_filepath.replace('.csv', '.db')
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
            final_db_path = final_filepath.replace('.sql', '.db')
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
        session.modified = True

        logger.info(f"Database loaded successfully: {original_filename}")
        logger.info(f"Final path: {final_filepath}")
        logger.info(f"Schema: {len(schema)} tables")

        return jsonify({
            'schema': schema,
            'metadata': {
                'filename': original_filename,
                'hash': file_hash,
                'size_mb': os.path.getsize(final_filepath) / (1024*1024),
                'tables': len(schema)
            }
        })

    except Exception as e:
        # Clean up on any error
        if os.path.exists(temp_filepath):
            os.remove(temp_filepath)
        logger.error(f"Upload failed: {str(e)}", exc_info=True)
        return jsonify({'error': f'Upload processing failed: {str(e)}'}), 500


def build_schema_context(db_filepath):
    """Build schema context string from database file for LLM prompts.

    Includes CREATE TABLE DDL, foreign key relationships, and sample data
    to give the LLM maximum context for accurate query generation.
    """
    if not db_filepath:
        return ""
    conn = sqlite3.connect(db_filepath)
    cursor = conn.cursor()

    cursor.execute("SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%';")
    tables = cursor.fetchall()

    parts = ["Database Schema:\n"]

    for table_name, create_sql in tables:
        # CREATE TABLE DDL
        if create_sql:
            parts.append(f"{create_sql};\n")

        # Foreign keys
        cursor.execute(f'PRAGMA foreign_key_list("{table_name}");')
        fks = cursor.fetchall()
        if fks:
            for fk in fks:
                parts.append(f"  -- FK: {table_name}.{fk[3]} → {fk[2]}.{fk[4]}")
            parts.append("")

        # Sample data (3 rows)
        try:
            cursor.execute(f'SELECT * FROM "{table_name}" LIMIT 3;')
            rows = cursor.fetchall()
            if rows:
                col_names = [desc[0] for desc in cursor.description]
                parts.append(f"Sample data from {table_name}:")
                parts.append(f"  Columns: {', '.join(col_names)}")
                for row in rows:
                    parts.append(f"  {row}")
                parts.append("")
        except sqlite3.Error:
            pass

    conn.close()
    return '\n'.join(parts)


def build_error_correction_prompt(error_msg, failed_sql, schema_context):
    """Build a prompt to ask the LLM to correct a failed SQL query."""
    # Classify error type for targeted guidance
    error_upper = str(error_msg).upper()
    if "NO SUCH COLUMN" in error_upper:
        hint = "Check column names against the schema — the column may be misspelled or belong to a different table."
    elif "NO SUCH TABLE" in error_upper:
        hint = "Check table names against the schema — the table may be misspelled."
    elif "SYNTAX ERROR" in error_upper or "NEAR" in error_upper:
        hint = "Fix the SQLite syntax error."
    else:
        hint = "Fix the error based on the message below."

    return f"""The following SQL query failed. {hint}

Error: {error_msg}

Failed query:
```sql
{failed_sql}
```

{schema_context}

Output ONLY the corrected SQL query in a ```sql code block. No explanation needed."""


def build_system_prompt(schema_context):
    """Build the system prompt with schema context and few-shot examples."""
    return f"""You are a SQLite expert assisting a forensic analyst. This is a READ-ONLY environment — never output INSERT, UPDATE, DELETE, DROP, or any modification commands.

Rules:
- If the question can be answered from the schema alone (structure, relationships, column descriptions), respond in plain language. Do NOT generate SQL.
- If the question requires retrieving or analyzing actual data, briefly explain your approach (1-2 sentences), then output exactly ONE SQL query in a ```sql code block.
- Use only tables and columns that exist in the schema below. SQLite syntax only.
- For direct requests ("show me [table]", "pull [data]"), write the query immediately — no confirmation needed.
- If genuinely ambiguous, ask one short clarifying question.

Custom forensic functions (use these in SQL when relevant):
- Timestamps: unix_to_datetime(col), webkit_to_datetime(col), ios_to_datetime(col), filetime_to_datetime(col)
- Encoding: encode_base64(col), decode_base64(col), to_hex(col), decode_hex(col)
- Extractors: extract_email(col), extract_ip(col), extract_url(col), extract_phone(col)

Example 1 — Data retrieval:
User: "Show me the 10 most recent entries in the logs table"
Assistant: "I'll query the most recent 10 log entries by timestamp."
```sql
SELECT * FROM logs ORDER BY timestamp DESC LIMIT 10;
```

Example 2 — Structural/conversational question:
User: "How are the tables in this database related?"
Assistant: "Based on the schema, here are the relationships:
- **orders** links to **customers** via CustomerId (foreign key)
- **order_items** links to **orders** via OrderId
- **order_items** links to **products** via ProductId
These form a standard e-commerce data model."

{schema_context}"""

def call_llm_non_streaming(messages, provider='lmstudio', model=None):
    """Make a non-streaming LLM call and return the response text. Used for SQL retry."""
    try:
        if provider == 'ollama':
            model = model or OLLAMA_MODEL
            payload = {
                "model": model,
                "messages": messages,
                "stream": False,
                "options": {"temperature": 0.1}
            }
            r = requests.post(f"{OLLAMA_URL}/api/chat", json=payload, timeout=30)
            r.raise_for_status()
            return r.json().get('message', {}).get('content', '')
        else:
            headers = {"Content-Type": "application/json"}
            payload = {
                "messages": messages,
                "temperature": 0.1,
                "stream": False
            }
            r = requests.post(LLM_API_URL, headers=headers, json=payload, timeout=30)
            r.raise_for_status()
            data = r.json()
            if 'choices' in data and data['choices']:
                return data['choices'][0].get('message', {}).get('content', '')
            return ''
    except Exception as e:
        logger.error(f"Non-streaming LLM call failed: {e}")
        return ''


def stream_lmstudio_response(messages_to_send):
    """Stream response from LM Studio (OpenAI-compatible API)."""
    headers = {"Content-Type": "application/json"}
    payload = {
        "messages": messages_to_send,
        "mode": "chat",
        "temperature": 0.1,
        "stream": True,
        "stream_options": {"include_usage": True}
    }

    full_response = ""
    token_usage = None

    try:
        with requests.post(LLM_API_URL, headers=headers, json=payload, stream=True, timeout=(3.05, 60)) as r:
            r.raise_for_status()
            for line in r.iter_lines():
                if line:
                    decoded_line = line.decode('utf-8')
                    if decoded_line.startswith('data: '):
                        if decoded_line.strip() == 'data: [DONE]':
                            continue

                        try:
                            json_data = json.loads(decoded_line[6:])

                            if 'usage' in json_data:
                                token_usage = json_data['usage']

                            if 'choices' in json_data and json_data['choices']:
                                delta = json_data['choices'][0].get('delta', {})
                                content_chunk = delta.get('content', '')
                                if content_chunk:
                                    full_response += content_chunk
                                    yield content_chunk
                        except json.JSONDecodeError:
                            continue

        if token_usage:
            logger.info(f"LM Studio Response Complete. Tokens: {token_usage}")
            yield f"<|END_OF_STREAM|>{full_response}<|TOKEN_USAGE|>{json.dumps(token_usage)}"
        else:
            logger.info("LM Studio Response Complete (No token usage data)")
            yield f"<|END_OF_STREAM|>{full_response}"

    except requests.exceptions.Timeout:
        logger.error("LM Studio request timed out")
        yield "Error: LM Studio request timed out. Is the server running?"
    except requests.exceptions.ConnectionError:
        logger.error("Cannot connect to LM Studio")
        yield "Error: Cannot connect to LM Studio. Is the server running at http://localhost:1234?"
    except requests.exceptions.RequestException as e:
        logger.error(f"LM Studio Stream Error: {str(e)}")
        yield f"LM Studio Error: {str(e)}"

def stream_ollama_response(messages_to_send, model):
    """Stream response from Ollama API."""
    # Convert messages to Ollama format (same structure, just different endpoint)
    ollama_payload = {
        "model": model,
        "messages": messages_to_send,
        "stream": True,
        "options": {"temperature": 0.1}
    }

    full_response = ""

    try:
        with requests.post(f"{OLLAMA_URL}/api/chat", json=ollama_payload, stream=True, timeout=(3.05, 120)) as r:
            r.raise_for_status()
            for line in r.iter_lines():
                if line:
                    try:
                        data = json.loads(line)
                        content = data.get('message', {}).get('content', '')
                        if content:
                            full_response += content
                            yield content

                        if data.get('done', False):
                            # Build token usage from Ollama metrics
                            token_usage = {
                                'prompt_tokens': data.get('prompt_eval_count', 0),
                                'completion_tokens': data.get('eval_count', 0),
                                'total_tokens': data.get('prompt_eval_count', 0) + data.get('eval_count', 0)
                            }
                            logger.info(f"Ollama Response Complete. Tokens: {token_usage}")
                            yield f"<|END_OF_STREAM|>{full_response}<|TOKEN_USAGE|>{json.dumps(token_usage)}"
                    except json.JSONDecodeError:
                        continue

    except requests.exceptions.Timeout:
        logger.error("Ollama request timed out")
        yield "Error: Ollama request timed out. Is Ollama running?"
    except requests.exceptions.ConnectionError:
        logger.error("Cannot connect to Ollama")
        yield "Error: Cannot connect to Ollama. Is Ollama running? (ollama serve)"
    except requests.exceptions.RequestException as e:
        logger.error(f"Ollama Stream Error: {str(e)}")
        yield f"Ollama Error: {str(e)}"

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

    # Build Schema Context
    schema_context = ""
    if db_filepath:
        try:
            schema_context = build_schema_context(db_filepath)
        except sqlite3.Error as e:
            logger.error(f"Database access error during schema injection: {e}")
            return jsonify({'error': f"Database access error: {e}"}), 500

    # Append user message to history
    chat_history.append({
        "role": "user",
        "content": user_message,
        "id": str(uuid.uuid4())
    })

    # Build messages for LLM
    system_prompt = build_system_prompt(schema_context)
    messages_to_send = [{"role": "system", "content": system_prompt}] + chat_history
    logger.info(f"Messages to send count: {len(messages_to_send)}")

    # Stream based on provider
    if provider == 'ollama':
        model = session.get('ollama_model', OLLAMA_MODEL)
        logger.info(f"Using Ollama model: {model}")
        return Response(stream_with_context(stream_ollama_response(messages_to_send, model)), content_type='text/plain')
    else:
        return Response(stream_with_context(stream_lmstudio_response(messages_to_send)), content_type='text/plain')

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
        # Strip trailing semicolon to prevent "multiple statement" errors
        cleaned_query = sql_query.rstrip(';').strip()

        # Open in read-only mode for defense-in-depth
        # Even if validation is bypassed, SQLite will reject writes
        conn = sqlite3.connect(f"file:{db_filepath}?mode=ro", uri=True)
        conn.execute("PRAGMA query_only = ON")  # Extra safety layer
        register_custom_functions(conn)  # Register forensic UDFs

        # Use a row factory to get dict-like access if needed, but list of dicts is fine
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()

        # Execute query directly
        cursor.execute(cleaned_query)
        results = cursor.fetchall()

        # Limit results for performance (hardcoded 2000 limit)
        results_limit = results[:2000]

        results_dict = [dict(row) for row in results_limit]

        conn.close()

        logger.info(f"SQL Executed Successfully. Rows returned: {len(results_dict)}")

        # Update History with Result Metadata
        if chat_history:
            last_msg = chat_history[-1]
            if last_msg['role'] == 'assistant':
                last_msg['sql_query'] = sql_query
                last_msg['query_results_preview'] = results_dict[:20]
                last_msg['total_results'] = len(results_dict)
                # We do NOT overwrite 'content' here anymore, preserving the LLM's explanation.
                session['chat_history'] = chat_history

        return jsonify({
            'response': f"Found {len(results_dict)} results.",
            'query_results': results_dict
        })

    except sqlite3.Error as e:
        logger.warning(f"SQL Execution Error (will attempt retry): {e} | Query: {sql_query}")

        # Attempt auto-correction via LLM (max 1 retry)
        try:
            schema_context = build_schema_context(db_filepath)
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

            # Execute corrected query
            cleaned_retry = corrected_sql.rstrip(';').strip()
            conn = sqlite3.connect(f"file:{db_filepath}?mode=ro", uri=True)
            conn.execute("PRAGMA query_only = ON")
            register_custom_functions(conn)
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()
            cursor.execute(cleaned_retry)
            results = cursor.fetchall()
            results_limit = results[:2000]
            results_dict = [dict(row) for row in results_limit]
            conn.close()

            logger.info(f"Retry SQL Executed Successfully. Rows returned: {len(results_dict)}")

            # Update History with Result Metadata
            if chat_history:
                last_msg = chat_history[-1]
                if last_msg['role'] == 'assistant':
                    last_msg['sql_query'] = corrected_sql
                    last_msg['query_results_preview'] = results_dict[:20]
                    last_msg['total_results'] = len(results_dict)
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
        conn = sqlite3.connect(f"file:{db_filepath}?mode=ro", uri=True)
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

        conn.close()

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

@app.route('/api/schema/diagram', methods=['GET'])
def schema_diagram():
    """Return schema data for ER diagram: tables, columns, types, PKs, FKs."""
    db_filepath = session.get('db_filepath')
    if not db_filepath:
        return jsonify({'error': 'No database loaded'}), 400

    try:
        conn = sqlite3.connect(f"file:{db_filepath}?mode=ro", uri=True)
        cursor = conn.cursor()

        cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%';")
        table_names = [row[0] for row in cursor.fetchall()]

        tables = []
        relationships = []

        for table_name in table_names:
            cursor.execute(f'PRAGMA table_info("{table_name}");')
            columns_raw = cursor.fetchall()
            columns = []
            for col in columns_raw:
                columns.append({
                    'name': col[1],
                    'type': col[2] or 'TEXT',
                    'pk': bool(col[5])
                })

            tables.append({
                'name': table_name,
                'columns': columns
            })

            cursor.execute(f'PRAGMA foreign_key_list("{table_name}");')
            fks = cursor.fetchall()
            for fk in fks:
                relationships.append({
                    'from_table': table_name,
                    'from_column': fk[3],
                    'to_table': fk[2],
                    'to_column': fk[4]
                })

        conn.close()

        return jsonify({
            'tables': tables,
            'relationships': relationships
        })

    except sqlite3.Error as e:
        logger.error(f"Schema diagram error: {e}")
        return jsonify({'error': f'Database error: {e}'}), 500

@app.route('/add_note', methods=['POST'])
def add_note():
    data = request.json
    if not data:
        return jsonify({'error': 'Invalid request body'}), 400

    message_id = data.get('message_id')
    note_content = data.get('note_content')

    if not message_id or note_content is None:
        return jsonify({'error': 'Missing message_id or note_content'}), 400
        
    chat_history = session.get('chat_history', [])
    
    # Find message by ID
    msg_found = False
    for msg in chat_history:
        if msg.get('id') == message_id:
            msg['note'] = note_content
            msg_found = True
            break
            
    if not msg_found:
        return jsonify({'error': 'Message not found'}), 404
        
    session['chat_history'] = chat_history
    session.modified = True
    
    return jsonify({'status': 'success'})

def _get_css_content():
    css_path = os.path.join(BASE_PATH, 'static', 'style.css')
    try:
        with open(css_path, 'r') as f:
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
            chat_html_parts.append(f'<div class="chat-message user-message"><p>{user_text}</p></div>')

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

            parts = [f"<p>{content}</p>"]
            if entry.get("sql_query"):
                parts.append(f"<pre><code>{entry['sql_query']}</code></pre>")

            preview = entry.get("query_results_preview")
            if preview:
                headers = preview[0].keys()
                table = "<table><thead><tr>" + "".join(f"<th>{h}</th>" for h in headers) + "</tr></thead><tbody>"
                for row in preview:
                    table += "<tr>" + "".join(f"<td>{row[h]}</td>" for h in headers) + "</tr>"
                table += "</tbody></table>"
                parts.append(f'<div class="results-table-container">{table}</div>')

            if entry.get("note"):
                note_text = entry["note"].replace("<", "&lt;").replace(">", "&gt;") # Basic escaping
                parts.append(f'<div class="forensic-note" style="margin-top: 10px; padding: 10px; background: #332b00; border-left: 3px solid #ffcc00; font-style: italic; color: #fff;"><strong>Analyst Note:</strong> {note_text}</div>')

            # Wrap in content-container with token counter
            content_html = f'<div class="content-container">{token_html}{"".join(parts)}</div>'
            chat_html_parts.append(f'<div class="chat-message bot-message">{content_html}</div>')

    return "\n".join(chat_html_parts)

@app.route('/export_chat', methods=['GET'])
def export_chat():
    chat_history = session.get('chat_history', [])
    
    # Gather Metadata (escape user-provided values for XSS prevention)
    original_filename = html_escape(session.get('original_filename', 'Unknown'))
    db_hash = session.get('db_hash', 'N/A')
    upload_timestamp = session.get('upload_timestamp', 'N/A')
    file_size_bytes = session.get('file_size_bytes', 0)
    export_timestamp = datetime.now().isoformat()
    hostname = html_escape(os.uname().nodename if hasattr(os, 'uname') else 'Localhost')

    # Forensic Header HTML - Compact version
    file_size_mb = file_size_bytes / (1024*1024)
    metadata_html = f"""
    <div class="forensic-header" style="background: #0a0a0c; padding: 12px 16px; border-bottom: 1px solid #2a2a3a; border-left: 3px solid #f0a030; margin-bottom: 16px; font-family: 'JetBrains Mono', monospace; font-size: 0.75rem; color: #8a8a9a;">
        <div style="display: flex; flex-wrap: wrap; gap: 8px 24px; align-items: center;">
            <span style="color: #f0a030; font-weight: 600;">// FORENSIC REPORT</span>
            <span><b style="color: #e8e8ec;">{original_filename}</b> ({file_size_mb:.2f} MB)</span>
            <span>SHA256: <code style="color: #40d0d0; font-size: 0.7rem;">{db_hash[:16]}...{db_hash[-8:]}</code></span>
            <span>Uploaded: {upload_timestamp}</span>
            <span>Exported: {export_timestamp}</span>
            <span>Host: {hostname}</span>
        </div>
        <div style="margin-top: 8px; font-size: 0.7rem; color: #5a5a6a;">
            yourSQLfriend v{VERSION} | READ-ONLY mode | <span title="{db_hash}" style="cursor: help; text-decoration: underline dotted;">Full hash on hover</span>
        </div>
    </div>
    """

    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>Forensic Report - {original_filename}</title>
    <style>{_get_css_content()}</style>
</head>
<body>
    <div class="app-container">
        <div class="main-chat">
            <div class="chat-container">
                {metadata_html}
                <div class="chat-history" style="padding-top: 0;">
                    {_generate_chat_html(chat_history)}
                </div>
            </div>
        </div>
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

if __name__ == '__main__':
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