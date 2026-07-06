"""Smoke-test an installed wheel: the app must serve its non-Python assets.

Editable installs resolve templates/static from the source tree, so pytest
alone can't catch a wheel that ships without them. CI installs the built
wheel into a clean venv and runs this script with that venv's Python.
"""
import sys

from yoursqlfriend.app import app


def main():
    client = app.test_client()

    resp = client.get('/')
    assert resp.status_code == 200, f'/ returned {resp.status_code} — templates missing from wheel?'
    assert b'yourSQLfriend' in resp.data

    resp = client.get('/service-worker.js')
    assert resp.status_code == 200, f'/service-worker.js returned {resp.status_code}'
    assert b'%%VERSION%%' not in resp.data, 'service worker version placeholder was not substituted'

    resp = client.get('/static/manifest.json')
    assert resp.status_code == 200, f'/static/manifest.json returned {resp.status_code}'

    print('wheel smoke test OK')


if __name__ == '__main__':
    sys.exit(main())
