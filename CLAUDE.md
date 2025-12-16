# mySQLhelper Development Guide

**Purpose**: Practical development patterns, gotchas, and workflows for mySQLhelper.

**Context First?** Read [PROJECT_OVERVIEW.md](PROJECT_OVERVIEW.md) for project identity, use case, and architecture. This guide assumes you understand *what* the project is and focuses on *how* to develop it.

---

## Critical Patterns & Gotchas

### 1. Two-Step Execution Flow

**The Flow:**
1. User message → `/chat_stream` → LLM generates explanation + SQL
2. Frontend extracts ````sql...```` block
3. Frontend calls `/execute_sql` with extracted SQL
4. Backend validates → executes → returns results
5. Frontend renders table

**Why Separate Steps?**
- LLM explanation saved BEFORE SQL execution
- If query fails, explanation is preserved in chat history
- User sees what the LLM intended even if execution errors

**Implementation Detail:** Full response sent via `<|END_OF_STREAM|>` token for backend storage.

### 2. Session State Management

**Structure:**
```python
session = {
    'db_filepath': 'uploads/evidence.db',
    'chat_history': [
        {"role": "user", "content": "..."},
        {"role": "assistant",
         "content": "...",
         "sql_query": "...",
         "query_results_preview": [...]
        }
    ]
}
```

**⚠️ CRITICAL:** `session.modified = True` MUST be called after mutating session dicts/lists. Flask-Session doesn't auto-detect nested changes.

**Example:**
```python
chat_history = session.get('chat_history', [])
chat_history.append({"role": "user", "content": message})
session['chat_history'] = chat_history  # Triggers modification tracking
session.modified = True  # Required for nested mutations
```

### 3. CSS Scrolling Fix

**The Problem:** Double scrollbars when chat content exceeds viewport.

**The Solution:**
```css
body { overflow: hidden; }  /* Prevents outer scroll */
.app-container { display: flex; height: 100vh; }
.main-chat { flex-grow: 1; display: flex; flex-direction: column; }
.chat-history { flex-grow: 1; overflow-y: auto; min-height: 0; }
```

**Why `min-height: 0`?**
- Flex items default to `min-height: auto`
- This prevents shrinking below content size → breaks scrolling
- Always set `min-height: 0` on flex parents of scrollable children

### 4. SQL Validation (Security)

**Implementation (app.py:30-49):**
```python
def validate_sql(sql):
    sql_upper = sql.strip().upper()
    if not sql_upper.startswith("SELECT"):
        return False, "Only SELECT queries are allowed."

    # No multiple statements
    if re.search(r';\s*\S', sql):
        return False, "Multiple SQL statements are not allowed."

    # Blocklist dangerous keywords
    forbidden = ["DROP", "DELETE", "INSERT", "UPDATE", "ALTER", "TRUNCATE", "EXEC"]
    for keyword in forbidden:
        if re.search(r'\b' + keyword + r'\b', sql_upper):
            return False, f"Forbidden keyword '{keyword}'."

    return True, None
```

**⚠️ NON-NEGOTIABLE:** This validation protects forensic chain of custody. Never weaken or bypass.

---

## Code Patterns

### Backend: Flask Route Template

```python
@app.route('/endpoint', methods=['POST'])
def endpoint_name():
    # 1. Validate input
    data = request.json.get('field')
    if not data:
        return jsonify({'error': 'Missing field'}), 400

    # 2. Get session state
    chat_history = session.get('chat_history', [])

    # 3. Perform operation
    try:
        result = do_thing(data)
    except Exception as e:
        return jsonify({'error': str(e)}), 500

    # 4. Update session (if needed)
    session['key'] = value
    session.modified = True  # CRITICAL

    # 5. Return JSON
    return jsonify({'response': result})
```

### Backend: Database Access

```python
# ALWAYS use try/finally for cleanup
conn = sqlite3.connect(filepath)
conn.row_factory = sqlite3.Row  # Dict-like row access
cursor = conn.cursor()
try:
    cursor.execute(sql)
    results = cursor.fetchall()
finally:
    conn.close()
```

### Frontend: Async Fetch Pattern

```javascript
async function doSomething() {
    try {
        const response = await fetch('/endpoint', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ data })
        });

        if (!response.ok) {
            const errData = await response.json();
            throw new Error(errData.error || 'Unknown error');
        }

        const result = await response.json();
        // Handle success
    } catch (error) {
        console.error('Error:', error);
        alert(`Failed: ${error.message}`);
    }
}
```

### Frontend: Streaming Response Handler

```javascript
const reader = response.body.getReader();
const decoder = new TextDecoder();
let accumulated = '';

while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const chunk = decoder.decode(value, { stream: true });

    if (chunk.includes('<|END_OF_STREAM|>')) {
        const [display, full] = chunk.split('<|END_OF_STREAM|>');
        accumulated += display;
        // Use 'full' for backend storage
        break;
    }
    accumulated += chunk;
    renderText(element, accumulated);
}
```

### Frontend: DOM Performance

```javascript
// ✅ GOOD: Build structure, append once
const container = document.createElement('div');
const table = document.createElement('table');
const tbody = document.createElement('tbody');

rows.forEach(row => {
    const tr = document.createElement('tr');
    // ... build row
    tbody.appendChild(tr);
});

table.appendChild(tbody);
container.appendChild(table);
parentElement.appendChild(container);  // Single reflow

// ❌ BAD: Multiple appends cause reflows
parentElement.appendChild(table);
table.appendChild(tbody);     // Reflow
tbody.appendChild(tr);        // Reflow
```

---

## Common Issues & Solutions

### Issue: Table doesn't render despite SQL in response
**Cause:** Frontend regex doesn't match LLM output format
```javascript
const sqlRegex = /```sql\n([\s\S]*?)\n```/;
```
**Fix:** Check if LLM used ` ```SQL ` (capital) or different formatting

### Issue: Session data lost after browser refresh
**Cause:** `SESSION_PERMANENT = False` (intentional)
**Fix:** This is a security feature for forensics. Don't change without user request.

### Issue: LLM context errors from long chat history
**Cause:** Token limit exceeded
**Fix:** Truncate old messages:
```python
MAX_HISTORY = 20
if len(chat_history) > MAX_HISTORY:
    chat_history = chat_history[-MAX_HISTORY:]
```

### Issue: Browser lag with large result sets
**Current:** Backend limits to 2000 rows, frontend batch-renders 20 at a time
**Better:** Add pagination endpoint with LIMIT/OFFSET

### Issue: Double scrollbars
**Cause:** Missing `min-height: 0` on flex parent
**Fix:** See "CSS Scrolling Fix" section above

---

## Testing Checklist

### Startup
```bash
source venv/bin/activate  # Windows: .\venv\Scripts\activate
curl http://localhost:1234/v1/models  # Verify LM Studio
flask run
```

### Critical Tests
1. **Database Upload**
   - Valid .db file → Schema appears in sidebar
   - Malformed file → Error message
   - Upload during active chat → Confirmation dialog

2. **Query Execution**
   - Natural language → LLM generates SQL + results
   - Invalid SQL attempt → 403 error
   - Complex JOIN → Executes successfully

3. **UI/UX**
   - Sidebar toggles
   - Chat auto-scrolls to bottom
   - "Show More" pagination works
   - Copy SQL button functional
   - No double scrollbars

### Browser Console
Watch for errors:
- "Failed to fetch" → LM Studio not running
- JSON parse errors → Backend response issue
- DOM errors → Script.js bugs

---

## Development Workflow

### Adding Features
1. **Study patterns first** - Check existing routes/functions for similar code
2. **Preserve security** - SQL must go through `validate_sql()`, files through `secure_filename()`
3. **Test immediately** - Run `flask run`, test feature, check browser console

### Debugging
**Data Flow:**
```
User Input → Frontend → Fetch → Backend → Session → Database
→ Response → Frontend → DOM
```

**Common Breakpoints:**
- Frontend: Regex mismatch with LLM output
- Backend: Forgot `session.modified = True`
- Database: File locked by another process
- LLM: Not running or streaming error

**Debug Logging:**
```python
print(f"--- Route: {endpoint} ---")
print(f"Input: {data}")
print(f"Session: {session.get('key')}")
```

### Refactoring Rules
**❌ Don't Break:**
- Streaming protocol (`<|END_OF_STREAM|>`)
- Session state structure
- SQL validation logic
- CSS flex scrolling

**✅ Safe to Change:**
- UI styling (CSS variables)
- Table rendering (preserve data structure)
- Add new routes (follow patterns)

---

## LM Studio Configuration

**Settings:**
- Port: `1234`
- CORS: Enabled
- Temperature: `0.1` (low for consistent SQL)
- Recommended models: Qwen2.5 Coder, Mistral, RNJ1

**System Prompt (app.py:132-140):**
```python
system_prompt = """
You are a SQL expert.
1. If user asks for data, output SQL in markdown:
```sql
SELECT ...
```
2. If user asks about schema, reply in plain text.
3. NEVER modify data. Read-only.
"""
```

**Why:** Regex triggers execution only when ````sql```` block detected.

---

## Quick Reference

### File Locations
```
app.py:30-49        → validate_sql()
app.py:86-175       → /chat_stream route
app.py:188-237      → /execute_sql route
script.js:78-174    → sendMessage()
script.js:188-232   → executeSqlAndRender()
style.css           → CSS scrolling patterns
```

### Environment Variables (Optional)
```bash
export SECRET_KEY="your-secret-key"
export LLM_API_URL="http://localhost:1234/v1/chat/completions"
export FLASK_DEBUG="true"  # Development only
```

### Common Commands
```bash
# Setup
python -m venv venv
source venv/bin/activate  # Windows: .\venv\Scripts\activate
pip install -r requirements.txt

# Run
flask run
FLASK_DEBUG=true flask run  # With debug mode

# Verify LM Studio
curl http://localhost:1234/v1/models
```

---

**Last Updated:** 2025-12-15
**For project context, see:** [PROJECT_OVERVIEW.md](PROJECT_OVERVIEW.md)
