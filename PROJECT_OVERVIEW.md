# mySQLhelper - Project Overview

**Quick Start**: Read this first for project context. For development details, see [CLAUDE.md](CLAUDE.md). For user setup, see [README.md](README.md).

---

## Project Identity

**mySQLhelper** is a 100% offline SQLite database analysis tool that uses natural language to generate SQL queries through a local LLM. Built specifically for digital forensics workflows where data must stay local and databases must remain unmodified.

**Core Value Proposition**: Ask questions in plain English, get SQL results—all without your data ever leaving the machine.

---

## Use Case: Digital Forensics

### Why This Tool Exists

Digital forensics investigators routinely analyze SQLite databases from:
- Mobile device backups (iOS, Android)
- Desktop applications (browsers, chat apps)
- Server logs and application data
- Evidence from seized devices

**The Problem**:
- SQLite queries require SQL knowledge
- Cloud AI services violate chain of custody
- Risk of accidental data modification invalidates evidence
- Tools must be reproducible across investigation labs

**The Solution**:
mySQLhelper bridges the gap between natural language questions and SQL execution, running entirely on air-gapped forensic workstations with local LLMs.

### Critical Requirements

1. **100% Offline**: No data leaves the network. Only localhost LLM API calls.
2. **Read-Only Guarantee**: SQL validation prevents any data modification (INSERT, UPDATE, DELETE, DROP, etc.)
3. **Chain of Custody**: Database files remain forensically sound
4. **Reproducible Deployment**: Simple setup across Windows/Mac/Linux forensic machines
5. **No Build Dependencies**: No npm, webpack, or compilation—just Python + vanilla JS

---

## Architecture Overview

### Technology Stack

```
┌─────────────────────────────────────────────┐
│ Frontend: Vanilla JS + CSS                 │
│  ├─ No frameworks, no build step           │
│  ├─ marked.js (Markdown rendering)         │
│  └─ DOMPurify (XSS protection)             │
├─────────────────────────────────────────────┤
│ Backend: Flask 3.x + Flask-Session         │
│  ├─ Filesystem-based sessions              │
│  ├─ SQLite3 (read-only operations)         │
│  └─ Requests (LLM proxy)                   │
├─────────────────────────────────────────────┤
│ AI: Local LLM via LM Studio                │
│  └─ localhost:1234/v1/chat/completions     │
└─────────────────────────────────────────────┘
```

**Total Dependencies**: 5 Python packages (Flask, SQLAlchemy, pandas, requests, Flask-Session)

### Design Philosophy

1. **Zero Build Step** - Clone, install, run. No transpilation or bundling.
2. **Minimal Dependencies** - Only essential libraries, all offline-capable.
3. **Single-File Simplicity** - Avoid over-engineering for easy deployment.
4. **Vanilla Stack** - Standard HTML/CSS/JS for maximum compatibility.
5. **Security First** - Read-only validation is non-negotiable.

### Key Architectural Decisions

**Two-Step Execution Flow**:
1. User message → `/chat_stream` → LLM generates explanation + SQL
2. Frontend extracts SQL → `/execute_sql` → Backend validates & runs query

**Why**: Separates explanation from execution. If SQL fails, the LLM's explanation is preserved in chat history.

**Session State Structure**:
```python
session = {
    'db_filepath': 'uploads/evidence.db',
    'chat_history': [
        {"role": "user", "content": "Show top customers"},
        {"role": "assistant",
         "content": "Here's a query...",
         "sql_query": "SELECT * FROM customers LIMIT 10",
         "query_results_preview": [...],  # First 20 rows
         "total_results": 347
        }
    ]
}
```

---

## Security Model

### SQL Validation (`validate_sql()`)

**Validation Rules**:
1. ✅ Must start with `SELECT`
2. ❌ No multiple statements (checks for `; <non-whitespace>`)
3. ❌ Blocklist: DROP, DELETE, INSERT, UPDATE, ALTER, TRUNCATE, EXEC, GRANT, REVOKE

**Return Codes**:
- Valid query: Proceeds to execution
- Invalid query: Returns `403 Forbidden` with error message

**Why This Matters**: In forensics, modifying an evidence database breaks chain of custody. One accidental write operation invalidates the entire investigation.

### File Upload Safety

- Uses `secure_filename()` to prevent path traversal
- Confirmation dialog when switching databases mid-chat
- Databases stored in `uploads/` directory (gitignored)

---

## Working Features (v1.1)

### Core Functionality

- **Database Upload**: Drag-and-drop `.db`/`.sqlite` files with automatic schema extraction
- **Natural Language Chat**: Ask questions in plain English, get SQL + results
- **Streaming Responses**: Real-time LLM output with "thinking" indicator
- **SQL Execution**: Automatic extraction from ````sql```` blocks, validated and executed
- **Interactive Tables**: Batch rendering (20 rows at a time) with "Show More" pagination
- **Copy SQL**: One-click copy button for each generated query
- **Session Persistence**: Full conversation history maintained across requests
- **Export Chat**: Download entire analysis session as standalone HTML

### UI/UX Polish (v1.1)

- **Fixed Scrollbars**: Resolved double-scrollbar issues with proper flex layout
- **Safety Dialogs**: Confirmation when uploading new database during active chat
- **High-Fidelity Export**: Chat export perfectly mirrors app styling
- **Responsive Sidebar**: Collapsible schema panel
- **Dark Theme**: Open WebUI-inspired design

### Performance Optimizations

- **2000 Row Limit**: Backend caps results to prevent memory issues
- **Batch Rendering**: Frontend renders 20 rows at a time
- **Streaming Protocol**: `<|END_OF_STREAM|>` token for efficient chunking
- **CSS Optimization**: `min-height: 0` trick for flex scrolling

---

## Deployment Model

### Quick Setup (5 Commands)

```bash
git clone https://github.com/reisset/mysqlhelper.git
cd mysqlhelper
python -m venv venv && source venv/bin/activate  # Windows: .\venv\Scripts\activate
pip install -r requirements.txt
flask run
```

**Result**: Web app running at `http://127.0.0.1:5000`

### Prerequisites

1. **Python 3.10+** - Standard interpreter
2. **LM Studio** (or any OpenAI-compatible local server)
   - Download model (Qwen 2.5 Coder, Mistral, RNJ1, etc.)
   - Enable server mode on port 1234
   - Load model before starting Flask app

### Forensic Machine Considerations

- **Air-Gapped Operation**: No internet required (except localhost:1234)
- **Portable Installation**: Entire project in one directory
- **Cross-Platform**: Works on Windows, Mac, Linux forensic workstations
- **Single User**: Flask dev server, one session at a time
- **Evidence Workflow**: Upload DB → Analyze → Export HTML report

---

## Key Constraints for Development

**Non-Negotiables** (must be preserved in any future work):

1. ⚠️ **No External APIs** - Everything offline except localhost LM Studio
2. ⚠️ **Read-Only Guarantee** - SQL validation cannot be weakened or bypassed
3. ⚠️ **No Build Step** - Keep vanilla JS/CSS for easy reproduction
4. ⚠️ **Minimal Dependencies** - Avoid bloat, maintain simple `requirements.txt`
5. ⚠️ **Single-File Simplicity** - Don't over-engineer the architecture

**Nice-to-Haves** (can be modified):
- UI styling and themes
- Additional export formats (CSV, JSON)
- Query history/favorites
- Multiple database tabs

---

## Codebase Structure

```
mysqlhelper/
├── app.py                      # Flask backend (303 lines)
├── requirements.txt            # 5 Python dependencies
├── templates/
│   └── index.html             # Single-page app shell (63 lines)
├── static/
│   ├── script.js              # Frontend logic (401 lines)
│   ├── style.css              # Dark theme (412 lines)
│   └── lib/
│       ├── marked.min.js      # Markdown parser
│       └── purify.min.js      # XSS sanitizer
├── uploads/                    # Database files (gitignored)
└── flask_session/             # Session storage (gitignored)
```

**Total Project Lines**: ~1200 (excluding libraries)

---

## Critical Files Reference

| What You Need | Where to Look |
|---------------|---------------|
| Route handlers | `app.py` - Lines 51-300 |
| SQL validation | `app.py:30-49` - `validate_sql()` |
| Streaming logic | `app.py:145-175` - `stream_llm_response()` |
| Frontend chat | `static/script.js:78-174` - `sendMessage()` |
| SQL execution | `static/script.js:188-232` - `executeSqlAndRender()` |
| CSS scrolling fix | `static/style.css` - `.chat-history { min-height: 0; }` |
| Session structure | `app.py:67-68, 130, 183-185, 222-229` |

---

## Known Limitations

### Current Constraints

1. **Dataset Size**: Max 2000 rows returned per query (backend limit)
2. **Concurrency**: Single user only (Flask dev server)
3. **SQL Complexity**: No stored procedures, temp tables may timeout
4. **Browser Support**: Requires modern browser (ES6+, no IE)
5. **LLM Dependency**: Requires LM Studio running on localhost:1234
6. **WAL Files**: Single-file upload only; databases with active WAL/SHM files must be checkpointed before upload.

### Performance Boundaries

- Large result sets (>10,000 rows) may cause browser lag
- Complex JOINs on large tables may timeout
- Chat history grows unbounded (no auto-truncation yet)

---

## Related Documentation

- **[CLAUDE.md](CLAUDE.md)** - Detailed development guide with code patterns, gotchas, and workflows
- **[README.md](README.md)** - User-facing setup instructions and feature list
- **[CHANGELOG.txt](CHANGELOG.txt)** - Version history and release notes
- **[GEMINI.md](GEMINI.md)** - Gemini-specific development context (if applicable)

---

## Development Workflow

### When Starting New Work

1. **Read this file** for project context and constraints
2. **Check [CLAUDE.md](CLAUDE.md)** for code patterns and implementation details
3. **Test immediately** - Run `flask run` and verify changes in browser
4. **Preserve security** - Any SQL-related changes must maintain validation

### Quick Start Commands

```bash
# Activate environment
source venv/bin/activate  # Windows: .\venv\Scripts\activate

# Check LM Studio is running
curl http://localhost:1234/v1/models

# Start Flask
flask run

# Run with debug mode
FLASK_DEBUG=true flask run
```

### Common Tasks

- **Add a new route**: Follow patterns in `app.py` (lines 51-300)
- **Modify UI**: Edit `static/style.css` and `static/script.js`
- **Change LLM behavior**: Update system prompt in `app.py:132-140`
- **Fix scrolling issues**: Check flex layout patterns in CLAUDE.md

---

## Version History

**v1.1** (Latest)
- Fixed double scrollbar issues
- Added database upload confirmation dialogs
- Enhanced HTML export fidelity
- Resolved event listener conflicts

**v1.0** (Initial Release)
- Core chat functionality
- SQL validation and execution
- Schema inspection
- Markdown rendering
- Export to HTML

---

## License

MIT License - See repository for full text

---

**Last Updated**: 2025-12-15
**Maintained By**: [Your Name/Team]
**AI Assistant Version**: Optimized for Claude Code interaction
