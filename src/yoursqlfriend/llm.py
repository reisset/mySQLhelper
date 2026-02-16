"""LLM provider abstraction: config, prompts, streaming, and non-streaming calls."""

import os
import json
import sqlite3
import logging

import requests

logger = logging.getLogger(__name__)

LLM_API_URL = os.environ.get('LLM_API_URL', "http://localhost:1234/v1/chat/completions")
OLLAMA_URL = os.environ.get('OLLAMA_URL', "http://localhost:11434")
OLLAMA_MODEL = os.environ.get('OLLAMA_MODEL', 'llama3.2')


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


def get_provider_config(provider, model=None):
    """Return provider-specific configuration for LLM requests.

    Returns dict with url, headers, model, label, hint, stream_timeout,
    and helpers for building payloads and extracting non-streaming responses.
    """
    if provider == 'ollama':
        model = model or OLLAMA_MODEL
        return {
            'provider': 'ollama',
            'url': f'{OLLAMA_URL}/api/chat',
            'headers': None,
            'model': model,
            'label': 'Ollama',
            'hint': 'Is Ollama running? (ollama serve)',
            'stream_timeout': (3.05, 120),
        }
    return {
        'provider': 'lmstudio',
        'url': LLM_API_URL,
        'headers': {'Content-Type': 'application/json'},
        'model': None,
        'label': 'LM Studio',
        'hint': 'Is the server running at http://localhost:1234?',
        'stream_timeout': (3.05, 60),
    }


def _build_llm_payload(config, messages, stream=False):
    """Build request payload for the given provider config."""
    if config['provider'] == 'ollama':
        return {
            'model': config['model'],
            'messages': messages,
            'stream': stream,
            'options': {'temperature': 0.1},
        }
    payload = {
        'messages': messages,
        'temperature': 0.1,
        'stream': stream,
    }
    if stream:
        payload['mode'] = 'chat'
        payload['stream_options'] = {'include_usage': True}
    return payload


def _extract_llm_content(config, data):
    """Extract text content from a non-streaming LLM response."""
    if config['provider'] == 'ollama':
        return data.get('message', {}).get('content', '')
    choices = data.get('choices', [])
    return choices[0].get('message', {}).get('content', '') if choices else ''


def build_schema_context(db_filepath, include_samples=True):
    """Build schema context string from database file for LLM prompts.

    Includes CREATE TABLE DDL, foreign key relationships, and optionally
    sample data. Set include_samples=False for error correction prompts.
    """
    if not db_filepath:
        return ""

    with sqlite3.connect(db_filepath) as conn:
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

            # Sample data (3 rows, compact pipe-delimited format)
            if include_samples:
                try:
                    cursor.execute(f'SELECT * FROM "{table_name}" LIMIT 3;')
                    rows = cursor.fetchall()
                    if rows:
                        col_names = [desc[0] for desc in cursor.description]
                        parts.append(f"-- {table_name} sample ({' | '.join(col_names)}):")
                        for row in rows:
                            parts.append('|'.join(
                                str(v)[:50] + '...' if v is not None and len(str(v)) > 50
                                else 'NULL' if v is None
                                else str(v)
                                for v in row
                            ))
                        parts.append("")
                except sqlite3.Error:
                    pass

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
    return f"""You are a SQLite expert assisting a forensic analyst. READ-ONLY environment — never output INSERT, UPDATE, DELETE, DROP, or any modification commands.

Rules:
- Schema-only questions (structure, relationships): respond in plain text, no SQL.
- Data questions: brief explanation (1-2 sentences), then exactly ONE ```sql block. SQLite syntax only.
- Use only tables/columns from the schema below.
- Direct requests ("show me X"): write the query immediately, no confirmation.
- If ambiguous, ask one clarifying question.

Example 1 — Data retrieval:
User: "Show me the 10 most recent entries in the logs table"
Assistant: "I'll query the most recent 10 log entries by timestamp."
```sql
SELECT * FROM logs ORDER BY timestamp DESC LIMIT 10;
```

Example 2 — Structural question:
User: "How are the tables related?"
Assistant: "Based on the schema, **orders** links to **customers** via CustomerId, and **order_items** connects to both **orders** and **products** via foreign keys."

{schema_context}"""


def call_llm_non_streaming(messages, provider='lmstudio', model=None):
    """Make a non-streaming LLM call and return the response text. Used for SQL retry."""
    try:
        config = get_provider_config(provider, model)
        payload = _build_llm_payload(config, messages, stream=False)
        r = requests.post(config['url'], headers=config['headers'], json=payload, timeout=30)
        r.raise_for_status()
        return _extract_llm_content(config, r.json())
    except Exception as e:
        logger.error(f"Non-streaming LLM call failed: {e}")
        return ''


def stream_llm_response(messages_to_send, provider, model=None):
    """Stream response from LLM provider (LM Studio or Ollama)."""
    config = get_provider_config(provider, model)
    payload = _build_llm_payload(config, messages_to_send, stream=True)

    full_response = ""
    token_usage = None

    try:
        with requests.post(config['url'], headers=config['headers'], json=payload, stream=True, timeout=config['stream_timeout']) as r:
            r.raise_for_status()
            for line in r.iter_lines():
                if not line:
                    continue

                if config['provider'] == 'ollama':
                    try:
                        data = json.loads(line)
                        content = data.get('message', {}).get('content', '')
                        if content:
                            full_response += content
                            yield content

                        if data.get('done', False):
                            token_usage = {
                                'prompt_tokens': data.get('prompt_eval_count', 0),
                                'completion_tokens': data.get('eval_count', 0),
                                'total_tokens': data.get('prompt_eval_count', 0) + data.get('eval_count', 0)
                            }
                    except json.JSONDecodeError:
                        continue
                else:
                    decoded_line = line.decode('utf-8')
                    if not decoded_line.startswith('data: '):
                        continue
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
            logger.info(f"{config['label']} Response Complete. Tokens: {token_usage}")
            yield f"<|END_OF_STREAM|>{full_response}<|TOKEN_USAGE|>{json.dumps(token_usage)}"
        else:
            logger.info(f"{config['label']} Response Complete (No token usage data)")
            yield f"<|END_OF_STREAM|>{full_response}"

    except requests.exceptions.Timeout:
        logger.error(f"{config['label']} request timed out")
        yield f"Error: {config['label']} request timed out. {config['hint']}"
    except requests.exceptions.ConnectionError:
        logger.error(f"Cannot connect to {config['label']}")
        yield f"Error: Cannot connect to {config['label']}. {config['hint']}"
    except requests.exceptions.RequestException as e:
        logger.error(f"{config['label']} Stream Error: {str(e)}")
        yield f"{config['label']} Error: {str(e)}"
