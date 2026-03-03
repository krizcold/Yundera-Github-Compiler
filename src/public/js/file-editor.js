'use strict';

(function () {
    // --- State ---
    let editorView = null;
    let originalContent = '';
    let currentFilePath = '';
    let currentPermissions = null;
    let currentMimeType = '';
    let currentSize = 0;
    let isDirty = false;
    let isSaving = false;

    // --- Language Detection ---
    const EXT_LANG_MAP = {
        '.json': 'json',
        '.yml': 'yaml', '.yaml': 'yaml',
        '.js': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript',
        '.ts': 'typescript', '.mts': 'typescript', '.cts': 'typescript',
        '.jsx': 'jsx', '.tsx': 'tsx',
        '.html': 'html', '.htm': 'html',
        '.xml': 'xml', '.svg': 'xml', '.xsl': 'xml',
        '.css': 'css', '.scss': 'css', '.less': 'css',
        '.md': 'markdown', '.markdown': 'markdown',
        '.sh': 'shell', '.bash': 'shell', '.zsh': 'shell',
        '.py': 'python',
        '.env': 'shell',
        '.toml': 'toml',
        '.ini': 'ini', '.cfg': 'ini', '.conf': 'ini',
        '.dockerfile': 'docker',
    };

    const FILENAME_LANG_MAP = {
        'Dockerfile': 'docker',
        'Makefile': 'shell',
        '.gitignore': 'shell',
        '.dockerignore': 'shell',
        '.env': 'shell',
    };

    function detectLanguage(fileName) {
        if (FILENAME_LANG_MAP[fileName]) return FILENAME_LANG_MAP[fileName];
        const ext = '.' + fileName.split('.').pop().toLowerCase();
        return EXT_LANG_MAP[ext] || 'plain';
    }

    function getLanguageExtension(lang) {
        const CM = window.CM6;
        if (!CM) return null;

        switch (lang) {
            case 'yaml': return CM.yaml ? CM.yaml() : null;
            case 'json': return CM.json ? CM.json() : null;
            case 'javascript': return CM.javascript ? CM.javascript() : null;
            case 'typescript': return CM.javascript ? CM.javascript({ typescript: true }) : null;
            case 'jsx': return CM.javascript ? CM.javascript({ jsx: true }) : null;
            case 'tsx': return CM.javascript ? CM.javascript({ jsx: true, typescript: true }) : null;
            case 'html': return CM.html ? CM.html() : null;
            case 'xml': return CM.xml ? CM.xml() : null;
            case 'css': return CM.css ? CM.css() : null;
            case 'markdown': return CM.markdown ? CM.markdown() : null;
            default: return null;
        }
    }

    function getLangDisplayName(lang) {
        const names = {
            yaml: 'YAML', json: 'JSON', javascript: 'JavaScript', typescript: 'TypeScript',
            jsx: 'JSX', tsx: 'TSX', html: 'HTML', xml: 'XML', css: 'CSS',
            markdown: 'Markdown', shell: 'Shell', python: 'Python', toml: 'TOML',
            ini: 'INI', docker: 'Docker', plain: 'Plain Text',
        };
        return names[lang] || lang;
    }

    // --- Linting ---
    function createLinter(lang) {
        const CM = window.CM6;
        if (!CM || !CM.linter) return null;

        if (lang === 'yaml') {
            return CM.linter(view => {
                const text = view.state.doc.toString();
                const diagnostics = [];
                if (!text.trim()) return diagnostics;
                try {
                    if (typeof jsyaml !== 'undefined') jsyaml.load(text);
                } catch (e) {
                    if (e.mark) {
                        const lineNum = Math.min(e.mark.line + 1, view.state.doc.lines);
                        const from = view.state.doc.line(lineNum).from;
                        diagnostics.push({ from, to: from + 1, severity: 'error', message: e.reason || e.message });
                    }
                }
                return diagnostics;
            });
        }

        if (lang === 'json') {
            return CM.linter(view => {
                const text = view.state.doc.toString();
                const diagnostics = [];
                if (!text.trim()) return diagnostics;
                try {
                    JSON.parse(text);
                } catch (e) {
                    const match = e.message.match(/position\s+(\d+)/i);
                    let from = 0;
                    if (match) from = Math.min(parseInt(match[1]), text.length - 1);
                    diagnostics.push({ from, to: from + 1, severity: 'error', message: e.message });
                }
                return diagnostics;
            });
        }

        return null;
    }

    // --- Terminal User Helper ---
    function getTerminalUser() {
        const userSelect = document.getElementById('terminal-user');
        let runAsUser = userSelect ? userSelect.value : 'ubuntu';
        if (runAsUser === 'custom') {
            const customUserInput = document.getElementById('custom-user');
            runAsUser = customUserInput ? customUserInput.value.trim() || 'ubuntu' : 'ubuntu';
        }
        return runAsUser;
    }

    // --- API Calls ---
    async function readFile(filePath, currentDir) {
        const res = await axios.post('/api/admin/terminal/read-file', {
            filePath, currentDir, runAsUser: getTerminalUser(),
        });
        return res.data;
    }

    async function writeFile(filePath, content) {
        const res = await axios.post('/api/admin/terminal/write-file', {
            filePath, content, runAsUser: getTerminalUser(),
        });
        return res.data;
    }

    async function chmodFile(filePath, permissions) {
        const res = await axios.post('/api/admin/terminal/chmod', {
            filePath, permissions, runAsUser: getTerminalUser(),
        });
        return res.data;
    }

    // --- Build Modal DOM ---
    function buildModal() {
        const overlay = document.createElement('div');
        overlay.className = 'file-editor-overlay';
        overlay.id = 'file-editor-overlay';

        overlay.innerHTML = `
            <div class="file-editor-modal">
                <div class="file-editor-header">
                    <div class="file-editor-title">
                        <span class="file-editor-filename" id="fe-filename"></span>
                        <span class="file-editor-lang-badge" id="fe-lang-badge"></span>
                        <span class="file-editor-path" id="fe-filepath"></span>
                    </div>
                    <button class="file-editor-close-btn" id="fe-close-btn" title="Close (Esc)">&times;</button>
                </div>
                <div class="file-editor-toolbar">
                    <div class="file-editor-permissions" id="fe-permissions">
                        <label>Perms:</label>
                        <span class="file-editor-perm-owner-group" id="fe-owner-group"></span>
                        <span class="file-editor-perm-symbolic" id="fe-perm-symbolic"></span>
                        <input type="text" class="file-editor-perm-octal-input" id="fe-perm-octal" maxlength="4" placeholder="644">
                        <button class="file-editor-perm-apply-btn" id="fe-perm-apply" title="Apply permissions">Apply</button>
                    </div>
                    <span class="file-editor-cursor-pos" id="fe-cursor-pos">Ln 1, Col 1</span>
                    <span class="file-editor-save-status" id="fe-save-status"></span>
                </div>
                <div class="file-editor-body" id="fe-editor-body">
                    <div class="file-editor-loading" id="fe-loading">
                        <div class="spinner"></div>
                        <span>Loading file...</span>
                    </div>
                </div>
                <div class="file-editor-footer">
                    <div class="file-editor-info">
                        <span id="fe-file-size"></span>
                        <span id="fe-mime-type"></span>
                    </div>
                    <div class="file-editor-actions">
                        <button class="file-editor-btn close" id="fe-btn-close">Close</button>
                        <button class="file-editor-btn save" id="fe-btn-save" disabled>Save</button>
                    </div>
                </div>
            </div>
        `;

        return overlay;
    }

    // --- Show Error in Body ---
    function showEditorError(errorCode, message) {
        const body = document.getElementById('fe-editor-body');
        if (!body) return;

        const icons = {
            NOT_FOUND: '🔍', IS_DIRECTORY: '📁', NO_READ_PERMISSION: '🔒',
            TOO_LARGE: '📦', BINARY: '🔣', UNKNOWN: '❌', PARSE_ERROR: '❌',
        };
        const hints = {
            NO_READ_PERMISSION: 'Try switching to root user in the terminal user dropdown.',
            TOO_LARGE: 'Files larger than 1MB cannot be edited in the browser.',
            BINARY: 'Binary files cannot be edited as text.',
        };

        body.innerHTML = `
            <div class="file-editor-error">
                <div class="file-editor-error-icon">${icons[errorCode] || '❌'}</div>
                <div class="file-editor-error-title">${errorCode === 'NOT_FOUND' ? 'File Not Found' : errorCode === 'IS_DIRECTORY' ? 'Cannot Edit Directory' : errorCode === 'NO_READ_PERMISSION' ? 'Permission Denied' : errorCode === 'TOO_LARGE' ? 'File Too Large' : errorCode === 'BINARY' ? 'Binary File' : 'Error'}</div>
                <div class="file-editor-error-message">${message}</div>
                ${hints[errorCode] ? `<div class="file-editor-error-hint">${hints[errorCode]}</div>` : ''}
            </div>
        `;

        // Disable save button
        const saveBtn = document.getElementById('fe-btn-save');
        if (saveBtn) saveBtn.disabled = true;
    }

    // --- Init CodeMirror ---
    function initEditor(content, lang) {
        const CM = window.CM6;
        const body = document.getElementById('fe-editor-body');
        if (!body) return;

        body.innerHTML = '';

        if (!CM || !CM.EditorView) {
            // Fallback: textarea
            const ta = document.createElement('textarea');
            ta.style.cssText = 'width:100%;height:100%;resize:none;padding:12px;font-family:monospace;font-size:13px;border:none;outline:none;background:var(--bg-primary);color:var(--text-primary);';
            ta.value = content;
            ta.addEventListener('input', () => {
                isDirty = ta.value !== originalContent;
                updateDirtyState();
            });
            body.appendChild(ta);
            return;
        }

        const isDark = document.documentElement.dataset.theme === 'dark' ||
                        document.documentElement.dataset.theme === 'midnight';

        const extensions = [
            CM.basicSetup,
            CM.keymap.of([
                { key: 'Mod-s', run: () => { save(); return true; } },
                { key: 'Mod-Shift-z', run: CM.redo },
            ]),
            CM.EditorView.updateListener.of(update => {
                if (update.docChanged) {
                    isDirty = update.state.doc.toString() !== originalContent;
                    updateDirtyState();
                }
                // Cursor position
                const cursor = update.state.selection.main.head;
                const line = update.state.doc.lineAt(cursor);
                const col = cursor - line.from + 1;
                const posEl = document.getElementById('fe-cursor-pos');
                if (posEl) posEl.textContent = `Ln ${line.number}, Col ${col}`;
            }),
            CM.EditorView.theme({
                '&': { height: '100%' },
                '.cm-scroller': { overflow: 'auto', fontFamily: "'Courier New', Courier, monospace", fontSize: '13px' },
                '.cm-content': { caretColor: 'var(--text-primary)' },
                '.cm-gutters': { background: 'var(--bg-primary)', color: 'var(--text-tertiary)', border: 'none', borderRight: '1px solid var(--border-color)' },
                '.cm-activeLineGutter': { background: 'var(--bg-surface)' },
                '.cm-activeLine': { background: 'rgba(37, 99, 235, 0.05)' },
                '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': { background: 'rgba(37, 99, 235, 0.15) !important' },
                '.cm-cursor': { borderLeftColor: 'var(--text-primary)' },
            }, { dark: isDark }),
        ];

        // Theme
        if (isDark && CM.oneDark) extensions.push(CM.oneDark);

        // Language
        const langExt = getLanguageExtension(lang);
        if (langExt) extensions.push(langExt);

        // Linting
        const lint = createLinter(lang);
        if (lint) {
            extensions.push(lint);
            if (CM.lintGutter) extensions.push(CM.lintGutter());
        }

        editorView = new CM.EditorView({
            doc: content,
            extensions,
            parent: body,
        });
    }

    // --- Dirty State ---
    function updateDirtyState() {
        const filenameEl = document.getElementById('fe-filename');
        const saveBtn = document.getElementById('fe-btn-save');

        if (filenameEl) {
            if (isDirty) filenameEl.classList.add('dirty');
            else filenameEl.classList.remove('dirty');
        }
        if (saveBtn) saveBtn.disabled = !isDirty || isSaving;
    }

    // --- Save ---
    async function save() {
        if (!isDirty || isSaving) return;
        isSaving = true;

        const statusEl = document.getElementById('fe-save-status');
        const saveBtn = document.getElementById('fe-btn-save');
        if (statusEl) { statusEl.textContent = 'Saving...'; statusEl.className = 'file-editor-save-status saving'; }
        if (saveBtn) saveBtn.disabled = true;

        try {
            const content = editorView
                ? editorView.state.doc.toString()
                : document.querySelector('#fe-editor-body textarea')?.value || '';

            const result = await writeFile(currentFilePath, content);

            if (result.success) {
                originalContent = content;
                isDirty = false;
                currentSize = result.size || content.length;
                updateDirtyState();
                updateFileInfo();
                if (statusEl) { statusEl.textContent = 'Saved'; statusEl.className = 'file-editor-save-status saved'; }

                // Clear terminal sidebar cache so file list refreshes
                if (window.Panels && window.Panels.terminalSession) {
                    window.Panels.terminalSession.directoryCache.clear();
                }

                setTimeout(() => {
                    if (statusEl && statusEl.textContent === 'Saved') {
                        statusEl.textContent = '';
                        statusEl.className = 'file-editor-save-status';
                    }
                }, 3000);
            } else {
                if (statusEl) { statusEl.textContent = result.message || 'Save failed'; statusEl.className = 'file-editor-save-status error'; }
            }
        } catch (err) {
            if (statusEl) { statusEl.textContent = 'Save failed'; statusEl.className = 'file-editor-save-status error'; }
            console.error('File save error:', err);
        } finally {
            isSaving = false;
            updateDirtyState();
        }
    }

    // --- Chmod ---
    async function applyPermissions() {
        const octalInput = document.getElementById('fe-perm-octal');
        if (!octalInput) return;

        const perms = octalInput.value.trim();
        if (!/^[0-7]{3,4}$/.test(perms)) {
            octalInput.style.borderColor = 'var(--danger-color, #ef4444)';
            setTimeout(() => { octalInput.style.borderColor = ''; }, 2000);
            return;
        }

        try {
            const result = await chmodFile(currentFilePath, perms);
            if (result.success && result.permissions) {
                currentPermissions = { ...currentPermissions, ...result.permissions };
                updatePermissionsDisplay();
                const statusEl = document.getElementById('fe-save-status');
                if (statusEl) { statusEl.textContent = 'Permissions updated'; statusEl.className = 'file-editor-save-status saved'; }
                setTimeout(() => {
                    if (statusEl && statusEl.textContent === 'Permissions updated') {
                        statusEl.textContent = '';
                        statusEl.className = 'file-editor-save-status';
                    }
                }, 3000);
            } else {
                const statusEl = document.getElementById('fe-save-status');
                if (statusEl) { statusEl.textContent = result.message || 'Chmod failed'; statusEl.className = 'file-editor-save-status error'; }
            }
        } catch (err) {
            console.error('Chmod error:', err);
        }
    }

    // --- UI Updates ---
    function updatePermissionsDisplay() {
        if (!currentPermissions) return;
        const ownerGroup = document.getElementById('fe-owner-group');
        const symbolic = document.getElementById('fe-perm-symbolic');
        const octal = document.getElementById('fe-perm-octal');

        if (ownerGroup) ownerGroup.textContent = `${currentPermissions.owner}:${currentPermissions.group}`;
        if (symbolic) symbolic.textContent = currentPermissions.symbolic;
        if (octal) octal.value = currentPermissions.octal;
    }

    function updateFileInfo() {
        const sizeEl = document.getElementById('fe-file-size');
        const mimeEl = document.getElementById('fe-mime-type');

        if (sizeEl) {
            if (currentSize < 1024) sizeEl.textContent = `${currentSize} B`;
            else if (currentSize < 1048576) sizeEl.textContent = `${(currentSize / 1024).toFixed(1)} KB`;
            else sizeEl.textContent = `${(currentSize / 1048576).toFixed(1)} MB`;
        }
        if (mimeEl) mimeEl.textContent = currentMimeType;
    }

    // --- Close ---
    function close() {
        if (isDirty) {
            if (!confirm('You have unsaved changes. Close without saving?')) return;
        }

        const overlay = document.getElementById('file-editor-overlay');
        if (overlay) overlay.remove();

        if (editorView) {
            editorView.destroy();
            editorView = null;
        }

        // Reset state
        originalContent = '';
        currentFilePath = '';
        currentPermissions = null;
        currentMimeType = '';
        currentSize = 0;
        isDirty = false;
        isSaving = false;
    }

    // --- Open (Public API) ---
    async function open(fileName, currentDir) {
        // Remove any existing editor
        const existing = document.getElementById('file-editor-overlay');
        if (existing) existing.remove();

        // Build and show modal
        const overlay = buildModal();
        document.body.appendChild(overlay);

        // Wire up events
        document.getElementById('fe-close-btn').addEventListener('click', close);
        document.getElementById('fe-btn-close').addEventListener('click', close);
        document.getElementById('fe-btn-save').addEventListener('click', save);
        document.getElementById('fe-perm-apply').addEventListener('click', applyPermissions);

        // Escape key
        const escHandler = (e) => {
            if (e.key === 'Escape') {
                close();
                document.removeEventListener('keydown', escHandler);
            }
        };
        document.addEventListener('keydown', escHandler);

        // Click outside to close
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) close();
        });

        // Set header info
        const lang = detectLanguage(fileName);
        document.getElementById('fe-filename').textContent = fileName;
        document.getElementById('fe-lang-badge').textContent = getLangDisplayName(lang);

        // Load file
        try {
            const result = await readFile(fileName, currentDir);

            if (!result.success) {
                document.getElementById('fe-loading').style.display = 'none';
                showEditorError(result.errorCode || 'UNKNOWN', result.message);
                document.getElementById('fe-filepath').textContent = currentDir + '/' + fileName;
                return;
            }

            // Store state
            originalContent = result.content;
            currentFilePath = result.filePath;
            currentPermissions = result.permissions;
            currentMimeType = result.mimeType;
            currentSize = result.size;
            isDirty = false;

            // Update UI
            document.getElementById('fe-filepath').textContent = result.filePath;
            updatePermissionsDisplay();
            updateFileInfo();

            // Init editor
            initEditor(result.content, lang);

        } catch (err) {
            document.getElementById('fe-loading').style.display = 'none';
            showEditorError('UNKNOWN', err.message || 'Failed to load file');
            console.error('File editor open error:', err);
        }
    }

    // --- Public API ---
    window.FileEditor = { open };
})();
