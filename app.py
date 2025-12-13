import sqlite3
import os
import requests
import json
import re
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

# Initialize Server-side Session
Session(app)

LLM_API_URL = os.environ.get('LLM_API_URL', "http://localhost:1234/v1/chat/completions")

# Ensure upload directory exists
UPLOAD_FOLDER = 'uploads'
if not os.path.exists(UPLOAD_FOLDER):
    os.makedirs(UPLOAD_FOLDER)

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

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/upload', methods=['POST'])
def upload_file():
    if 'database_file' not in request.files:
        return jsonify({'error': 'No file part'})
    file = request.files['database_file']
    if file.filename == '':
        return jsonify({'error': 'No selected file'})
    if file:
        filename = secure_filename(file.filename)
        filepath = os.path.join(UPLOAD_FOLDER, filename)
        file.save(filepath)

        session['db_filepath'] = filepath
        session['chat_history'] = []

        try:
            conn = sqlite3.connect(filepath)
            cursor = conn.cursor()
            cursor.execute("SELECT name FROM sqlite_master WHERE type='table';")
            tables = cursor.fetchall()
            schema = {}
            for table_name in tables:
                table_name = table_name[0]
                cursor.execute(f"PRAGMA table_info({table_name});")
                columns = cursor.fetchall()
                schema[table_name] = [column[1] for column in columns]
            conn.close()
            return jsonify({'schema': schema})
        except sqlite3.Error as e:
            return jsonify({'error': f"Database error: {e}"})

@app.route('/chat_stream', methods=['POST'])
def chat_stream():
    print("--- Chat Request Start ---")
    user_message = request.json.get('message')
    db_filepath = session.get('db_filepath')
    chat_history = session.get('chat_history', [])
    
    print(f"Loaded chat_history length: {len(chat_history)}")

    if not user_message:
        return jsonify({'error': 'Empty message'}), 400

    prompt_context = user_message
    
    # Inject Schema Context if DB is loaded
    if db_filepath:
        # We only strictly need to inject schema if it's the start or if we want to ensure context.
        # For a "Hive Mind" approach, let's keep it robust: always check structure availability.
        try:
            conn = sqlite3.connect(db_filepath)
            cursor = conn.cursor()
            cursor.execute("SELECT name FROM sqlite_master WHERE type='table';")
            tables = cursor.fetchall()
            schema_str = "Database Schema:\n"
            for table_name in tables:
                table_name = table_name[0]
                schema_str += f"Table: {table_name}\nColumns: "
                cursor.execute(f"PRAGMA table_info({table_name});")
                columns = cursor.fetchall()
                schema_str += ", ".join([column[1] for column in columns]) + "\n"
            conn.close()
            
            # Simple context injection strategy
            # If history is empty, prepend schema.
            # If history exists, we assume the LLM remembers, but we can re-inject if needed.
            if not chat_history:
                prompt_context = f"Context: Database Schema:\n{schema_str}\n\nUser Question: {user_message}"
            else:
                prompt_context = user_message

        except sqlite3.Error as e:
            return jsonify({'error': f"Database access error: {e}"}), 500

    print(f"Prompt Context Length: {len(prompt_context)}")
    chat_history.append({"role": "user", "content": prompt_context})

    system_prompt = """
You are a SQL expert.
1. If the user asks for data, output ONLY a valid SQL query inside a markdown code block:
```sql
SELECT ...
```
2. If the user chats or asks about the schema, reply in plain text.
3. NEVER modify data. Read-only.
"""
    messages_to_send = [{"role": "system", "content": system_prompt}] + chat_history
    print(f"Messages to send count: {len(messages_to_send)}")
    # print(f"Messages content: {json.dumps(messages_to_send, indent=2)}") # Uncomment for deep debug
    
    def stream_llm_response():
        headers = {"Content-Type": "application/json"}
        payload = {"messages": messages_to_send, "mode": "chat", "temperature": 0.1, "stream": True}
        
        full_response = ""
        try:
            with requests.post(LLM_API_URL, headers=headers, json=payload, stream=True) as r:
                r.raise_for_status()
                for line in r.iter_lines():
                    if line:
                        decoded_line = line.decode('utf-8')
                        if decoded_line.startswith('data: '):
                            try:
                                json_data = json.loads(decoded_line[6:])
                                if 'choices' in json_data and json_data['choices']:
                                    delta = json_data['choices'][0].get('delta', {})
                                    content_chunk = delta.get('content', '')
                                    if content_chunk:
                                        full_response += content_chunk
                                        yield content_chunk
                            except json.JSONDecodeError:
                                continue
            
            
            # Send End Token
            yield f"<|END_OF_STREAM|>{full_response}"

        except requests.exceptions.RequestException as e:
            yield f"LLM Error: {str(e)}"

    return Response(stream_with_context(stream_llm_response()), content_type='text/plain')

@app.route('/save_assistant_message', methods=['POST'])
def save_assistant_message():
    content = request.json.get('content')
    if not content:
        return jsonify({'error': 'No content provided'}), 400
    
    chat_history = session.get('chat_history', [])
    chat_history.append({"role": "assistant", "content": content})
    session['chat_history'] = chat_history
    return jsonify({'status': 'success'})

@app.route('/execute_sql', methods=['POST'])
def execute_sql():
    data = request.json
    sql_query = data.get('sql_query')
    db_filepath = session.get('db_filepath')
    chat_history = session.get('chat_history', [])

    if not sql_query or not db_filepath:
        return jsonify({'error': 'Missing SQL or Database'}), 400

    # SECURITY CHECK
    is_valid, error_msg = validate_sql(sql_query)
    if not is_valid:
        return jsonify({'error': error_msg}), 403

    try:
        conn = sqlite3.connect(db_filepath)
        # Use a row factory to get dict-like access if needed, but list of dicts is fine
        conn.row_factory = sqlite3.Row 
        cursor = conn.cursor()
        cursor.execute(sql_query)
        results = cursor.fetchall() # This might be large, but we'll paginate in frontend or limit here?
        # For safety/performance, let's limit backend fetch if huge, 
        # but requirements said "up to 1GB db", returning all rows might crash memory.
        # Let's trust the 'Show More' frontend logic for now, but in reality 
        # we should probably limit this to 1000 rows max.
        results = results[:2000] 
        
        column_names = results[0].keys() if results else []
        results_dict = [dict(row) for row in results]
        
        conn.close()

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
    for entry in chat_history:
        role = entry.get("role")
        content = entry.get("content", "")
        
        if role == "user":
            user_text = content.split("User Question: ")[-1] if "User Question: " in content else content
            chat_html_parts.append(f'<div class="chat-message user-message"><p>{user_text}</p></div>')
        
        elif role == "assistant":
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
            
            chat_html_parts.append(f'<div class="chat-message bot-message">{"".join(parts)}</div>')
            
    return "\n".join(chat_html_parts)

@app.route('/export_chat', methods=['GET'])
def export_chat():
    chat_history = session.get('chat_history', [])
    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>Chat Export</title>
    <style>{_get_css_content()}</style>
</head>
<body>
    <div class="app-container">
        <div class="main-chat">
            <div class="chat-container">
                <div class="chat-history">
                    {_generate_chat_html(chat_history)}
                </div>
            </div>
        </div>
    </div>
</body>
</html>"""
    
    resp = make_response(html)
    resp.headers["Content-Disposition"] = "attachment; filename=chat_export.html"
    return resp

if __name__ == '__main__':
    app.run(debug=os.environ.get('FLASK_DEBUG', 'False').lower() == 'true')