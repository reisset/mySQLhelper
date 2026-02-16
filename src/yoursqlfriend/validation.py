"""SQL validation — the security boundary between user input and database execution."""

import re

FORBIDDEN_QUERY_KEYWORDS = [
    "DROP", "DELETE", "INSERT", "UPDATE", "ALTER",
    "TRUNCATE", "EXEC", "GRANT", "REVOKE", "CREATE",
    "ATTACH", "DETACH", "REPLACE", "VACUUM",
    "SAVEPOINT", "RELEASE", "REINDEX"
]


def strip_strings_and_comments(sql):
    """
    Remove string literals and comments from SQL for security analysis.
    This prevents false positives from content inside strings/comments.
    """
    result = []
    i = 0
    in_single_quote = False
    in_double_quote = False

    while i < len(sql):
        # Handle single-line comments (-- style)
        if not in_single_quote and not in_double_quote and sql[i:i+2] == '--':
            # Skip to end of line
            while i < len(sql) and sql[i] != '\n':
                i += 1
            continue

        # Handle multi-line comments (/* */ style)
        if not in_single_quote and not in_double_quote and sql[i:i+2] == '/*':
            i += 2
            closed = False
            while i < len(sql) - 1:
                if sql[i:i+2] == '*/':
                    i += 2
                    closed = True
                    break
                i += 1
            if not closed:
                # Unclosed block comment — strip remainder as comment
                break
            continue

        # Handle single quotes (with escape handling)
        if sql[i] == "'" and not in_double_quote:
            if in_single_quote:
                # Check for escaped quote ('')
                if i + 1 < len(sql) and sql[i+1] == "'":
                    i += 2
                    continue
                in_single_quote = False
            else:
                in_single_quote = True
            i += 1
            continue

        # Handle double quotes
        if sql[i] == '"' and not in_single_quote:
            if in_double_quote:
                if i + 1 < len(sql) and sql[i+1] == '"':
                    i += 2
                    continue
                in_double_quote = False
            else:
                in_double_quote = True
            i += 1
            continue

        # Only include characters outside of strings
        if not in_single_quote and not in_double_quote:
            result.append(sql[i])

        i += 1

    return ''.join(result)


def validate_sql(sql):
    """
    Validates that SQL queries are read-only and safe for forensic analysis.

    Allowed: SELECT, WITH (CTEs), EXPLAIN, read-only PRAGMAs
    Blocked: Any data modification commands
    """
    sql_stripped = sql.strip()

    # Skip leading SQL comments (-- style) to find the actual query start
    lines = sql_stripped.split('\n')
    first_code_line = ''
    for line in lines:
        stripped_line = line.strip()
        if stripped_line and not stripped_line.startswith('--'):
            first_code_line = stripped_line
            break

    sql_upper = sql_stripped.upper()
    first_code_upper = first_code_line.upper()

    # Rule 1: Allow read-only query patterns
    allowed_starts = ["SELECT", "WITH", "EXPLAIN", "PRAGMA"]
    if not any(first_code_upper.startswith(start) for start in allowed_starts):
        return False, f"Query must start with: {', '.join(allowed_starts)}"

    # Rule 2: No multiple statements
    # Strip strings and comments first to avoid false positives
    sql_for_analysis = strip_strings_and_comments(sql)
    sql_trimmed = sql_for_analysis.rstrip().rstrip(';').rstrip()
    if ';' in sql_trimmed:
        return False, "Security Warning: Multiple SQL statements are not allowed."

    # Rule 3: Strict blocklist of modification keywords
    # Check against stripped SQL (sql_for_analysis) to avoid false positives
    # from keywords inside string literals or comments
    sql_for_analysis_upper = sql_for_analysis.upper()
    for keyword in FORBIDDEN_QUERY_KEYWORDS:
        if re.search(r'\b' + keyword + r'\b', sql_for_analysis_upper):
            return False, f"Security Warning: Query contains forbidden keyword '{keyword}'."

    # Rule 4: Validate CTEs contain SELECT
    if sql_upper.startswith("WITH"):
        if "SELECT" not in sql_upper:
            return False, "CTE (WITH clause) must contain a SELECT statement."

    # Rule 5: PRAGMA safety check - block write-capable PRAGMAs
    if sql_upper.startswith("PRAGMA"):
        write_pragmas = [
            "PRAGMA JOURNAL_MODE", "PRAGMA LOCKING_MODE", "PRAGMA WRITABLE_SCHEMA",
            "PRAGMA AUTO_VACUUM", "PRAGMA INCREMENTAL_VACUUM"
        ]
        for write_pragma in write_pragmas:
            if write_pragma in sql_upper:
                return False, f"Security Warning: {write_pragma} is not allowed (can modify database)."

    return True, None
