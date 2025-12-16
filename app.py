# Standard Library
import sqlite3
import os
import hashlib
import logging
import re
import json
import csv
from datetime import datetime

# Third-party
import requests
import pandas as pd

# Flask
from flask import Flask, render_template, request, jsonify, session, make_response, Response, stream_with_context
from flask_session import Session
from werkzeug.utils import secure_filename

app = Flask(__name__)

# --- Configuration ---
# Use environment variable for secret key, or default for dev
app.secret_key = os.environ.get('SECRET_KEY', 'dev-secret-key-change-me')
app.config['SESSION_TYPE'] = 'filesystem'
app.config['SESSION_FILE_DIR'] = './flask_session/'
app.config['SESSION_PERMANENT'] = False
app.config['SESSION_USE_SIGNER'] = True

# --- Logging Setup ---
# Ensure upload directory exists (defined early for logging)
UPLOAD_FOLDER = 'uploads'
if not os.path.exists(UPLOAD_FOLDER):
    os.makedirs(UPLOAD_FOLDER)

# Ensure logs directory exists
if not os.path.exists('logs'):
    os.makedirs('logs')

# Configure structured logging with daily rotation
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler(f'logs/analysis_{datetime.now().strftime("%Y%m%d")}.log'),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)

# Log application startup
logger.info("=" * 60)
logger.info("mySQLhelper Forensic Analysis Tool Started")
logger.info(f"Upload directory: {os.path.abspath(UPLOAD_FOLDER)}")
logger.info("=" * 60)

# Initialize Server-side Session
Session(app)

LLM_API_URL = os.environ.get('LLM_API_URL', "http://localhost:1234/v1/chat/completions")

def validate_sql(sql):
    """
    Strictly validates that the SQL query is a read-only SELECT statement.
    """
    sql_upper = sql.strip().upper()
    if not sql_upper.startswith("SELECT"):
        return False, "Only SELECT queries are allowed."
    
    # Check for multiple statements (semicolon followed by non-whitespace)
    if re.search(r';\s*\S', sql):
        return False, "Security Warning: Multiple SQL statements are not allowed."
    
    # Basic keyword blocklist for extra safety
    forbidden_keywords = ["DROP", "DELETE", "INSERT", "UPDATE", "ALTER", "TRUNCATE", "EXEC", "grant", "revoke"]
    for keyword in forbidden_keywords:
        # Check for keyword surrounded by word boundaries
        if re.search(r'\b' + keyword + r'\b', sql_upper):
            return False, f"Security Warning: Query contains forbidden keyword '{keyword}'."
    
    
    return True, None

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
        df = pd.read_csv(csv_filepath)

        # Sanitize column names (remove special chars, spaces)
        df.columns = [re.sub(r'[^\w]', '_', col) for col in df.columns]

        # Create SQLite database and insert data
        conn = sqlite3.connect(db_filepath)
        table_name = 'csv_data'  # Default table name
        df.to_sql(table_name, conn, if_exists='replace', index=False)

        # Extract schema
        cursor = conn.cursor()
        cursor.execute(f"PRAGMA table_info({table_name});")
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
        forbidden = ['DROP DATABASE', 'DROP SCHEMA', 'TRUNCATE DATABASE', '--', '/*']
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
            cursor.execute(f"PRAGMA table_info({table_name});")
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
    except:
        return False

@app.route('/')
def index():
    return render_template('index.html')

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
                    cursor.execute(f"PRAGMA table_info({table_name});")
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

@app.route('/chat_stream', methods=['POST'])
def chat_stream():
    logger.info("--- Chat Request Start ---")
    
    # Health Check: Ensure LLM is running
    if not check_llm_available():
        logger.error("LLM Health Check Failed: LM Studio not reachable")
        return jsonify({'error': 'Local LLM (LM Studio) is not running or not reachable at http://localhost:1234.'}), 503

    user_message = request.json.get('message')
    db_filepath = session.get('db_filepath')
    chat_history = session.get('chat_history', [])
    
    logger.debug(f"Loaded chat_history length: {len(chat_history)}")

    if not user_message:
        logger.warning("Chat request with empty message")
        return jsonify({'error': 'Empty message'}), 400

    # Build Schema Context (Dynamic System Prompt)
    schema_context = ""
    if db_filepath:
        try:
            conn = sqlite3.connect(db_filepath)
            cursor = conn.cursor()
            cursor.execute("SELECT name FROM sqlite_master WHERE type='table';")
            tables = cursor.fetchall()
            schema_context = "Database Schema:\n"
            for table_name in tables:
                table_name = table_name[0]
                schema_context += f"Table: {table_name}\nColumns: "
                cursor.execute(f"PRAGMA table_info({table_name});")
                columns = cursor.fetchall()
                schema_context += ", ".join([column[1] for column in columns]) + "\n"
            conn.close()
        except sqlite3.Error as e:
            logger.error(f"Database access error during schema injection: {e}")
            return jsonify({'error': f"Database access error: {e}"}), 500

    # Append ONLY user message (schema is now in system prompt)
    chat_history.append({"role": "user", "content": user_message})

    # Dynamic System Prompt with Schema
    system_prompt = f"""
You are a SQL expert assisting a digital forensics analyst.

1. **Reasoning & Execution:** If the user asks for data, first explain your logic briefly in plain text, then output the valid SQL query inside a markdown code block.
   Example:
   "To find the top users, I will join the users table with logs and sort by count."
   ```sql
   SELECT ...
   ```

2. **Conversation:** If the user chats, asks about the schema, or the request is ambiguous, reply in plain text. You are encouraged to ask clarifying questions if the user's intent is unclear.

3. **Safety First:** NEVER modify data. You are running in a READ-ONLY environment. Do not output INSERT, UPDATE, DELETE, or DROP commands.

{schema_context}
"""
    messages_to_send = [{"role": "system", "content": system_prompt}] + chat_history
    logger.info(f"Messages to send count: {len(messages_to_send)}")
    
    def stream_llm_response():
        headers = {"Content-Type": "application/json"}
        payload = {
            "messages": messages_to_send,
            "mode": "chat",
            "temperature": 0.1,
            "stream": True,
            "stream_options": {"include_usage": True}  # Request token usage data
        }

        full_response = ""
        token_usage = None  # Initialize token tracking
        try:
            # Added timeout: 3.05s connect, 60s read
            with requests.post(LLM_API_URL, headers=headers, json=payload, stream=True, timeout=(3.05, 60)) as r:
                r.raise_for_status()
                for line in r.iter_lines():
                    if line:
                        decoded_line = line.decode('utf-8')
                        if decoded_line.startswith('data: '):
                            # Check for [DONE] marker
                            if decoded_line.strip() == 'data: [DONE]':
                                continue

                            try:
                                json_data = json.loads(decoded_line[6:])

                                # Capture token usage if present (appears in final chunk)
                                if 'usage' in json_data:
                                    token_usage = json_data['usage']

                                # Stream content chunks as before
                                if 'choices' in json_data and json_data['choices']:
                                    delta = json_data['choices'][0].get('delta', {})
                                    content_chunk = delta.get('content', '')
                                    if content_chunk:
                                        full_response += content_chunk
                                        yield content_chunk
                            except json.JSONDecodeError:
                                continue


            # Enhanced End Token: Include token usage in metadata
            if token_usage:
                logger.info(f"LLM Response Complete. Tokens: {token_usage}")
                yield f"<|END_OF_STREAM|>{full_response}<|TOKEN_USAGE|>{json.dumps(token_usage)}"
            else:
                logger.info("LLM Response Complete (No token usage data)")
                yield f"<|END_OF_STREAM|>{full_response}"

        except requests.exceptions.RequestException as e:
            logger.error(f"LLM Stream Error: {str(e)}")
            yield f"LLM Error: {str(e)}"

    return Response(stream_with_context(stream_llm_response()), content_type='text/plain')

@app.route('/save_assistant_message', methods=['POST'])
def save_assistant_message():
    content = request.json.get('content')
    token_usage = request.json.get('token_usage')  # Optional: may be None

    if not content:
        return jsonify({'error': 'No content provided'}), 400

    chat_history = session.get('chat_history', [])

    # Build assistant message with optional token usage
    assistant_message = {"role": "assistant", "content": content}
    if token_usage:
        assistant_message['token_usage'] = token_usage

    chat_history.append(assistant_message)
    session['chat_history'] = chat_history
    session.modified = True  # Critical: Force session update

    return jsonify({'status': 'success'})

@app.route('/execute_sql', methods=['POST'])
def execute_sql():
    data = request.json
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
        conn = sqlite3.connect(db_filepath)
        # Use a row factory to get dict-like access if needed, but list of dicts is fine
        conn.row_factory = sqlite3.Row 
        cursor = conn.cursor()
        cursor.execute(sql_query)
        results = cursor.fetchall() 
        
        # Limit results for performance
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
        logger.error(f"SQL Execution Error: {e} | Query: {sql_query}")
        return jsonify({'error': f"SQL Error: {e}"}), 500

def _get_css_content():
    css_path = os.path.join(app.root_path, 'static', 'style.css')
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

            # Wrap in content-container with token counter
            content_html = f'<div class="content-container">{token_html}{"".join(parts)}</div>'
            chat_html_parts.append(f'<div class="chat-message bot-message">{content_html}</div>')

    return "\n".join(chat_html_parts)

@app.route('/export_chat', methods=['GET'])
def export_chat():
    chat_history = session.get('chat_history', [])
    
    # Gather Metadata
    original_filename = session.get('original_filename', 'Unknown')
    db_hash = session.get('db_hash', 'N/A')
    upload_timestamp = session.get('upload_timestamp', 'N/A')
    file_size_bytes = session.get('file_size_bytes', 0)
    export_timestamp = datetime.now().isoformat()
    hostname = os.uname().nodename if hasattr(os, 'uname') else 'Localhost'

    # Forensic Header HTML
    metadata_html = f"""
    <div class="forensic-header" style="background: #1a1a1a; padding: 20px; border-bottom: 2px solid #333; margin-bottom: 20px; font-family: monospace; color: #ccc;">
        <h2 style="color: #fff; margin-top: 0;">FORENSIC ANALYSIS REPORT</h2>
        <table style="width: 100%; border-collapse: collapse; font-size: 0.9rem;">
            <tr><td style="padding: 5px; color: #888; width: 200px;">Evidence File:</td><td style="color: #fff;">{original_filename}</td></tr>
            <tr><td style="padding: 5px; color: #888;">SHA256 Hash:</td><td style="color: #fff;">{db_hash}</td></tr>
            <tr><td style="padding: 5px; color: #888;">File Size:</td><td style="color: #fff;">{file_size_bytes / (1024*1024):.2f} MB</td></tr>
            <tr><td style="padding: 5px; color: #888;">Upload Time:</td><td style="color: #fff;">{upload_timestamp}</td></tr>
            <tr><td style="padding: 5px; color: #888;">Report Generated:</td><td style="color: #fff;">{export_timestamp}</td></tr>
            <tr><td style="padding: 5px; color: #888;">Workstation:</td><td style="color: #fff;">{hostname}</td></tr>
        </table>
        <div style="margin-top: 15px; font-size: 0.8rem; color: #666; border-top: 1px solid #333; padding-top: 10px;">
            CHAIN OF CUSTODY NOTICE: This report was generated by mySQLhelper v1.4. The original evidence file was accessed in READ-ONLY mode.
            SQL queries listed below were executed against a temporary copy or the verified artifact.
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
    app.run(debug=os.environ.get('FLASK_DEBUG', 'False').lower() == 'true')