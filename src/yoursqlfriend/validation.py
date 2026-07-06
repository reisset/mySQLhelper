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
    # Strip strings and comments once; all rules run against this analysis
    # text. Deriving the statement start from it too means leading comments
    # of either style (`-- note` or `/* note */`) can't reject a valid query.
    sql_for_analysis = strip_strings_and_comments(sql)
    sql_for_analysis_upper = sql_for_analysis.upper()
    first_code_upper = sql_for_analysis_upper.strip()

    # Rule 1: Allow read-only query patterns
    allowed_starts = ["SELECT", "WITH", "EXPLAIN", "PRAGMA"]
    if not any(first_code_upper.startswith(start) for start in allowed_starts):
        return False, f"Query must start with: {', '.join(allowed_starts)}"

    # Rule 2: No multiple statements
    sql_trimmed = sql_for_analysis.rstrip().rstrip(';').rstrip()
    if ';' in sql_trimmed:
        return False, "Security Warning: Multiple SQL statements are not allowed."

    # Rule 3: Strict blocklist of modification keywords (string/comment
    # contents already removed, so data values can't false-positive)
    for keyword in FORBIDDEN_QUERY_KEYWORDS:
        if re.search(r'\b' + keyword + r'\b', sql_for_analysis_upper):
            return False, f"Security Warning: Query contains forbidden keyword '{keyword}'."

    # Rule 4: Validate CTEs contain SELECT
    if first_code_upper.startswith("WITH"):
        if "SELECT" not in sql_for_analysis_upper:
            return False, "CTE (WITH clause) must contain a SELECT statement."

    # Rule 5: PRAGMA safety check - block write-capable PRAGMAs
    if first_code_upper.startswith("PRAGMA"):
        write_pragmas = [
            "PRAGMA JOURNAL_MODE", "PRAGMA LOCKING_MODE", "PRAGMA WRITABLE_SCHEMA",
            "PRAGMA AUTO_VACUUM", "PRAGMA INCREMENTAL_VACUUM"
        ]
        for write_pragma in write_pragmas:
            if write_pragma in sql_for_analysis_upper:
                return False, f"Security Warning: {write_pragma} is not allowed (can modify database)."

    return True, None
