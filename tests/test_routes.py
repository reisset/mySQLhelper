"""Route-level tests using Flask test client."""

import io
import os
import sqlite3
import tempfile

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
    with sqlite3.connect(path) as conn:
        conn.execute('CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, email TEXT)')
        conn.execute("INSERT INTO users VALUES (1, 'Alice', 'alice@example.com')")
        conn.execute("INSERT INTO users VALUES (2, 'Bob', 'bob@example.com')")
    yield path
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


# --- GET /api/schema/diagram ---

class TestSchemaDiagram:
    def test_no_db_loaded(self, client):
        resp = client.get('/api/schema/diagram')
        assert resp.status_code == 400

    def test_with_db(self, client, temp_db):
        _load_db(client, temp_db)
        resp = client.get('/api/schema/diagram')
        assert resp.status_code == 200
        data = resp.get_json()
        assert len(data['tables']) == 1
        assert data['tables'][0]['name'] == 'users'


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


# --- POST /add_note ---

class TestAddNote:
    def test_missing_fields(self, client):
        resp = client.post('/add_note', json={})
        assert resp.status_code == 400

    def test_message_not_found(self, client):
        with client.session_transaction() as sess:
            sess['chat_history'] = []
        resp = client.post('/add_note', json={'message_id': 'nonexistent', 'note_content': 'test'})
        assert resp.status_code == 404

    def test_valid_note(self, client):
        msg_id = 'test-msg-123'
        with client.session_transaction() as sess:
            sess['chat_history'] = [{'role': 'assistant', 'content': 'hi', 'id': msg_id}]
        resp = client.post('/add_note', json={'message_id': msg_id, 'note_content': 'Important finding'})
        assert resp.status_code == 200
        assert resp.get_json()['status'] == 'success'


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


# --- POST /chat_stream ---

class TestChatStream:
    def test_empty_body(self, client):
        resp = client.post('/chat_stream', json={})
        assert resp.status_code == 400

    def test_empty_message(self, client):
        resp = client.post('/chat_stream', json={'message': ''})
        assert resp.status_code == 400
