"""Route-level tests using Flask test client."""

import gc
import io
import os
import sqlite3
import tempfile
from unittest.mock import patch

import pytest
from yoursqlfriend.app import (
    app, VERSION, MAX_SQL_CORRECTION_ROUNDS, MAX_HISTORY_MESSAGES,
    SEARCH_MAX_VALUES_PER_COLUMN,
)
from yoursqlfriend.database import MAX_RESULT_ROWS


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
    @patch('yoursqlfriend.app.resolve_provider_model', return_value=None)
    def test_retry_structured_output_success(self, mock_resolve, mock_llm, mock_schema, client, temp_db):
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
    @patch('yoursqlfriend.app.resolve_provider_model', return_value=None)
    def test_retry_regex_fallback(self, mock_resolve, mock_llm, mock_schema, client, temp_db):
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
    @patch('yoursqlfriend.app.resolve_provider_model', return_value=None)
    def test_retry_total_failure_returns_500(self, mock_resolve, mock_llm, mock_schema, client, temp_db):
        """Both JSON and regex fail: should return 500 with the original SQL error, not crash."""
        _load_db(client, temp_db)
        mock_llm.return_value = ''

        resp = client.post('/execute_sql', json={'sql_query': 'SELECT * FROM nonexistent_table'})
        assert resp.status_code == 500
        error_body = resp.get_json()
        assert 'SQL Error' in error_body.get('error', '')

    @pytest.mark.parametrize('llm_response', [
        '```SQL\nSELECT * FROM users\n```',          # uppercase tag
        '```sqlite\nSELECT * FROM users\n```',       # sqlite tag
        '```sql SELECT * FROM users```',             # single-line fence
        '```\nSELECT * FROM users\n```',             # untagged fence
        'SELECT * FROM users',                       # bare SQL, no fence at all
    ])
    @patch('yoursqlfriend.app.build_schema_context', return_value=('', False))
    @patch('yoursqlfriend.app.call_llm_non_streaming')
    @patch('yoursqlfriend.app.resolve_provider_model', return_value=None)
    def test_retry_tolerant_fallback_variants(self, mock_resolve, mock_llm, mock_schema, client, temp_db, llm_response):
        """Fallback extraction handles imperfect fencing from weaker local models."""
        _load_db(client, temp_db)
        mock_llm.return_value = llm_response

        resp = client.post('/execute_sql', json={'sql_query': 'SELECT * FROM nonexistent_table'})
        assert resp.status_code == 200
        data = resp.get_json()
        assert data.get('retried') is True
        assert data.get('corrected_sql') == 'SELECT * FROM users'

    @patch('yoursqlfriend.app.build_schema_context', return_value=('', False))
    @patch('yoursqlfriend.app.call_llm_non_streaming')
    @patch('yoursqlfriend.app.resolve_provider_model', return_value=None)
    def test_retry_bare_prose_still_fails(self, mock_resolve, mock_llm, mock_schema, client, temp_db):
        """A prose-only response with no SQL must not be executed."""
        _load_db(client, temp_db)
        mock_llm.return_value = 'Sorry, I cannot help with that.'

        resp = client.post('/execute_sql', json={'sql_query': 'SELECT * FROM nonexistent_table'})
        assert resp.status_code == 500
        assert 'SQL Error' in resp.get_json().get('error', '')


# --- POST /execute_sql (multi-round correction loop) ---

class TestExecuteSQLMultiRoundCorrection:
    """Execution-feedback loop: up to MAX_SQL_CORRECTION_ROUNDS correction rounds,
    each fed the latest sqlite error; repeated SQL breaks the loop early."""

    @patch('yoursqlfriend.app.build_schema_context', return_value=('', False))
    @patch('yoursqlfriend.app.call_llm_non_streaming')
    @patch('yoursqlfriend.app.resolve_provider_model', return_value=None)
    def test_second_round_succeeds(self, mock_resolve, mock_llm, mock_schema, client, temp_db):
        """Round 1 correction also fails; round 2 fixes it. Prior attempts are listed in round 2's prompt."""
        _load_db(client, temp_db)
        mock_llm.side_effect = [
            '{"sql": "SELECT * FROM still_wrong"}',
            '{"sql": "SELECT * FROM users"}',
        ]

        resp = client.post('/execute_sql', json={'sql_query': 'SELECT * FROM nonexistent_table'})
        assert resp.status_code == 200
        data = resp.get_json()
        assert data.get('retried') is True
        assert data.get('corrected_sql') == 'SELECT * FROM users'
        assert data.get('correction_rounds') == 2
        assert mock_llm.call_count == 2

        # Round 2's prompt must carry the execution feedback: the round-1 failure
        # as the failed query, and the original query in the already-tried list.
        second_prompt = mock_llm.call_args_list[1][0][0][1]['content']
        assert 'SELECT * FROM still_wrong' in second_prompt
        assert 'already tried' in second_prompt
        assert 'SELECT * FROM nonexistent_table' in second_prompt

    @patch('yoursqlfriend.app.build_schema_context', return_value=('', False))
    @patch('yoursqlfriend.app.call_llm_non_streaming')
    @patch('yoursqlfriend.app.resolve_provider_model', return_value=None)
    def test_repeat_of_original_breaks_immediately(self, mock_resolve, mock_llm, mock_schema, client, temp_db):
        """LLM returns the exact query that just failed → stop, don't burn more rounds."""
        _load_db(client, temp_db)
        mock_llm.return_value = '{"sql": "SELECT * FROM nonexistent_table"}'

        resp = client.post('/execute_sql', json={'sql_query': 'SELECT * FROM nonexistent_table'})
        assert resp.status_code == 500
        assert 'SQL Error' in resp.get_json().get('error', '')
        assert mock_llm.call_count == 1

    @patch('yoursqlfriend.app.build_schema_context', return_value=('', False))
    @patch('yoursqlfriend.app.call_llm_non_streaming')
    @patch('yoursqlfriend.app.resolve_provider_model', return_value=None)
    def test_repeated_correction_breaks_early(self, mock_resolve, mock_llm, mock_schema, client, temp_db):
        """LLM suggests the same failing correction twice → loop exits on the repeat."""
        _load_db(client, temp_db)
        mock_llm.side_effect = [
            '{"sql": "SELECT * FROM still_wrong"}',
            '{"sql": "SELECT * FROM still_wrong;"}',  # same modulo trailing semicolon
        ]

        resp = client.post('/execute_sql', json={'sql_query': 'SELECT * FROM nonexistent_table'})
        assert resp.status_code == 500
        assert 'SQL Error' in resp.get_json().get('error', '')
        assert mock_llm.call_count == 2

    @patch('yoursqlfriend.app.build_schema_context', return_value=('', False))
    @patch('yoursqlfriend.app.call_llm_non_streaming')
    @patch('yoursqlfriend.app.resolve_provider_model', return_value=None)
    def test_all_rounds_fail_returns_original_error(self, mock_resolve, mock_llm, mock_schema, client, temp_db):
        """Every correction round fails → 500 carrying the ORIGINAL error, after exactly MAX rounds."""
        _load_db(client, temp_db)
        mock_llm.side_effect = [
            f'{{"sql": "SELECT * FROM wrong_{i}"}}' for i in range(MAX_SQL_CORRECTION_ROUNDS)
        ]

        resp = client.post('/execute_sql', json={'sql_query': 'SELECT * FROM nonexistent_table'})
        assert resp.status_code == 500
        error = resp.get_json().get('error', '')
        assert 'SQL Error' in error
        assert 'nonexistent_table' in error
        assert mock_llm.call_count == MAX_SQL_CORRECTION_ROUNDS

    @patch('yoursqlfriend.app.build_schema_context', return_value=('', False))
    @patch('yoursqlfriend.app.call_llm_non_streaming')
    @patch('yoursqlfriend.app.resolve_provider_model', return_value=None)
    def test_correction_context_includes_samples(self, mock_resolve, mock_llm, mock_schema, client, temp_db):
        """The correction schema context is built WITH sample rows (value/format grounding)."""
        _load_db(client, temp_db)
        mock_llm.return_value = '{"sql": "SELECT * FROM users"}'

        resp = client.post('/execute_sql', json={'sql_query': 'SELECT * FROM nonexistent_table'})
        assert resp.status_code == 200
        mock_schema.assert_called_once()
        assert mock_schema.call_args[1].get('include_samples') is True


# --- Cross-site POST guard ---

class TestCrossSiteGuard:
    def test_cross_origin_post_rejected(self, client):
        resp = client.post('/execute_sql', json={'sql_query': 'SELECT 1'},
                           headers={'Origin': 'http://evil.example.com'})
        assert resp.status_code == 403

    def test_null_origin_post_rejected(self, client):
        """Origin: null (sandboxed iframe / file:// page) is never our own UI."""
        resp = client.post('/execute_sql', json={'sql_query': 'SELECT 1'},
                           headers={'Origin': 'null'})
        assert resp.status_code == 403

    def test_localhost_origin_post_allowed(self, client, temp_db):
        _load_db(client, temp_db)
        resp = client.post('/execute_sql', json={'sql_query': 'SELECT * FROM users'},
                           headers={'Origin': 'http://localhost'})
        assert resp.status_code == 200

    def test_no_origin_post_allowed(self, client, temp_db):
        """Same-origin requests and non-browser clients often omit Origin."""
        _load_db(client, temp_db)
        resp = client.post('/execute_sql', json={'sql_query': 'SELECT * FROM users'})
        assert resp.status_code == 200

    def test_rebound_host_post_rejected(self, client):
        """DNS rebinding: non-loopback Host header while bound to loopback."""
        resp = client.post('/execute_sql', json={'sql_query': 'SELECT 1'},
                           headers={'Host': 'evil.example.com'})
        assert resp.status_code == 403

    def test_get_requests_unaffected(self, client):
        resp = client.get('/', headers={'Origin': 'http://evil.example.com'})
        assert resp.status_code == 200


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

    @patch('yoursqlfriend.app.check_llm_available', return_value=False)
    def test_provider_down_returns_503(self, mock_health, client):
        resp = client.post('/chat_stream', json={'message': 'hi'})
        assert resp.status_code == 503
        assert 'LM Studio' in resp.get_json()['error']

    @patch('yoursqlfriend.app.stream_llm_response')
    @patch('yoursqlfriend.app.resolve_provider_model', return_value=None)
    @patch('yoursqlfriend.app.check_llm_available', return_value=True)
    def test_success_streams_sse(self, mock_health, mock_resolve, mock_stream, client, temp_db):
        """The 200 path must be a real SSE response wired to the LLM stream."""
        _load_db(client, temp_db)
        mock_stream.return_value = iter([
            'event: token\ndata: {"chunk": "Hello"}\n\n',
            'event: done\ndata: {"token_usage": null}\n\n',
        ])
        resp = client.post('/chat_stream', json={'message': 'hi'})
        assert resp.status_code == 200
        assert resp.content_type.startswith('text/event-stream')
        assert resp.headers.get('Cache-Control') == 'no-cache'
        body = resp.get_data(as_text=True)
        assert 'event: token' in body
        assert 'event: done' in body

    @patch('yoursqlfriend.app.stream_llm_response', return_value=iter([]))
    @patch('yoursqlfriend.app.resolve_provider_model', return_value=None)
    @patch('yoursqlfriend.app.check_llm_available', return_value=True)
    def test_user_message_appended_to_session(self, mock_health, mock_resolve, mock_stream, client, temp_db):
        _load_db(client, temp_db)
        resp = client.post('/chat_stream', json={'message': 'where is the evidence?'})
        resp.get_data()  # consume the stream so the request context completes
        with client.session_transaction() as sess:
            history = sess.get('chat_history', [])
        assert history and history[-1]['role'] == 'user'
        assert history[-1]['content'] == 'where is the evidence?'

    @patch('yoursqlfriend.app.stream_llm_response', return_value=iter([]))
    @patch('yoursqlfriend.app.resolve_provider_model', return_value=None)
    @patch('yoursqlfriend.app.check_llm_available', return_value=True)
    def test_history_capped_in_llm_payload(self, mock_health, mock_resolve, mock_stream, client, temp_db):
        """Only the most recent MAX_HISTORY_MESSAGES turns (plus the system
        prompt) go to the model, however long the stored history is."""
        _load_db(client, temp_db)
        with client.session_transaction() as sess:
            sess['chat_history'] = [
                {'role': 'user', 'content': f'q{i}', 'id': str(i)}
                for i in range(MAX_HISTORY_MESSAGES + 15)
            ]
        client.post('/chat_stream', json={'message': 'latest'}).get_data()
        messages_sent = mock_stream.call_args[0][0]
        assert messages_sent[0]['role'] == 'system'
        assert len(messages_sent) == 1 + MAX_HISTORY_MESSAGES
        assert messages_sent[-1]['content'] == 'latest'


# --- POST /upload (CSV / .sql conversion branches) ---

class TestUploadConversions:
    def _cleanup_session_db(self, client):
        with client.session_transaction() as sess:
            path = sess.get('db_filepath')
        if path and os.path.exists(path):
            gc.collect()
            os.unlink(path)
        return path

    def test_csv_upload_converts_to_db(self, client):
        data = {'database_file': (io.BytesIO(b'id,name\n1,Alice\n2,Bob\n'), 'evidence.csv')}
        resp = client.post('/upload', data=data, content_type='multipart/form-data')
        try:
            assert resp.status_code == 200
            body = resp.get_json()
            assert 'csv_data' in body['schema']
            with client.session_transaction() as sess:
                path = sess['db_filepath']
            # The session must point at the converted .db, not the raw CSV
            assert path.endswith('.db')
            assert os.path.exists(path)
        finally:
            self._cleanup_session_db(client)

    def test_sql_upload_builds_db(self, client):
        sql = b"CREATE TABLE logs (id INTEGER, msg TEXT);\nINSERT INTO logs VALUES (1, 'boot');\n"
        data = {'database_file': (io.BytesIO(sql), 'dump.sql')}
        resp = client.post('/upload', data=data, content_type='multipart/form-data')
        try:
            assert resp.status_code == 200
            body = resp.get_json()
            assert 'logs' in body['schema']
            with client.session_transaction() as sess:
                path = sess['db_filepath']
            assert path.endswith('.db')
            assert os.path.exists(path)
        finally:
            self._cleanup_session_db(client)

    def test_sql_upload_forbidden_keyword_rejected(self, client):
        sql = b"ATTACH DATABASE 'other.db' AS other;"
        data = {'database_file': (io.BytesIO(sql), 'dump.sql')}
        resp = client.post('/upload', data=data, content_type='multipart/form-data')
        assert resp.status_code == 400
        assert 'forbidden keyword' in resp.get_json()['error']

    def test_corrupt_sqlite_rejected(self, client):
        data = {'database_file': (io.BytesIO(b'this is not a sqlite file' * 40), 'bad.db')}
        resp = client.post('/upload', data=data, content_type='multipart/form-data')
        assert resp.status_code == 400
        err = resp.get_json()['error']
        assert 'Invalid SQLite database' in err
        # Error hygiene: no filesystem paths leak to the client
        assert 'uploads' not in err


# --- POST /execute_sql (truncation flag) ---

class TestExecuteSQLTruncation:
    def test_oversized_result_flagged(self, client, temp_db):
        conn = sqlite3.connect(temp_db)
        conn.executemany('INSERT INTO users (name, email) VALUES (?, ?)',
                         [(f'u{i}', f'u{i}@x.com') for i in range(MAX_RESULT_ROWS + 10)])
        conn.commit()
        conn.close()
        _load_db(client, temp_db)
        resp = client.post('/execute_sql', json={'sql_query': 'SELECT * FROM users'})
        assert resp.status_code == 200
        data = resp.get_json()
        assert len(data['query_results']) == MAX_RESULT_ROWS
        assert data['truncated'] is True

    def test_small_result_not_flagged(self, client, temp_db):
        _load_db(client, temp_db)
        resp = client.post('/execute_sql', json={'sql_query': 'SELECT * FROM users'})
        assert resp.status_code == 200
        assert resp.get_json()['truncated'] is False


# --- POST /search_all_tables (per-column cap) ---

class TestSearchCap:
    def test_capped_flag_on_huge_column(self, client):
        fd, path = tempfile.mkstemp(suffix='.db')
        os.close(fd)
        try:
            conn = sqlite3.connect(path)
            conn.execute('CREATE TABLE big (val TEXT)')
            conn.executemany('INSERT INTO big VALUES (?)',
                             [(f'match_{i}',) for i in range(SEARCH_MAX_VALUES_PER_COLUMN + 20)])
            conn.commit()
            conn.close()
            with client.session_transaction() as sess:
                sess['db_filepath'] = path
            resp = client.post('/search_all_tables', json={'search_term': 'match'})
            assert resp.status_code == 200
            data = resp.get_json()
            assert data['capped'] is True
            assert data['total_matches'] <= SEARCH_MAX_VALUES_PER_COLUMN
        finally:
            gc.collect()
            os.unlink(path)


# --- POST /api/row/lookup (input validation) ---

class TestRowLookupValidation:
    def test_malformed_limit_returns_400(self, client, temp_db):
        _load_db(client, temp_db)
        resp = client.post('/api/row/lookup',
                           json={'table': 'users', 'column': 'id', 'value': 1, 'limit': 'abc'})
        assert resp.status_code == 400
        assert 'limit' in resp.get_json()['error']


# --- POST /clear_stored_data ---

class TestClearStoredData:
    def test_clears_uploads_but_keeps_active_db(self, client, tmp_path):
        uploads = tmp_path / 'uploads'
        sessions = tmp_path / 'sessions'
        uploads.mkdir()
        sessions.mkdir()
        active = uploads / 'active.db'
        active.write_bytes(b'a' * 10)
        stale = uploads / 'old_upload.db'
        stale.write_bytes(b'b' * 20)
        with client.session_transaction() as sess:
            sess['db_filepath'] = str(active)
        with patch('yoursqlfriend.app.UPLOAD_FOLDER', str(uploads)), \
             patch.dict(app.config, {'SESSION_FILE_DIR': str(sessions)}):
            resp = client.post('/clear_stored_data', json={})
        assert resp.status_code == 200
        data = resp.get_json()
        assert data['removed'] == 1
        assert data['freed_bytes'] == 20
        assert active.exists()
        assert not stale.exists()

    def test_stale_session_files_pruned_fresh_kept(self, client, tmp_path):
        import time as _time
        uploads = tmp_path / 'uploads'
        sessions = tmp_path / 'sessions'
        uploads.mkdir()
        sessions.mkdir()
        old = sessions / 'old_session'
        old.write_bytes(b'x')
        eight_days_ago = _time.time() - 8 * 24 * 3600
        os.utime(old, (eight_days_ago, eight_days_ago))
        fresh = sessions / 'fresh_session'
        fresh.write_bytes(b'y')
        with patch('yoursqlfriend.app.UPLOAD_FOLDER', str(uploads)), \
             patch.dict(app.config, {'SESSION_FILE_DIR': str(sessions)}):
            resp = client.post('/clear_stored_data', json={})
        assert resp.status_code == 200
        assert not old.exists()
        assert fresh.exists()

    def test_cross_origin_rejected(self, client):
        resp = client.post('/clear_stored_data', json={},
                           headers={'Origin': 'http://evil.example.com'})
        assert resp.status_code == 403


# --- GET /service-worker.js ---

class TestServiceWorker:
    def test_version_substituted_and_scoped(self, client):
        resp = client.get('/service-worker.js')
        assert resp.status_code == 200
        assert resp.headers.get('Service-Worker-Allowed') == '/'
        body = resp.get_data(as_text=True)
        assert '%%VERSION%%' not in body
        assert VERSION in body


# --- GET /api/provider/status (context window for the CTX bar) ---

class TestProviderStatus:
    @patch('yoursqlfriend.app.get_context_window', return_value=108000)
    @patch('yoursqlfriend.app.check_llm_available', return_value=True)
    def test_lmstudio_status_carries_context_length(self, mock_health, mock_ctx, client):
        resp = client.get('/api/provider/status?provider=lmstudio')
        assert resp.status_code == 200
        assert resp.get_json()['context_length'] == 108000
        mock_ctx.assert_called_once_with('lmstudio')

    @patch('yoursqlfriend.app.get_context_window', return_value=32768)
    @patch('yoursqlfriend.app.check_ollama_available', return_value=(True, ['m1', 'm2']))
    def test_ollama_status_carries_context_length(self, mock_avail, mock_ctx, client):
        resp = client.get('/api/provider/status?provider=ollama')
        data = resp.get_json()
        assert data['context_length'] == 32768
        mock_ctx.assert_called_once_with('ollama', 'm1')

    @patch('yoursqlfriend.app.get_context_window')
    @patch('yoursqlfriend.app.check_llm_available', return_value=False)
    def test_offline_provider_context_length_null(self, mock_health, mock_ctx, client):
        resp = client.get('/api/provider/status?provider=lmstudio')
        assert resp.get_json()['context_length'] is None
        mock_ctx.assert_not_called()

    @patch('yoursqlfriend.app.get_context_window')
    @patch('yoursqlfriend.app.check_ollama_available', return_value=(True, []))
    def test_ollama_no_models_context_length_null(self, mock_avail, mock_ctx, client):
        resp = client.get('/api/provider/status?provider=ollama')
        assert resp.get_json()['context_length'] is None
        mock_ctx.assert_not_called()


# --- POST /chat_stream (query-outcome annotations) ---

class TestChatStreamOutcomeFeedback:
    def _seed_history(self, client, preview, total, content='Ran the query.'):
        with client.session_transaction() as sess:
            sess['chat_history'] = [
                {'role': 'user', 'content': 'find zebras', 'id': '1'},
                {
                    'role': 'assistant', 'content': content, 'id': '2',
                    'sql_query': "SELECT * FROM users WHERE name = 'Zebra'",
                    'query_results_preview': preview,
                    'total_results': total,
                    'results_truncated': False,
                },
            ]

    @patch('yoursqlfriend.app.stream_llm_response', return_value=iter([]))
    @patch('yoursqlfriend.app.resolve_provider_model', return_value=None)
    @patch('yoursqlfriend.app.check_llm_available', return_value=True)
    def test_zero_row_outcome_reaches_llm(self, mock_health, mock_resolve, mock_stream,
                                          client, temp_db):
        """The model must see that its previous query returned nothing."""
        _load_db(client, temp_db)
        self._seed_history(client, preview=[], total=0)
        client.post('/chat_stream', json={'message': 'why no results?'}).get_data()
        messages_sent = mock_stream.call_args[0][0]
        assistant_msgs = [m for m in messages_sent if m['role'] == 'assistant']
        assert '[Query outcome: 0 rows returned]' in assistant_msgs[0]['content']
        # Stored session history must NOT be mutated — annotations are per-request
        with client.session_transaction() as sess:
            stored = sess['chat_history']
        assert stored[1]['content'] == 'Ran the query.'

    @patch('yoursqlfriend.app.stream_llm_response', return_value=iter([]))
    @patch('yoursqlfriend.app.resolve_provider_model', return_value=None)
    @patch('yoursqlfriend.app.check_llm_available', return_value=True)
    def test_result_preview_reaches_llm(self, mock_health, mock_resolve, mock_stream,
                                        client, temp_db):
        _load_db(client, temp_db)
        self._seed_history(client, preview=[{'id': 1, 'name': 'Alice'}], total=1)
        client.post('/chat_stream', json={'message': 'now filter by email'}).get_data()
        messages_sent = mock_stream.call_args[0][0]
        assistant_msgs = [m for m in messages_sent if m['role'] == 'assistant']
        assert '[Query outcome: 1 rows returned]' in assistant_msgs[0]['content']
        assert '<<UNTRUSTED_DATA' in assistant_msgs[0]['content']
        assert 'name=Alice' in assistant_msgs[0]['content']
