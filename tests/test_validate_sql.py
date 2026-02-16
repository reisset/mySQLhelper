# Tests for validate_sql() and strip_strings_and_comments()
# These functions are the security boundary between user input and database execution.

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app import validate_sql, strip_strings_and_comments


# ==========================================================================
# strip_strings_and_comments()
# ==========================================================================

class TestStripStringsAndComments:
    def test_basic_select(self):
        assert strip_strings_and_comments("SELECT * FROM t") == "SELECT * FROM t"

    def test_single_quoted_string(self):
        result = strip_strings_and_comments("SELECT * FROM t WHERE x = 'DROP TABLE'")
        assert "DROP" not in result
        assert "TABLE" not in result

    def test_double_quoted_identifier(self):
        result = strip_strings_and_comments('SELECT * FROM "DROP TABLE"')
        assert "DROP" not in result

    def test_escaped_single_quote(self):
        result = strip_strings_and_comments("SELECT * FROM t WHERE x = 'it''s a test'")
        assert "it" not in result
        assert "test" not in result

    def test_escaped_double_quote(self):
        result = strip_strings_and_comments('SELECT * FROM t WHERE x = "say ""hello"""')
        assert "hello" not in result

    def test_single_line_comment(self):
        result = strip_strings_and_comments("SELECT * FROM t -- DROP TABLE x")
        assert "DROP" not in result

    def test_multi_line_comment(self):
        result = strip_strings_and_comments("SELECT * FROM t /* DROP TABLE x */ WHERE 1=1")
        assert "DROP" not in result
        assert "WHERE" in result

    def test_unclosed_block_comment(self):
        result = strip_strings_and_comments("SELECT * FROM t /* DROP TABLE x")
        assert "DROP" not in result

    def test_empty_string(self):
        assert strip_strings_and_comments("") == ""

    def test_only_comment(self):
        result = strip_strings_and_comments("-- just a comment")
        assert result.strip() == ""

    def test_string_with_semicolon(self):
        result = strip_strings_and_comments("SELECT * FROM t WHERE x = 'a;b'")
        assert ";" not in result


# ==========================================================================
# validate_sql() — Allowed queries
# ==========================================================================

class TestValidateSqlAllowed:
    def test_simple_select(self):
        valid, _ = validate_sql("SELECT * FROM users")
        assert valid

    def test_select_with_where(self):
        valid, _ = validate_sql("SELECT id, name FROM users WHERE id > 5")
        assert valid

    def test_with_cte(self):
        valid, _ = validate_sql("WITH cte AS (SELECT 1) SELECT * FROM cte")
        assert valid

    def test_explain(self):
        valid, _ = validate_sql("EXPLAIN SELECT * FROM users")
        assert valid

    def test_explain_query_plan(self):
        valid, _ = validate_sql("EXPLAIN QUERY PLAN SELECT * FROM users")
        assert valid

    def test_pragma_table_info(self):
        valid, _ = validate_sql('PRAGMA table_info("users")')
        assert valid

    def test_pragma_table_list(self):
        valid, _ = validate_sql("PRAGMA table_list")
        assert valid

    def test_select_with_trailing_semicolon(self):
        valid, _ = validate_sql("SELECT 1;")
        assert valid

    def test_select_with_leading_comment(self):
        valid, _ = validate_sql("-- Get all users\nSELECT * FROM users")
        assert valid

    def test_select_with_multiple_leading_comments(self):
        valid, _ = validate_sql("-- Comment 1\n-- Comment 2\nSELECT * FROM users")
        assert valid

    def test_select_case_insensitive(self):
        valid, _ = validate_sql("select * from users")
        assert valid

    def test_select_mixed_case(self):
        valid, _ = validate_sql("Select * From users")
        assert valid


# ==========================================================================
# validate_sql() — Forbidden keywords
# ==========================================================================

class TestValidateSqlForbiddenKeywords:
    def test_drop_table(self):
        valid, msg = validate_sql("SELECT 1; DROP TABLE users")
        assert not valid

    def test_delete(self):
        valid, msg = validate_sql("DELETE FROM users")
        assert not valid

    def test_insert(self):
        valid, msg = validate_sql("INSERT INTO users VALUES (1)")
        assert not valid

    def test_update(self):
        valid, msg = validate_sql("UPDATE users SET name = 'x'")
        assert not valid

    def test_alter(self):
        valid, msg = validate_sql("ALTER TABLE users ADD COLUMN age")
        assert not valid

    def test_create(self):
        valid, msg = validate_sql("CREATE TABLE evil (id INT)")
        assert not valid

    def test_attach(self):
        valid, msg = validate_sql("ATTACH DATABASE 'other.db' AS other")
        assert not valid

    def test_detach(self):
        valid, msg = validate_sql("DETACH DATABASE other")
        assert not valid

    def test_truncate(self):
        valid, msg = validate_sql("TRUNCATE TABLE users")
        assert not valid

    def test_grant(self):
        valid, msg = validate_sql("GRANT ALL ON users TO public")
        assert not valid

    def test_revoke(self):
        valid, msg = validate_sql("REVOKE ALL ON users FROM public")
        assert not valid

    def test_replace(self):
        valid, msg = validate_sql("REPLACE INTO users VALUES (1, 'x')")
        assert not valid

    def test_vacuum(self):
        valid, msg = validate_sql("VACUUM")
        assert not valid

    def test_savepoint(self):
        valid, msg = validate_sql("SAVEPOINT sp1")
        assert not valid

    def test_release(self):
        valid, msg = validate_sql("RELEASE sp1")
        assert not valid

    def test_reindex(self):
        valid, msg = validate_sql("REINDEX users")
        assert not valid


# ==========================================================================
# validate_sql() — Keywords inside strings/comments (should PASS)
# ==========================================================================

class TestValidateSqlKeywordsInStrings:
    def test_drop_in_string_literal(self):
        valid, _ = validate_sql("SELECT * FROM logs WHERE message LIKE '%DROP TABLE happened%'")
        assert valid

    def test_delete_in_string_literal(self):
        valid, _ = validate_sql("SELECT * FROM logs WHERE action = 'DELETE'")
        assert valid

    def test_insert_in_string_literal(self):
        valid, _ = validate_sql("SELECT * FROM logs WHERE msg = 'INSERT failed'")
        assert valid

    def test_update_in_string_literal(self):
        valid, _ = validate_sql("SELECT * FROM events WHERE type = 'UPDATE'")
        assert valid

    def test_keyword_in_single_line_comment(self):
        valid, _ = validate_sql("SELECT * FROM t -- DROP TABLE users")
        assert valid

    def test_keyword_in_block_comment(self):
        valid, _ = validate_sql("SELECT * FROM t /* DELETE FROM users */")
        assert valid

    def test_create_in_string(self):
        valid, _ = validate_sql("SELECT * FROM logs WHERE msg LIKE '%CREATE TABLE%'")
        assert valid


# ==========================================================================
# validate_sql() — Multi-statement detection
# ==========================================================================

class TestValidateSqlMultiStatement:
    def test_two_selects(self):
        valid, msg = validate_sql("SELECT 1; SELECT 2")
        assert not valid
        assert "Multiple" in msg

    def test_select_then_drop(self):
        valid, msg = validate_sql("SELECT 1; DROP TABLE x")
        assert not valid

    def test_semicolon_in_string_is_ok(self):
        valid, _ = validate_sql("SELECT * FROM t WHERE x = 'a;b'")
        assert valid

    def test_trailing_semicolon_is_ok(self):
        valid, _ = validate_sql("SELECT * FROM t;")
        assert valid

    def test_trailing_semicolon_with_whitespace(self):
        valid, _ = validate_sql("SELECT * FROM t;  ")
        assert valid


# ==========================================================================
# validate_sql() — PRAGMA safety
# ==========================================================================

class TestValidateSqlPragma:
    def test_read_pragma(self):
        valid, _ = validate_sql('PRAGMA table_info("users")')
        assert valid

    def test_pragma_journal_mode_blocked(self):
        valid, msg = validate_sql("PRAGMA JOURNAL_MODE = WAL")
        assert not valid

    def test_pragma_writable_schema_blocked(self):
        valid, msg = validate_sql("PRAGMA WRITABLE_SCHEMA = ON")
        assert not valid

    def test_pragma_auto_vacuum_blocked(self):
        valid, msg = validate_sql("PRAGMA AUTO_VACUUM = FULL")
        assert not valid

    def test_pragma_locking_mode_blocked(self):
        valid, msg = validate_sql("PRAGMA LOCKING_MODE = EXCLUSIVE")
        assert not valid

    def test_pragma_incremental_vacuum_blocked(self):
        valid, msg = validate_sql("PRAGMA INCREMENTAL_VACUUM")
        assert not valid


# ==========================================================================
# validate_sql() — Edge cases
# ==========================================================================

class TestValidateSqlEdgeCases:
    def test_empty_string(self):
        valid, msg = validate_sql("")
        assert not valid

    def test_whitespace_only(self):
        valid, msg = validate_sql("   \n\t  ")
        assert not valid

    def test_only_comments(self):
        valid, msg = validate_sql("-- just a comment\n-- another")
        assert not valid

    def test_cte_without_select(self):
        valid, msg = validate_sql("WITH cte AS (VALUES (1))")
        assert not valid
        assert "SELECT" in msg

    def test_disallowed_start(self):
        valid, msg = validate_sql("SHOW TABLES")
        assert not valid
        assert "must start with" in msg

    def test_nested_quotes(self):
        valid, _ = validate_sql("SELECT * FROM t WHERE x = 'it''s a test'")
        assert valid
