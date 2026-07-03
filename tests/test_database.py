"""Direct tests for database.py: read-only guarantees, query execution,
file hashing, upload validation, and the .sql/.csv import paths."""

import gc
import hashlib
import io
import os
import sqlite3
import tempfile

import pytest
from werkzeug.datastructures import FileStorage

from yoursqlfriend.database import (
    get_readonly_connection, execute_and_parse_query, calculate_file_hash,
    validate_upload_file, convert_csv_to_sqlite, execute_sql_file,
    MAX_RESULT_ROWS,
)


@pytest.fixture
def temp_db():
    """Temporary SQLite DB with a small table."""
    fd, path = tempfile.mkstemp(suffix='.db')
    os.close(fd)
    conn = sqlite3.connect(path)
    conn.execute('CREATE TABLE items (id INTEGER PRIMARY KEY, label TEXT)')
    conn.execute("INSERT INTO items VALUES (1, 'alpha')")
    conn.execute("INSERT INTO items VALUES (2, 'beta')")
    conn.commit()
    conn.close()  # explicit close — required for os.unlink on Windows
    yield path
    gc.collect()  # release lingering read-only handles on Windows
    os.unlink(path)


@pytest.fixture
def temp_path():
    """A temp file path that is cleaned up afterwards (file may not exist)."""
    fd, path = tempfile.mkstemp()
    os.close(fd)
    yield path
    gc.collect()
    if os.path.exists(path):
        os.unlink(path)


# --- get_readonly_connection ---

class TestReadonlyConnection:
    def test_select_works(self, temp_db):
        conn = get_readonly_connection(temp_db)
        try:
            rows = conn.execute('SELECT * FROM items').fetchall()
            assert len(rows) == 2
        finally:
            conn.close()

    def test_write_rejected(self, temp_db):
        """mode=ro + PRAGMA query_only must block all writes."""
        conn = get_readonly_connection(temp_db)
        try:
            with pytest.raises(sqlite3.OperationalError):
                conn.execute("INSERT INTO items VALUES (3, 'gamma')")
            with pytest.raises(sqlite3.OperationalError):
                conn.execute("UPDATE items SET label = 'x'")
            with pytest.raises(sqlite3.OperationalError):
                conn.execute("DROP TABLE items")
        finally:
            conn.close()


# --- execute_and_parse_query ---

class TestExecuteAndParseQuery:
    def test_returns_list_of_dicts(self, temp_db):
        results = execute_and_parse_query(temp_db, 'SELECT * FROM items ORDER BY id')
        assert results == [
            {'id': 1, 'label': 'alpha'},
            {'id': 2, 'label': 'beta'},
        ]

    def test_trailing_semicolon_stripped(self, temp_db):
        results = execute_and_parse_query(temp_db, 'SELECT COUNT(*) AS n FROM items;')
        assert results[0]['n'] == 2

    def test_result_row_cap(self, temp_db):
        """Results are capped at MAX_RESULT_ROWS even for larger tables."""
        conn = sqlite3.connect(temp_db)
        conn.executemany('INSERT INTO items (label) VALUES (?)',
                         [(f'row{i}',) for i in range(MAX_RESULT_ROWS + 50)])
        conn.commit()
        conn.close()
        results = execute_and_parse_query(temp_db, 'SELECT * FROM items')
        assert len(results) == MAX_RESULT_ROWS


# --- calculate_file_hash ---

class TestFileHash:
    def test_sha256_of_known_content(self, temp_path):
        with open(temp_path, 'wb') as f:
            f.write(b'forensic evidence')
        expected = hashlib.sha256(b'forensic evidence').hexdigest()
        assert calculate_file_hash(temp_path) == expected

    def test_hash_changes_with_content(self, temp_path):
        with open(temp_path, 'wb') as f:
            f.write(b'aaa')
        h1 = calculate_file_hash(temp_path)
        with open(temp_path, 'wb') as f:
            f.write(b'bbb')
        assert calculate_file_hash(temp_path) != h1


# --- validate_upload_file ---

def _storage(filename, content=b'data'):
    return FileStorage(stream=io.BytesIO(content), filename=filename)


class TestValidateUploadFile:
    def test_allowed_extension(self):
        ok, err, ext = validate_upload_file(_storage('evidence.db'))
        assert ok is True and err is None and ext == '.db'

    def test_rejected_extension(self):
        ok, err, ext = validate_upload_file(_storage('malware.exe'))
        assert ok is False and 'Invalid file type' in err

    def test_empty_file_rejected(self):
        ok, err, ext = validate_upload_file(_storage('empty.db', b''))
        assert ok is False and 'empty' in err.lower()

    def test_oversize_rejected(self):
        ok, err, ext = validate_upload_file(_storage('big.db', b'x' * 100), max_size_bytes=50)
        assert ok is False and 'too large' in err.lower()


# --- convert_csv_to_sqlite ---

class TestConvertCsv:
    def test_basic_conversion(self, temp_path):
        csv_path = temp_path + '.csv'
        db_path = temp_path + '.converted.db'
        try:
            with open(csv_path, 'w', encoding='utf-8') as f:
                f.write('id,full name,city\n1,Alice A,Paris\n2,Bob B,Lyon\n')
            schema = convert_csv_to_sqlite(csv_path, db_path)
            # Column names sanitized (space -> underscore)
            assert schema == {'csv_data': ['id', 'full_name', 'city']}
            rows = execute_and_parse_query(db_path, 'SELECT * FROM csv_data ORDER BY id')
            assert len(rows) == 2 and rows[0]['full_name'] == 'Alice A'
        finally:
            gc.collect()
            for p in (csv_path, db_path):
                if os.path.exists(p):
                    os.unlink(p)


# --- execute_sql_file (security-relevant import gate) ---

class TestExecuteSqlFile:
    def _run(self, sql_content, temp_path):
        sql_path = temp_path + '.sql'
        db_path = temp_path + '.created.db'
        with open(sql_path, 'w', encoding='utf-8') as f:
            f.write(sql_content)
        try:
            return execute_sql_file(sql_path, db_path)
        finally:
            gc.collect()
            for p in (sql_path, db_path):
                if os.path.exists(p):
                    os.unlink(p)

    def test_create_and_insert_allowed(self, temp_path):
        schema = self._run(
            'CREATE TABLE logs (id INTEGER, msg TEXT);\n'
            "INSERT INTO logs VALUES (1, 'hello');\n",
            temp_path,
        )
        assert schema == {'logs': ['id', 'msg']}

    def test_attach_rejected(self, temp_path):
        with pytest.raises(ValueError, match='forbidden'):
            self._run("ATTACH DATABASE '/tmp/other.db' AS other;", temp_path)

    def test_load_extension_rejected(self, temp_path):
        with pytest.raises(ValueError, match='forbidden'):
            self._run("SELECT load_extension('evil.so');", temp_path)

    def test_create_trigger_rejected(self, temp_path):
        with pytest.raises(ValueError, match='forbidden'):
            self._run(
                'CREATE TABLE t (id INT);\n'
                'CREATE TRIGGER tr AFTER INSERT ON t BEGIN SELECT 1; END;',
                temp_path,
            )

    def test_create_trigger_rejected_case_insensitive(self, temp_path):
        with pytest.raises(ValueError, match='forbidden'):
            self._run('create   trigger tr AFTER INSERT ON t BEGIN SELECT 1; END;', temp_path)
