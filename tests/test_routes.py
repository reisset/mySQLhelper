"""Route-level tests using Flask test client."""

import gc
import io
import os
import sqlite3
import tempfile
from unittest.mock import patch

import pytest
from yoursqlfriend.app import app, VERSION


@pytest.fixture
def client():
    app.config['TESTING'] = True
    app.config['SESSION_TYPE'] = 'filesystem'
    with app.test_client() as client:
        yield client


@pytest.fixture
def temp_db():
    """Create a temporary SQLite database with a test table."""
    fd, path = tempfile.mkstemp(suffix='.db')
    os.close(fd)
    conn = sqlite3.connect(path)
    conn.execute('CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, email TEXT)')
    conn.execute("INSERT INTO users VALUES (1, 'Alice', 'alice@example.com')")
    conn.execute("INSERT INTO users VALUES (2, 'Bob', 'bob@example.com')")
    conn.commit()
    conn.close()  # explicit close — required for os.unlink on Windows
    yield path
    gc.collect()  # ensure any lingering read-only SQLite handles are released on Windows
    os.unlink(path)


def _load_db(client, db_path):
    """Helper: set session state as if a DB was uploaded."""
    with client.session_transaction() as sess:
        sess['db_filepath'] = db_path
        sess['db_hash'] = 'abc123'
        sess['original_filename'] = 'test.db'
        sess['chat_history'] = []


# --- GET / ---

class TestIndex:
    def test_index_returns_200(self, client):
        resp = client.get('/')
        assert resp.status_code == 200


# --- GET /api/version ---

class TestVersion:
    def test_returns_version(self, client):
        resp = client.get('/api/version')
        assert resp.status_code == 200
        assert resp.get_json()['version'] == VERSION


# --- POST /upload ---

class TestUpload:
    def test_no_file_part(self, client):
        resp = client.post('/upload')
        assert resp.status_code == 400
        assert 'No file part' in resp.get_json()['error']

    def test_empty_filename(self, client):
        data = {'database_file': (io.BytesIO(b''), '')}
        resp = client.post('/upload', data=data, content_type='multipart/form-data')
        assert resp.status_code == 400
        assert 'No selected file' in resp.get_json()['error']

    def test_invalid_extension(self, client):
        data = {'database_file': (io.BytesIO(b'hello'), 'test.txt')}
        resp = client.post('/upload', data=data, content_type='multipart/form-data')
        assert resp.status_code == 400
        assert 'Invalid file type' in resp.get_json()['error']

    def test_valid_db_upload(self, client, temp_db):
        with open(temp_db, 'rb') as f:
            data = {'database_file': (f, 'test.db')}
            resp = client.post('/upload', data=data, content_type='multipart/form-data')
        assert resp.status_code == 200
        body = resp.get_json()
        assert 'schema' in body
        assert 'users' in body['schema']


# --- POST /execute_sql ---

class TestExecuteSQL:
    def test_empty_body(self, client):
        resp = client.post('/execute_sql', json={})
        assert resp.status_code == 400

    def test_missing_query(self, client, temp_db):
        _load_db(client, temp_db)
        resp = client.post('/execute_sql', json={})
        assert resp.status_code == 400

    def test_valid_select(self, client, temp_db):
        _load_db(client, temp_db)
        resp = client.post('/execute_sql', json={'sql_query': 'SELECT * FROM users'})
        assert resp.status_code == 200
        data = resp.get_json()
        assert len(data['query_results']) == 2

    def test_forbidden_drop(self, client, temp_db):
        _load_db(client, temp_db)
        resp = client.post('/execute_sql', json={'sql_query': 'DROP TABLE users'})
        assert resp.status_code == 403


# --- POST /search_all_tables ---

class TestSearchAllTables:
    def test_no_db_loaded(self, client):
        resp = client.post('/search_all_tables', json={'search_term': 'test'})
        assert resp.status_code == 400
        assert 'No database loaded' in resp.get_json()['error']

    def test_empty_search_term(self, client, temp_db):
        _load_db(client, temp_db)
        resp = client.post('/search_all_tables', json={'search_term': ''})
        assert resp.status_code == 400

    def test_valid_search(self, client, temp_db):
        _load_db(client, temp_db)
        resp = client.post('/search_all_tables', json={'search_term': 'Alice'})
        assert resp.status_code == 200
        data = resp.get_json()
        assert data['total_matches'] >= 1


# --- POST /save_assistant_message ---

class TestSaveAssistantMessage:
    def test_empty_body(self, client):
        resp = client.post('/save_assistant_message', json={})
        assert resp.status_code == 400

    def test_empty_content(self, client):
        resp = client.post('/save_assistant_message', json={'content': ''})
        assert resp.status_code == 400

    def test_valid_save(self, client):
        with client.session_transaction() as sess:
            sess['chat_history'] = []
        resp = client.post('/save_assistant_message', json={'content': 'Hello!'})
        assert resp.status_code == 200
        data = resp.get_json()
        assert data['status'] == 'success'
        assert 'message_id' in data


# --- GET /export_chat ---

class TestExportChat:
    def test_export_returns_html(self, client):
        with client.session_transaction() as sess:
            sess['chat_history'] = [
                {'role': 'user', 'content': 'test question'},
                {'role': 'assistant', 'content': 'test answer', 'id': '123'},
            ]
            sess['db_hash'] = 'a' * 64
        resp = client.get('/export_chat')
        assert resp.status_code == 200
        assert 'Content-Disposition' in resp.headers
        assert 'Analysis_Report_' in resp.headers['Content-Disposition']


# --- POST /execute_sql (retry / auto-correction paths) ---

class TestExecuteSQLRetry:
    """Test the auto-correction retry logic introduced in v3.10.0."""

    @patch('yoursqlfriend.app.build_schema_context', return_value=('', False))
    @patch('yoursqlfriend.app.call_llm_non_streaming')
    def test_retry_structured_output_success(self, mock_llm, mock_schema, client, temp_db):
        """Primary path: LLM returns JSON {"sql": "..."} and the corrected query runs."""
        _load_db(client, temp_db)
        mock_llm.return_value = '{"sql": "SELECT * FROM users"}'

        resp = client.post('/execute_sql', json={'sql_query': 'SELECT * FROM nonexistent_table'})
        assert resp.status_code == 200
        data = resp.get_json()
        assert data.get('retried') is True
        assert data.get('corrected_sql') == 'SELECT * FROM users'
        assert len(data.get('query_results', [])) == 2

    @patch('yoursqlfriend.app.build_schema_context', return_value=('', False))
    @patch('yoursqlfriend.app.call_llm_non_streaming')
    def test_retry_regex_fallback(self, mock_llm, mock_schema, client, temp_db):
        """Fallback path: JSON parse fails so the regex extracts the SQL from a code block."""
        _load_db(client, temp_db)
        mock_llm.return_value = '```sql\nSELECT * FROM users\n```'

        resp = client.post('/execute_sql', json={'sql_query': 'SELECT * FROM nonexistent_table'})
        assert resp.status_code == 200
        data = resp.get_json()
        assert data.get('retried') is True
        assert data.get('corrected_sql') == 'SELECT * FROM users'

    @patch('yoursqlfriend.app.build_schema_context', return_value=('', False))
    @patch('yoursqlfriend.app.call_llm_non_streaming')
    def test_retry_total_failure_returns_500(self, mock_llm, mock_schema, client, temp_db):
        """Both JSON and regex fail: should return 500 with the original SQL error, not crash."""
        _load_db(client, temp_db)
        mock_llm.return_value = ''

        resp = client.post('/execute_sql', json={'sql_query': 'SELECT * FROM nonexistent_table'})
        assert resp.status_code == 500
        error_body = resp.get_json()
        assert 'SQL Error' in error_body.get('error', '')


# --- POST /search_all_tables (special character edge cases) ---

@pytest.fixture
def special_char_db():
    """DB with values containing SQL wildcard characters to test search correctness."""
    fd, path = tempfile.mkstemp(suffix='.db')
    os.close(fd)
    conn = sqlite3.connect(path)
    conn.execute('CREATE TABLE artifacts (id INTEGER PRIMARY KEY, tag TEXT)')
    # Rows deliberately chosen to expose LIKE/GLOB wildcard confusion
    conn.execute("INSERT INTO artifacts VALUES (1, '100%done')")   # target for case-sensitive %
    conn.execute("INSERT INTO artifacts VALUES (2, '100Xdone')")   # false-positive for LIKE only
    conn.execute("INSERT INTO artifacts VALUES (3, 'data_val')")   # target for case-insensitive _
    conn.execute("INSERT INTO artifacts VALUES (4, 'dataXval')")   # false-positive for LIKE _
    conn.commit()
    conn.close()
    yield path
    gc.collect()
    os.unlink(path)


class TestSearchSpecialChars:
    def _load(self, client, db_path):
        with client.session_transaction() as sess:
            sess['db_filepath'] = db_path
            sess['db_hash'] = 'sc123'
            sess['original_filename'] = 'special.db'
            sess['chat_history'] = []

    def test_case_sensitive_percent_in_term(self, client, special_char_db):
        """Case-sensitive search for '100%done' must not return '100Xdone'."""
        self._load(client, special_char_db)
        resp = client.post('/search_all_tables',
                           json={'search_term': '100%done', 'case_sensitive': True})
        assert resp.status_code == 200
        data = resp.get_json()
        # Flatten all matched values across tables/columns
        all_values = []
        for tbl in data.get('results', {}).values():
            for vals in tbl.get('columns', {}).values():
                all_values.extend(vals)
        assert '100%done' in all_values
        assert '100Xdone' not in all_values

    def test_case_insensitive_underscore_in_term(self, client, special_char_db):
        """Case-insensitive search for 'data_val' must not return 'dataXval'."""
        self._load(client, special_char_db)
        resp = client.post('/search_all_tables',
                           json={'search_term': 'data_val', 'case_sensitive': False})
        assert resp.status_code == 200
        data = resp.get_json()
        all_values = []
        for tbl in data.get('results', {}).values():
            for vals in tbl.get('columns', {}).values():
                all_values.extend(vals)
        assert 'data_val' in all_values
        assert 'dataXval' not in all_values


# --- POST /chat_stream ---

class TestChatStream:
    def test_empty_body(self, client):
        resp = client.post('/chat_stream', json={})
        assert resp.status_code == 400

    def test_empty_message(self, client):
        resp = client.post('/chat_stream', json={'message': ''})
        assert resp.status_code == 400
