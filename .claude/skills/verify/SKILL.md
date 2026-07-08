---
name: verify
description: Build, launch, and drive yourSQLfriend end-to-end to verify frontend/backend changes at the browser surface.
---

# Verifying yourSQLfriend

## Launch

```bash
# from repo root; venv lives at ./venv (Windows: venv/Scripts)
./venv/Scripts/python.exe -m pip install -e . --force-reinstall --no-deps  # only after a version bump
./venv/Scripts/python.exe -m yoursqlfriend.app --no-browser --port 5099   # run_in_background
curl -s http://127.0.0.1:5099/api/version   # readiness check
```

The readiness check must return the version you just built — a stale verify
instance from an earlier session can still be squatting on the port, and a
200 from old code silently verifies nothing. On a mismatch, kill the
listener (`Get-NetTCPConnection -LocalPort 5099`) or launch on a fresh port.

An LLM provider must be live for chat flows: LM Studio on `localhost:1234`
(usually qwen3.6-27b on this machine) or Ollama on `localhost:11434`.
Without one, only upload/schema/search/UI flows are drivable; chat renders
the offline-guidance error (itself a verifiable path).

## Drive (browser surface)

Playwright via a scratchpad npm dir (`npm i playwright`, `npx playwright
install chromium` once). Proven flow, see git history for a full driver
script (`drive.cjs`):

1. Create a small SQLite DB with an FK (users ← logins) via sqlite3.
2. `page.setInputFiles('#database-file', db)` → wait for `body.db-loaded`.
3. Chat: fill `#user-input`, click `#send-button`; while streaming the button
   reads `Stop`; completion = button text back to `Send` and input enabled.
   Allow 240s timeouts — a 27B local model is slow to prefill.
4. Results: `.results-table-container` in the last `.bot-message`; rows are
   `tbody tr.gridjs-tr` with `tabindex="0"`; Enter feeds `#rp-body` (inspector).
5. Stop path: click `#send-button` mid-stream → `.gen-stopped-note`, no
   `.results-table-container`, no `.chat-error-message` in that bubble.
6. Popover/modal focus: `#settings-btn` → focus inside `#settings-popover`,
   Escape returns it; `.modal-overlay` traps Tab, Escape removes it.

## Gotchas

- Reduced-motion check: computed `transition-duration` reports `1e-05s`
  (seconds), not `0.01ms` — compare numerically.
- Reloading the page mid-provider-poll logs a benign
  "Failed to check provider status: TypeError: Failed to fetch".
- Route tests that POST must not set a foreign Origin/Host header (403 guard).
- Editable install caches version metadata; refresh after bumping
  `pyproject.toml` or `?v=` cache-bust tokens go stale.
- DB-replace flows: `setInputFiles` with the *same* path twice fires no
  `change` event — the replace-confirm modal never opens and the check
  silently tests nothing. Replace with a second copy of the fixture; the
  confirm button is `.confirm-modal-confirm` ("Continue").
