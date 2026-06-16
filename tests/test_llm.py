"""Tests for LLM module: provider config, prompts, and mocked API calls."""

import sqlite3
import os
import tempfile
from unittest.mock import patch, MagicMock

import pytest
from yoursqlfriend.llm import (
    get_provider_config, _build_llm_payload, _extract_llm_content,
    build_schema_context, build_system_prompt, build_error_correction_prompt,
    call_llm_non_streaming, resolve_ollama_model, OLLAMA_MODEL,
)


# --- Provider Config ---

class TestGetProviderConfig:
    def test_ollama_config(self):
        config = get_provider_config('ollama', model='llama3')
        assert config['provider'] == 'ollama'
        assert config['model'] == 'llama3'
        assert '/api/chat' in config['url']
        assert config['headers'] is None
        assert config['label'] == 'Ollama'

    def test_ollama_default_model(self):
        config = get_provider_config('ollama')
        assert config['model'] == OLLAMA_MODEL

    def test_lmstudio_config(self):
        config = get_provider_config('lmstudio')
        assert config['provider'] == 'lmstudio'
        assert config['model'] is None
        assert config['headers'] == {'Content-Type': 'application/json'}
        assert config['label'] == 'LM Studio'


# --- Payload Building ---

class TestBuildPayload:
    def test_ollama_streaming(self):
        config = get_provider_config('ollama', model='llama3')
        payload = _build_llm_payload(config, [{'role': 'user', 'content': 'hi'}], stream=True)
        assert payload['model'] == 'llama3'
        assert payload['stream'] is True
        assert payload['keep_alive'] == '30m'
        assert payload['options']['temperature'] == 0
        assert payload['options']['seed'] == 42
        # Streaming chat is uncapped — no num_predict so long answers aren't truncated
        assert 'num_predict' not in payload['options']

    def test_ollama_non_streaming_with_max_tokens(self):
        """Retry path: num_predict must be present when max_tokens is specified."""
        config = get_provider_config('ollama', model='llama3')
        payload = _build_llm_payload(config, [{'role': 'user', 'content': 'hi'}],
                                     stream=False, max_tokens=2048)
        assert payload['options']['num_predict'] == 2048

    def test_lmstudio_streaming(self):
        config = get_provider_config('lmstudio')
        payload = _build_llm_payload(config, [{'role': 'user', 'content': 'hi'}], stream=True)
        assert 'model' not in payload
        assert payload['stream'] is True
        assert payload['mode'] == 'chat'
        assert 'stream_options' in payload
        # Streaming chat is uncapped — no max_tokens key in the payload
        assert 'max_tokens' not in payload

    def test_lmstudio_non_streaming(self):
        config = get_provider_config('lmstudio')
        payload = _build_llm_payload(config, [{'role': 'user', 'content': 'hi'}], stream=False)
        assert payload['stream'] is False
        assert 'mode' not in payload
        assert 'stream_options' not in payload

    def test_lmstudio_non_streaming_with_max_tokens(self):
        """Retry path: max_tokens must be present when specified."""
        config = get_provider_config('lmstudio')
        payload = _build_llm_payload(config, [{'role': 'user', 'content': 'hi'}],
                                     stream=False, max_tokens=2048)
        assert payload['max_tokens'] == 2048


class TestStructuredOutputPayload:
    """Verify that use_structured_output=True injects the right schema for each provider."""

    def test_lmstudio_structured_output_format(self):
        config = get_provider_config('lmstudio')
        payload = _build_llm_payload(config, [{'role': 'user', 'content': 'fix'}],
                                     stream=False, use_structured_output=True, max_tokens=2048)
        assert 'response_format' in payload
        rf = payload['response_format']
        assert rf['type'] == 'json_schema'
        assert rf['json_schema']['name'] == 'sql_correction'
        assert rf['json_schema']['strict'] is True
        schema = rf['json_schema']['schema']
        assert schema['type'] == 'object'
        assert 'sql' in schema['properties']
        assert schema['required'] == ['sql']

    def test_ollama_structured_output_format(self):
        config = get_provider_config('ollama', model='llama3')
        payload = _build_llm_payload(config, [{'role': 'user', 'content': 'fix'}],
                                     stream=False, use_structured_output=True, max_tokens=2048)
        assert 'format' in payload
        fmt = payload['format']
        assert fmt['type'] == 'object'
        assert 'sql' in fmt['properties']
        assert fmt['required'] == ['sql']

    def test_no_structured_output_when_flag_false(self):
        """Default call must not inject response_format or format."""
        lms_config = get_provider_config('lmstudio')
        lms_payload = _build_llm_payload(lms_config, [{'role': 'user', 'content': 'hi'}])
        assert 'response_format' not in lms_payload

        ollama_config = get_provider_config('ollama', model='llama3')
        ollama_payload = _build_llm_payload(ollama_config, [{'role': 'user', 'content': 'hi'}])
        assert 'format' not in ollama_payload


class TestResolveOllamaModel:
    """Priority ladder: session → env → first-installed → None."""

    def test_session_model_takes_priority(self):
        with patch('yoursqlfriend.llm.OLLAMA_MODEL', 'env-model'):
            with patch('yoursqlfriend.llm.check_ollama_available', return_value=(True, ['installed-model'])):
                result = resolve_ollama_model(session_model='session-model')
        assert result == 'session-model'

    def test_env_var_used_when_no_session(self):
        with patch('yoursqlfriend.llm.OLLAMA_MODEL', 'env-model'):
            with patch('yoursqlfriend.llm.check_ollama_available', return_value=(True, ['installed-model'])):
                result = resolve_ollama_model(session_model=None)
        assert result == 'env-model'

    def test_first_installed_model_when_no_env(self):
        with patch('yoursqlfriend.llm.OLLAMA_MODEL', None):
            with patch('yoursqlfriend.llm.check_ollama_available', return_value=(True, ['first', 'second'])):
                result = resolve_ollama_model(session_model=None)
        assert result == 'first'

    def test_returns_none_when_no_models_available(self):
        with patch('yoursqlfriend.llm.OLLAMA_MODEL', None):
            with patch('yoursqlfriend.llm.check_ollama_available', return_value=(False, [])):
                result = resolve_ollama_model(session_model=None)
        assert result is None

    def test_empty_session_string_falls_through(self):
        """Empty string should not count as a session pick."""
        with patch('yoursqlfriend.llm.OLLAMA_MODEL', None):
            with patch('yoursqlfriend.llm.check_ollama_available', return_value=(True, ['auto'])):
                result = resolve_ollama_model(session_model='')
        assert result == 'auto'


# --- Content Extraction ---

class TestExtractContent:
    def test_ollama_response(self):
        config = get_provider_config('ollama')
        data = {'message': {'content': 'Hello world'}}
        assert _extract_llm_content(config, data) == 'Hello world'

    def test_lmstudio_response(self):
        config = get_provider_config('lmstudio')
        data = {'choices': [{'message': {'content': 'Hello world'}}]}
        assert _extract_llm_content(config, data) == 'Hello world'

    def test_lmstudio_empty_choices(self):
        config = get_provider_config('lmstudio')
        assert _extract_llm_content(config, {'choices': []}) == ''
        assert _extract_llm_content(config, {}) == ''


# --- Schema Context ---

class TestBuildSchemaContext:
    def test_empty_filepath(self):
        assert build_schema_context(None) == ""
        assert build_schema_context("") == ""

    def test_with_real_db(self):
        fd, path = tempfile.mkstemp(suffix='.db')
        os.close(fd)
        try:
            conn = sqlite3.connect(path)
            conn.execute('CREATE TABLE test (id INTEGER PRIMARY KEY, val TEXT)')
            conn.execute("INSERT INTO test VALUES (1, 'hello')")
            conn.commit()
            conn.close()  # explicit close — required for os.unlink on Windows
            context = build_schema_context(path)
            assert 'CREATE TABLE test' in context
            assert 'hello' in context
        finally:
            os.unlink(path)

    def test_without_samples(self):
        fd, path = tempfile.mkstemp(suffix='.db')
        os.close(fd)
        try:
            conn = sqlite3.connect(path)
            conn.execute('CREATE TABLE test (id INTEGER PRIMARY KEY, val TEXT)')
            conn.execute("INSERT INTO test VALUES (1, 'hello')")
            conn.commit()
            conn.close()  # explicit close — required for os.unlink on Windows
            context = build_schema_context(path, include_samples=False)
            assert 'CREATE TABLE test' in context
            assert 'hello' not in context
        finally:
            os.unlink(path)


# --- Prompts ---

class TestPrompts:
    def test_system_prompt_contains_schema(self):
        prompt = build_system_prompt("Database Schema:\nCREATE TABLE foo (id INT);")
        assert 'SQLite expert' in prompt
        assert 'CREATE TABLE foo' in prompt

    def test_error_correction_no_such_column(self):
        prompt = build_error_correction_prompt('no such column: foo', 'SELECT foo FROM t', 'schema')
        assert 'misspelled' in prompt
        assert 'SELECT foo FROM t' in prompt

    def test_error_correction_no_such_table(self):
        prompt = build_error_correction_prompt('no such table: bar', 'SELECT * FROM bar', 'schema')
        assert 'table' in prompt.lower()

    def test_error_correction_syntax(self):
        prompt = build_error_correction_prompt('near "SELCT": syntax error', 'SELCT * FROM t', 'schema')
        assert 'syntax' in prompt.lower()


# --- Non-streaming LLM Call (mocked) ---

class TestCallLLMNonStreaming:
    @patch('yoursqlfriend.llm.requests.post')
    def test_lmstudio_success(self, mock_post):
        mock_resp = MagicMock()
        mock_resp.json.return_value = {'choices': [{'message': {'content': 'SELECT 1'}}]}
        mock_resp.raise_for_status = MagicMock()
        mock_post.return_value = mock_resp

        result = call_llm_non_streaming([{'role': 'user', 'content': 'hi'}], provider='lmstudio')
        assert result == 'SELECT 1'

    @patch('yoursqlfriend.llm.requests.post')
    def test_ollama_success(self, mock_post):
        mock_resp = MagicMock()
        mock_resp.json.return_value = {'message': {'content': 'SELECT 2'}}
        mock_resp.raise_for_status = MagicMock()
        mock_post.return_value = mock_resp

        result = call_llm_non_streaming([{'role': 'user', 'content': 'hi'}], provider='ollama')
        assert result == 'SELECT 2'

    @patch('yoursqlfriend.llm.requests.post')
    def test_connection_error_returns_empty(self, mock_post):
        mock_post.side_effect = Exception("Connection refused")
        result = call_llm_non_streaming([{'role': 'user', 'content': 'hi'}])
        assert result == ''
