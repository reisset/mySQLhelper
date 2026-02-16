"""Tests for LLM module: provider config, prompts, and mocked API calls."""

import sqlite3
import os
import tempfile
from unittest.mock import patch, MagicMock

import pytest
from yoursqlfriend.llm import (
    get_provider_config, _build_llm_payload, _extract_llm_content,
    build_schema_context, build_system_prompt, build_error_correction_prompt,
    call_llm_non_streaming, OLLAMA_MODEL,
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
        assert payload['options']['temperature'] == 0.1

    def test_lmstudio_streaming(self):
        config = get_provider_config('lmstudio')
        payload = _build_llm_payload(config, [{'role': 'user', 'content': 'hi'}], stream=True)
        assert 'model' not in payload
        assert payload['stream'] is True
        assert payload['mode'] == 'chat'
        assert 'stream_options' in payload

    def test_lmstudio_non_streaming(self):
        config = get_provider_config('lmstudio')
        payload = _build_llm_payload(config, [{'role': 'user', 'content': 'hi'}], stream=False)
        assert payload['stream'] is False
        assert 'mode' not in payload
        assert 'stream_options' not in payload


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
            with sqlite3.connect(path) as conn:
                conn.execute('CREATE TABLE test (id INTEGER PRIMARY KEY, val TEXT)')
                conn.execute("INSERT INTO test VALUES (1, 'hello')")
            context = build_schema_context(path)
            assert 'CREATE TABLE test' in context
            assert 'hello' in context
        finally:
            os.unlink(path)

    def test_without_samples(self):
        fd, path = tempfile.mkstemp(suffix='.db')
        os.close(fd)
        try:
            with sqlite3.connect(path) as conn:
                conn.execute('CREATE TABLE test (id INTEGER PRIMARY KEY, val TEXT)')
                conn.execute("INSERT INTO test VALUES (1, 'hello')")
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
