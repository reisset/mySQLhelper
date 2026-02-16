// Forensic annotations: add/edit notes on bot messages

import { showAlertModal } from './ui.js';

export function enableAnnotation(container, messageId) {
    const controlsDiv = document.createElement('div');
    controlsDiv.className = 'message-controls';

    const addNoteBtn = document.createElement('button');
    addNoteBtn.className = 'add-note-btn';
    addNoteBtn.textContent = '+ Add Note';

    addNoteBtn.onclick = () => {
        addNoteBtn.style.display = 'none';
        showNoteEditor(controlsDiv, messageId);
    };

    controlsDiv.appendChild(addNoteBtn);
    container.appendChild(controlsDiv);
}

function showNoteEditor(container, messageId, initialText = '') {
    const editorDiv = document.createElement('div');
    editorDiv.className = 'note-editor';

    const textarea = document.createElement('textarea');
    textarea.className = 'note-editor-textarea';
    textarea.placeholder = "Enter forensic note...";
    textarea.value = initialText;

    const buttonsDiv = document.createElement('div');
    buttonsDiv.className = 'note-editor-buttons';

    const saveBtn = document.createElement('button');
    saveBtn.className = 'note-editor-save';
    saveBtn.textContent = 'Save Note';

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'note-editor-cancel';
    cancelBtn.textContent = 'Cancel';

    cancelBtn.onclick = () => {
        editorDiv.remove();
        container.querySelector('.add-note-btn').style.display = 'inline-block';
    };

    saveBtn.onclick = () => {
        const noteContent = textarea.value.trim();
        if (!noteContent) return;

        saveBtn.disabled = true;
        saveBtn.textContent = 'Saving...';

        fetch('/add_note', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message_id: messageId, note_content: noteContent })
        })
        .then(res => res.json())
        .then(data => {
            if (data.status === 'success') {
                editorDiv.remove();
                renderNote(container, noteContent, messageId);
            } else {
                showAlertModal('Save Error', 'Error saving note: ' + (data.error || 'Unknown error'));
                saveBtn.disabled = false;
                saveBtn.textContent = 'Save Note';
            }
        })
        .catch(err => {
            console.error(err);
            showAlertModal('Network Error', 'Failed to save note. Please try again.');
            saveBtn.disabled = false;
            saveBtn.textContent = 'Save Note';
        });
    };

    buttonsDiv.appendChild(cancelBtn);
    buttonsDiv.appendChild(saveBtn);
    editorDiv.appendChild(textarea);
    editorDiv.appendChild(buttonsDiv);
    container.appendChild(editorDiv);
}

function renderNote(container, text, messageId) {
    // Remove existing note if any
    const existing = container.parentNode.querySelector('.forensic-note');
    if (existing) existing.remove();

    const noteDiv = document.createElement('div');
    noteDiv.className = 'forensic-note';

    const label = document.createElement('strong');
    label.textContent = 'Analyst Note: ';
    noteDiv.appendChild(label);

    const textNode = document.createTextNode(text);
    noteDiv.appendChild(textNode);

    // Update the "Add Note" button to "Edit Note"
    const controls = container.querySelector('.add-note-btn');
    if (controls) {
        controls.textContent = 'Edit Note';
        controls.style.display = 'inline-block';

        controls.onclick = () => {
            controls.style.display = 'none';
            showNoteEditor(container, messageId, text);
        };
    }

    container.insertBefore(noteDiv, container.lastChild);
}
