"""Database operations: connections, queries, file hashing, format conversion."""

import sqlite3
import os
import hashlib
import re
import logging

import pandas as pd

logger = logging.getLogger(__name__)

FORBIDDEN_SQL_FILE_KEYWORDS = [
    "DROP DATABASE", "DROP SCHEMA", "TRUNCATE DATABASE",
    "ATTACH", "LOAD_EXTENSION",
]
MAX_UPLOAD_SIZE_BYTES = 1024 * 1024 * 1024
MAX_RESULT_ROWS = 2000


def get_readonly_connection(db_filepath):
    """Open a read-only SQLite connection with query_only pragma.

    Use as a context manager: with get_readonly_connection(path) as conn:
    """
    conn = sqlite3.connect(f"file:{db_filepath}?mode=ro", uri=True)
    conn.execute("PRAGMA query_only = ON")
    return conn


def execute_and_parse_query(db_filepath, sql_query):
    """Execute a read-only SQL query and return results as list of dicts.

    Strips trailing semicolons, opens a readonly connection, fetches up to
    MAX_RESULT_ROWS rows. Returns list of dicts.
    """
    cleaned = sql_query.rstrip(';').strip()
    with get_readonly_connection(db_filepath) as conn:
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        cursor.execute(cleaned)
        results = cursor.fetchmany(MAX_RESULT_ROWS + 1)
        return [dict(row) for row in results[:MAX_RESULT_ROWS]]


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


def validate_upload_file(file, max_size_bytes=MAX_UPLOAD_SIZE_BYTES):
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
        with sqlite3.connect(db_filepath) as conn:
            table_name = 'csv_data'  # Default table name
            df.to_sql(table_name, conn, if_exists='replace', index=False)

            # Extract schema
            cursor = conn.cursor()
            cursor.execute(f'PRAGMA table_info("{table_name}");')
            columns = cursor.fetchall()
            schema = {table_name: [column[1] for column in columns]}
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
        with open(sql_filepath, 'r', encoding='utf-8') as f:
            sql_content = f.read()

        # Security check: block destructive and dangerous operations
        sql_upper = sql_content.upper()
        for keyword in FORBIDDEN_SQL_FILE_KEYWORDS:
            if keyword in sql_upper:
                raise ValueError(f"SQL file contains forbidden keyword: {keyword}")
        # Block trigger creation (triggers can execute arbitrary SQL on read)
        if re.search(r'\bCREATE\s+TRIGGER\b', sql_upper):
            raise ValueError("SQL file contains forbidden keyword: CREATE TRIGGER")

        # Execute SQL file
        with sqlite3.connect(db_filepath) as conn:
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
        logger.info(f"SQL file executed: {len(schema)} tables created")

        return schema

    except Exception as e:
        logger.error(f"SQL file execution failed: {str(e)}")
        raise
