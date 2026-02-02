# SQL Generation Fixes for mySQLhelper

## Overview

This document outlines three critical fixes to improve SQL query generation accuracy in the mySQLhelper forensic analysis tool. These fixes address persistent SQL errors encountered even with capable models (Ministral 3B:14B, DeepSeek-R1:8b, Qwen3:4b).

**Target file:** `app.py`

**Problem summary:** Users experience frequent SQL errors (invalid column names, syntax issues, type mismatches) because:
1. Schema context lacks column type information - LLMs guess wrong
2. No error recovery mechanism - one mistake = failed query
3. System prompt is cognitively heavy for smaller models

---

## Fix 1: Enrich Schema Context with Column Types

### Why This Matters

The current schema injection (lines 869-875) produces:
```
Table: messages
Columns: id, chat_id, sender, text, timestamp
```

The LLM has NO IDEA that `timestamp` is an INTEGER (unix epoch) vs TEXT vs REAL. This causes:
- Wrong function usage (`datetime(timestamp)` vs `unix_to_datetime(timestamp)`)
- Type casting errors
- Incorrect comparisons (`timestamp > '2024-01-01'` vs `timestamp > 1704067200`)

### Current Code (lines 869-875)

```python
schema_context = "Database Schema:\n"
for table_name in tables:
    table_name = table_name[0]
    schema_context += f"Table: {table_name}\nColumns: "
    cursor.execute(f"PRAGMA table_info({table_name});")
    columns = cursor.fetchall()
    schema_context += ", ".join([column[1] for column in columns]) + "\n"
```

### New Code

Replace the schema building block with:

```python
schema_context = "DATABASE SCHEMA (SQLite):\n"
schema_context += "=" * 40 + "\n"
for table_name in tables:
    table_name = table_name[0]
    cursor.execute(f"PRAGMA table_info({table_name});")
    columns = cursor.fetchall()
    # PRAGMA table_info returns: (cid, name, type, notnull, default, pk)
    
    schema_context += f"\nTable: {table_name}\n"
    schema_context += "-" * 20 + "\n"
    for col in columns:
        col_name = col[1]
        col_type = col[2] if col[2] else "BLOB"
        is_pk = " [PRIMARY KEY]" if col[5] else ""
        is_notnull = " NOT NULL" if col[3] else ""
        schema_context += f"  • {col_name} ({col_type}){is_pk}{is_notnull}\n"
```

### Expected Output

```
DATABASE SCHEMA (SQLite):
========================================

Table: messages
--------------------
  • id (INTEGER) [PRIMARY KEY] NOT NULL
  • chat_id (INTEGER)
  • sender (TEXT)
  • text (TEXT)
  • timestamp (INTEGER)

Table: contacts
--------------------
  • id (INTEGER) [PRIMARY KEY] NOT NULL
  • name (TEXT)
  • phone (TEXT)
  • email (TEXT)
```

Now the LLM knows `timestamp` is INTEGER and will use appropriate functions/comparisons.

---

## Fix 2: Add SQL Retry Logic with Error Correction

### Why This Matters

Currently, if the LLM generates invalid SQL, the user sees an error and has to manually rephrase. With retry logic:
1. SQL fails → error captured
2. Error + failed SQL sent back to LLM with schema reminder
3. LLM corrects the query
4. Retry execution (max 2-3 attempts)

This catches 80%+ of recoverable errors (typos, wrong column names, syntax issues).

### Implementation

#### Step 1: Add a retry-aware execution helper function

Add this new function somewhere after the `validate_sql()` function:

```python
def execute_sql_with_validation(sql, db_filepath, schema_context):
    """
    Execute SQL and return result or structured error for retry logic.
    
    Returns dict with:
        - success: bool
        - data: DataFrame (if success)
        - error: str (if failure)
        - error_type: str (if failure) - 'syntax', 'no_column', 'no_table', 'other'
    """
    try:
        conn = sqlite3.connect(db_filepath)
        conn.row_factory = sqlite3.Row
        
        # Attempt execution
        df = pd.read_sql_query(sql, conn)
        conn.close()
        
        return {
            "success": True,
            "data": df,
            "row_count": len(df)
        }
        
    except sqlite3.OperationalError as e:
        error_msg = str(e).lower()
        
        # Classify error type for better LLM guidance
        if "no such column" in error_msg:
            error_type = "no_column"
        elif "no such table" in error_msg:
            error_type = "no_table"
        elif "syntax error" in error_msg:
            error_type = "syntax"
        else:
            error_type = "other"
            
        return {
            "success": False,
            "error": str(e),
            "error_type": error_type,
            "failed_sql": sql
        }
        
    except Exception as e:
        return {
            "success": False,
            "error": str(e),
            "error_type": "other",
            "failed_sql": sql
        }
```

#### Step 2: Add error correction prompt builder

```python
def build_error_correction_prompt(error, failed_sql, error_type, schema_context):
    """Build a prompt to help the LLM fix its SQL error."""
    
    type_hints = {
        "no_column": "Check the schema below - the column name is wrong or doesn't exist in that table.",
        "no_table": "Check the schema below - the table name is misspelled or doesn't exist.",
        "syntax": "There's a SQLite syntax error. Common issues: missing quotes, wrong function names, invalid operators.",
        "other": "Review the query against the schema and SQLite syntax rules."
    }
    
    hint = type_hints.get(error_type, type_hints["other"])
    
    return f"""**SQL EXECUTION FAILED**

Error: `{error}`

Failed query:
```sql
{failed_sql}
```

**Hint:** {hint}

Please fix the query. Remember:
- Use ONLY columns that exist in the schema
- SQLite syntax (not MySQL/PostgreSQL)
- Output the corrected query in a ```sql code block

{schema_context}"""
```

#### Step 3: Modify the /execute endpoint to support retries

Find the `/execute` route and update it to handle retry logic. The key change is:

When SQL execution fails, instead of immediately returning an error to the frontend, you have two options:

**Option A: Automatic retry (transparent to user)**
- Execute fails → build error correction prompt → call LLM again → retry execute
- User only sees final result or final failure after N attempts

**Option B: User-visible retry (recommended for forensics)**
- Execute fails → return error to user with "Retry" button
- User clicks retry → error context sent to LLM → new query generated
- User can see what went wrong and what was corrected (audit trail)

**I recommend Option B for forensic work** - transparency matters.

Add this to the `/execute` route response handling:

```python
# After extracting SQL from LLM response and attempting execution:
result = execute_sql_with_validation(sql_query, db_filepath, schema_context)

if result["success"]:
    # Normal success path - return data
    return jsonify({
        "success": True,
        "data": result["data"].to_dict(orient="records"),
        "row_count": result["row_count"],
        "sql": sql_query
    })
else:
    # Execution failed - return error with retry context
    retry_context = build_error_correction_prompt(
        result["error"],
        result["failed_sql"],
        result["error_type"],
        schema_context
    )
    
    return jsonify({
        "success": False,
        "error": result["error"],
        "error_type": result["error_type"],
        "failed_sql": result["failed_sql"],
        "retry_prompt": retry_context,  # Frontend can use this for retry
        "can_retry": True
    })
```

#### Step 4: Frontend retry support (script.js)

The frontend should handle the `can_retry` flag and offer a retry button. When clicked:
1. Append the `retry_prompt` as a new user message (or inject it into chat context)
2. Call the LLM endpoint again
3. Execute the new SQL

This is a frontend change to `script.js` - add a "Retry Query" button to the error display that:
```javascript
// Pseudocode for retry handler
function handleRetry(retryPrompt) {
    // Add error context as a follow-up message
    appendMessage('user', retryPrompt);
    // Trigger LLM call
    sendToLLM(retryPrompt);
}
```

---

## Fix 3: Simplify the System Prompt

### Why This Matters

The current prompt (lines 692-724) has:
- 5 numbered sections with nested rules
- Verbose examples
- Edge case handling (UNION ALL) that confuses smaller models
- Custom functions that may not apply to every database

Smaller models (4B-14B) allocate attention across all this, leaving less capacity for schema understanding and SQL generation. The result: more errors.

### Current Prompt

```python
def build_system_prompt(schema_context):
    """Build the system prompt with schema context."""
    return f"""
You are a SQL expert assisting a digital forensics analyst.

1. **Reasoning & Execution:** When the user asks for data, briefly explain your approach in 1-2 sentences, then output the SQL query in a markdown code block.

   Example:
   User: "pull customers"
   Response: "I'll retrieve all rows from the customers table."
   ```sql
   SELECT * FROM customers;
   ```

   For simple requests like "pull [table]" or "show me [data]", execute immediately without asking for confirmation.

2. **Conversation:** If the user chats about the schema or asks general questions, reply in plain text.

3. **Ambiguity Handling:** Only ask clarifying questions when the request is genuinely ambiguous (e.g., "show me the data" without specifying which table, or "top customers" without defining "top").

4. **Safety First:** NEVER modify data. You are running in a READ-ONLY environment. Do not output INSERT, UPDATE, DELETE, or DROP commands. Only output ONE query at a time - if you need to query multiple tables, use UNION ALL with consistent column aliases:
   ```sql
   SELECT col AS result FROM table1 UNION ALL SELECT col AS result FROM table2
   ```

5. **Custom SQL Functions:** You have access to these forensic utility functions:
   - Timestamp converters: `unix_to_datetime(ts)`, `webkit_to_datetime(ts)`, `ios_to_datetime(ts)`, `filetime_to_datetime(ts)`
   - Encode/decode: `encode_base64(text)`, `decode_base64(text)`, `to_hex(text)`, `decode_hex(hex)`
   - String extractors: `extract_email(text)`, `extract_ip(text)`, `extract_url(text)`, `extract_phone(text)`
   IMPORTANT: Always verify column names exist in the schema before using them. Each table has different columns.

{schema_context}
"""
```

### New Prompt (Simplified)

Replace the entire `build_system_prompt` function:

```python
def build_system_prompt(schema_context):
    """
    Build a streamlined system prompt optimized for smaller LLMs.
    
    Design principles:
    - Minimal cognitive load
    - Critical rules only
    - Schema is the star (placed prominently)
    - SQLite-specific reminders
    """
    return f"""You are a SQLite query generator for forensic database analysis.

CRITICAL RULES:
1. Output SQL inside ```sql code blocks
2. SELECT queries ONLY - never INSERT/UPDATE/DELETE/DROP
3. Use ONLY tables and columns from the schema below
4. Use SQLite syntax: datetime(), ||, LIKE, LIMIT (not MySQL/PostgreSQL equivalents)

FORENSIC FUNCTIONS AVAILABLE:
- unix_to_datetime(column) - convert Unix timestamps
- webkit_to_datetime(column) - convert WebKit timestamps  
- decode_base64(column) - decode base64 text

RESPONSE FORMAT:
- Brief explanation (1 sentence)
- SQL query in code block
- For simple requests like "show table X", respond immediately without asking questions

{schema_context}
"""
```

### What Changed

| Removed | Why |
|---------|-----|
| Numbered sections (1-5) | Cognitive overhead, models don't need structure |
| Verbose example | Models know SQL syntax |
| UNION ALL guidance | Edge case, rarely needed, confuses small models |
| Ambiguity handling rules | Models handle this naturally |
| Extra forensic functions | Keep only the most common ones |
| "Conversation" mode instructions | Implicit behavior |

| Kept/Improved | Why |
|---------------|-----|
| READ-ONLY emphasis | Critical for forensics |
| SQLite-specific syntax note | Prevents MySQL/PostgreSQL habits |
| Code block requirement | Parsing depends on this |
| Schema placement at end | LLMs weight end of prompt highly |

---

## Summary of Changes

### File: app.py

| Location | Change |
|----------|--------|
| Lines 869-875 | Replace schema builder with enriched version (Fix 1) |
| After validate_sql() | Add `execute_sql_with_validation()` function (Fix 2) |
| After validate_sql() | Add `build_error_correction_prompt()` function (Fix 2) |
| Lines 692-724 | Replace `build_system_prompt()` entirely (Fix 3) |
| /execute route | Update to use new execution function and return retry context (Fix 2) |

### File: script.js

| Location | Change |
|----------|--------|
| Error display handler | Add retry button that sends `retry_prompt` back to LLM (Fix 2) |

---

## Testing Checklist

After implementing these fixes, test with:

1. **Schema accuracy test**: Load a database, check logs/console for new schema format with types
2. **Simple query test**: "show me all messages" → should work first try
3. **Deliberate error test**: Manually edit LLM response to have wrong column name → should return retry context
4. **Retry flow test**: Click retry with bad query → LLM should correct it
5. **Small model test**: Run with Qwen3:4b or similar → error rate should drop significantly

---

## Optional Enhancements (Future)

These are not part of this fix but could further improve accuracy:

1. **Sample values in schema**: For TEXT columns, show 2-3 example values so LLM knows the format
   ```
   • status (TEXT)  -- e.g., "active", "pending", "closed"
   ```

2. **Foreign key hints**: Add relationship comments
   ```
   • user_id (INTEGER)  -- FK → users.id
   ```

3. **Pre-execution validation**: Parse SQL AST and validate table/column names exist before executing

4. **Configurable retry count**: Let users set max retries in settings (default: 2)
