# Forensics & Security Enhancement Implementation Plan

## Overview
Transform mySQLhelper from a demo tool into a court-admissible forensic analysis platform with comprehensive security hardening, evidence integrity tracking, and professional audit logging.

## User Requirements
Based on `forensics_todo.md` with enhanced tweaks:
1. ✅ Add server-side file upload validation (extension, size, integrity)
2. ✅ Implement SHA256 hashing for evidence chain of custody
3. ✅ Add structured audit logging with daily rotation
4. ✅ Enhance export with forensic metadata (hash, timestamps, analyst info)
5. ✅ Improve error handling and user feedback
6. ✅ Add support for .sql and .csv files (in addition to SQLite)
7. ✅ Consolidate imports and clean up code organization
8. ✅ Update README with logging documentation

---

## Implementation Phases

### PHASE 1: Imports & Logging Infrastructure
**Goal:** Set up proper logging foundation before implementing features

#### File: `/home/king/Projects/WebApp/mysqlhelper/app.py`

**1.1 Consolidate Imports (Lines 1-8)**
Replace existing imports with organized version:

```python
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
```

**Why:** Adds `hashlib` (hashing), `logging` (audit), `csv`/`pandas` (CSV support), `datetime` (timestamps)

---

**1.2 Configure Logging (After line 21, before `Session(app)`)**

```python
# Ensure logs directory exists
if not os.path.exists('logs'):
    os.makedirs('logs')

# Configure structured logging with daily rotation
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler(f'logs/analysis_{datetime.now().strftime("%Y%m%d")}.log'),  # Daily rotation
        logging.StreamHandler()  # Console output
    ]
)
logger = logging.getLogger(__name__)

# Log application startup
logger.info("=" * 60)
logger.info("mySQLhelper Forensic Analysis Tool Started")
logger.info(f"Upload directory: {os.path.abspath(UPLOAD_FOLDER)}")
logger.info("=" * 60)
```

**Key Tweak:** Uses `%Y%m%d` for daily rotation instead of `%Y%m%d_%H%M%S` to prevent log file proliferation

---

### PHASE 2: Helper Functions for Validation & Hashing
**Goal:** Create reusable utilities before modifying routes

#### File: `/home/king/Projects/WebApp/mysqlhelper/app.py`

**2.1 Add File Hash Function (After line 29, before `validate_sql()`)**

```python
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
```

---

**2.2 Add File Validation Function (After hash function)**

```python
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
```

---

**2.3 Add CSV to SQLite Converter (After validation function)**

```python
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
```

---

**2.4 Add SQL File Executor (After CSV converter)**

```python
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
```

---

**2.5 Add LM Studio Health Check (After SQL executor)**

```python
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
```

---

### PHASE 3: Enhanced Upload Route with Multi-Format Support
**Goal:** Replace upload_file() with comprehensive validation, hashing, and multi-format handling

#### File: `/home/king/Projects/WebApp/mysqlhelper/app.py`

**3.1 Replace upload_file() Function (Lines 55-84)**

**Complete Replacement Code:**

```python
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
```

**Key Features:**
- Multi-format support (SQLite, CSV, SQL)
- SHA256 hashing for evidence integrity
- Session metadata tracking (hash, timestamp, original filename)
- Comprehensive logging
- Temp file handling with cleanup
- SQLite integrity check via `PRAGMA integrity_check`

---

### PHASE 4: Enhanced Chat Streaming with LLM Health Check
**Goal:** Add LLM availability check and improve logging

#### File: `/home/king/Projects/WebApp/mysqlhelper/app.py`

**4.1 Add LLM Health Check (Lines 86-88, in chat_stream())**

Replace print statements with logger and add health check before processing.

**4.2 Update Logging Statements**
- Replace all `print()` calls with `logger.debug()` or `logger.info()`

---

### PHASE 5: Enhanced SQL Execution with Audit Logging
**Goal:** Add comprehensive logging to SQL execution

#### File: `/home/king/Projects/WebApp/mysqlhelper/app.py`

**5.1 Update execute_sql() Route (Lines 220-269)**

Add logging after validation, execution, and errors.

---

### PHASE 6: Enhanced Export with Forensic Metadata
**Goal:** Add comprehensive metadata section to exported HTML

#### File: `/home/king/Projects/WebApp/mysqlhelper/app.py`

**6.1 Update export_chat() Function (Lines 323-348)**

Complete replacement with forensic metadata table including:
- SHA256 hash
- Upload/export timestamps
- Analyst information
- System hostname
- Chain of custody notice
- Timestamped filename

---

### PHASE 7: Global Error Handlers
**Goal:** Add professional error handling

#### File: `/home/king/Projects/WebApp/mysqlhelper/app.py`

**7.1 Add Error Handlers (Before `if __name__ == '__main__':` at line 350)**

Add 404, 500, and generic exception handlers with logging.

---

### PHASE 8: Frontend Enhancements
**Goal:** Add client-side validation and better error messages

#### File: `/home/king/Projects/WebApp/mysqlhelper/static/script.js`

**8.1 Add File Size Validation (Lines 410-422, in uploadFile())**
- Check for >1GB files (reject)
- Warn for >100MB files (confirm)

**8.2 Improve Error Messages**
- Upload errors with detailed feedback
- Chat errors with LM Studio troubleshooting guide

---

### PHASE 9: Documentation Updates
**Goal:** Update README and create CHANGELOG entry

#### File: `/home/king/Projects/WebApp/mysqlhelper/README.md`

**9.1 Add Logging Documentation**
Add bullet to "Forensic Analyst Notes" section about audit logging.

**9.2 Update Version Badge**
Change version from 1.3 to 1.4

#### File: `/home/king/Projects/WebApp/mysqlhelper/CHANGELOG.txt`

**9.3 Add v1.4 Entry**
Comprehensive changelog entry listing all new features.

---

### PHASE 10: Testing & Validation
**Goal:** Ensure all features work correctly

#### Testing Checklist:

**Security Tests**
- [ ] Upload .txt file renamed to .db → Should reject
- [ ] Upload 2GB file → Should reject
- [ ] Upload empty file → Should reject
- [ ] Upload malformed SQLite → Should reject after integrity check

**Multi-Format Tests**
- [ ] Upload .db file → Schema loads, hash logged
- [ ] Upload .csv file → Converts to SQLite, "csv_data" table
- [ ] Upload .sql file → Executes, tables created
- [ ] Upload .sql with DROP DATABASE → Should reject

**Forensics Tests**
- [ ] Check logs/ directory created
- [ ] Verify upload logged with SHA256 and size
- [ ] Run query, verify in audit log
- [ ] Export chat, verify metadata section

**Error Handling Tests**
- [ ] Stop LM Studio → Send message → Troubleshooting guide shown
- [ ] Visit /invalid → 404 JSON error

**UX Tests**
- [ ] Upload 500MB → Confirmation dialog
- [ ] Export → Timestamped filename

---

## Critical Files Summary

| File | Purpose |
|------|---------|
| `app.py` | All backend changes (imports, helpers, routes, error handlers) |
| `script.js` | Frontend validation and error messages |
| `README.md` | Logging documentation, version update |
| `CHANGELOG.txt` | v1.4 entry |

---

## Dependencies Check

**Required packages:**
- ✅ Flask, Flask-Session, requests, werkzeug - Already present
- ⚠️ pandas - **Check if present**, if not: `pip install pandas`

**Standard library (no install):**
- hashlib, logging, csv, datetime, re, json, os, sqlite3

---

## Implementation Order

1. Phase 1 - Imports & Logging (foundation)
2. Phase 2 - Helper Functions (reusable utilities)
3. Phase 3 - Enhanced Upload (core feature)
4. Phase 4 - Chat Streaming (LLM check)
5. Phase 5 - SQL Execution (audit logging)
6. Phase 6 - Enhanced Export (forensic metadata)
7. Phase 7 - Error Handlers (safety nets)
8. Phase 8 - Frontend (UX polish)
9. Phase 9 - Documentation (README, CHANGELOG)
10. Phase 10 - Testing (validation)

**Estimated Time:** 2-3 hours for careful implementation + testing

---

## Rollback Plan

**Critical: Backup before starting:**
```bash
git add -A
git commit -m "Backup before forensics enhancements (v1.3)"
git tag v1.3-backup
```

---

## Post-Implementation

1. Run full testing checklist
2. Review generated log files
3. Test export HTML rendering
4. Update version to 1.4
5. Create git commit with changelog
6. Consider creating forensics user guide

---

**Plan Status:** Ready to implement with step-by-step phases, complete code snippets, and comprehensive testing.
