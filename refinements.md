# Refinements Implementation Plan

This document outlines the detailed implementation plan for enhancing the mySQLhelper forensic analysis tool.

## 1. Syntax Highlighting (Visual Polish)

**Goal:** Improve readability of generated SQL queries and code blocks using `highlight.js`.

**Technical Steps:**
1.  **Dependencies (Offline-First):**
    *   Download `highlight.min.js` (v11.9.0) to `static/lib/`.
    *   Download `atom-one-dark.min.css` to `static/lib/styles/`.
    *   *Validation:* Ensure files are served locally, not via CDN links in the final HTML.
2.  **Integration (`templates/index.html`):**
    *   Include the CSS in the `<head>`.
    *   Include the JS script before `script.js`.
3.  **Logic (`static/script.js`):**
    *   Configure `marked.js` options before initial usage.
    *   Update `renderText` function:
        ```javascript
        marked.setOptions({
            highlight: function(code, lang) {
                const language = hljs.getLanguage(lang) ? lang : 'plaintext';
                return hljs.highlight(code, { language }).value;
            },
            langPrefix: 'hljs language-'
        });
        ```
    *   *Note:* The existing "Copy" button logic will continue to work as it targets the DOM *after* `marked` renders the HTML.

## 2. Smart Results Table (Data Interactivity)

**Goal:** Replace static HTML tables with interactive ones (Search, Sort, Pagination) using `Grid.js`.

**Technical Steps:**
1.  **Dependencies (Offline-First):**
    *   Download `gridjs.umd.js` (Production UMD build, ~12KB gzipped) to `static/lib/`.
    *   Download `mermaid.min.css` (Grid.js theme) to `static/lib/`.
2.  **Integration (`templates/index.html`):**
    *   Include `mermaid.min.css` and `gridjs.umd.js`.
3.  **Logic (`static/script.js`):**
    *   Refactor `appendResultsTable(queryResults, container)`:
        *   Clear the container.
        *   Initialize Grid.js instance:
            ```javascript
            new gridjs.Grid({
                columns: Object.keys(queryResults[0]),
                data: queryResults.map(row => Object.values(row)),
                pagination: { limit: 10 },
                search: true,
                sort: true,
                resizable: true, // Bonus: Column resizing
                style: { 
                    table: { 'white-space': 'nowrap' },
                    th: { 'background-color': '#222', 'color': '#fff' },
                    td: { 'background-color': '#1d1d1d', 'color': '#ddd' }
                }
            }).render(container);
            ```

## 3. Quick Prompts / Shortcuts (Analyst Workflow)

**Goal:** Add a "Shortcuts" section to the Sidebar for one-click execution of common forensic queries.

**Technical Steps:**
1.  **Data Structure (`static/script.js`):**
    *   Define `SHORTCUTS` constant array.
2.  **UI Updates (`templates/index.html`):**
    *   In the sidebar `<div class="sidebar-section">` (Actions), add a new button:
        ```html
        <button id="shortcuts-button" class="sidebar-button">Freq. Queries</button>
        ```
    *   Create a hidden Modal or Sub-menu container for the list.
3.  **Logic (`static/script.js`):**
    *   Implement toggle logic for the menu.
    *   On click of a shortcut:
        *   Fill `userInput.value`.
        *   Trigger `sendMessage()`.

## 4. Forensic Report Annotations (Integrity & Notes)

**Goal:** Allow users to add persistent notes to specific chat messages.

**Technical Steps:**
1.  **Prerequisite (Backend Robustness):**
    *   **Modify `app.py`:** Update `chat_stream` and `upload_file` (welcome message) to assign a UUID to every message when it is created.
    *   *Why:* Array indices are brittle. If we filter or delete messages later, notes would drift. UUIDs ensure data integrity.
2.  **API (`app.py`):**
    *   New Endpoint: `/add_note`
    *   Method: `POST`
    *   Payload: `{ message_id: "uuid-string", note_content: "..." }`
    *   Logic: Find message by UUID in `session['chat_history']` and update it.
3.  **UI (`static/script.js`):**
    *   Update `appendMessage` to accept an ID.
    *   Render an "Add Note" button.
    *   Handle the UI state for "Editing Note" vs "Viewing Note".
4.  **Export (`app.py`):**
    *   Update HTML generation to render the `note` field if present.