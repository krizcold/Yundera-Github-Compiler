// Repository Management System
class RepoManager {
    constructor() {
        this.repos = [];
        this.currentEditingRepo = null;
        this.authHash = this.getAuthHashFromUrl();
        this.globalSettings = {
            globalApiUpdatesEnabled: true,
            defaultAutoUpdateInterval: 60,
            maxConcurrentBuilds: 2,
            puid: "1000",
            pgid: "1000",
            refDomain: "local.casaos.io",
            refScheme: "http",
            refPort: "80",
            refSeparator: "-",
        };
        // State for the "new repository" row
        this.emptyRepoState = {
            name: '',
            type: 'github',
            url: ''
        };
        // State for URL editing
        this.urlEditState = {
            repoId: null,
            originalUrl: null,
            newUrl: null,
            isEditing: false
        };
        this.activeOperations = new Set();
        // Protection mechanism for button state restoration
        this.protectedRepos = new Map(); // repoId -> timestamp when protection expires
        this.init();
    }

    // Strategic button disable system
    setCardDisabled(repoId, disabled = true) {
        const repoRow = document.querySelector(`[data-repo-id="${repoId}"]`);
        if (!repoRow) return;
        
        if (disabled) {
            repoRow.classList.add('disabled-card');
        } else {
            repoRow.classList.remove('disabled-card');
        }
    }

    setButtonLoading(buttonId, loadingText, loadingIcon) {
        const button = document.getElementById(buttonId);
        if (!button) return null;
        
        const originalData = {
            innerHTML: button.innerHTML,
            disabled: button.disabled
        };
        
        button.disabled = true;
        button.innerHTML = `<i class="fas ${loadingIcon}"></i> ${loadingText}`;
        
        return originalData;
    }

    restoreButton(buttonId, originalData) {
        const button = document.getElementById(buttonId);
        if (!button || !originalData) return;
        
        button.innerHTML = originalData.innerHTML;
        button.disabled = originalData.disabled;
    }

    startOperation(operationId) {
        if (this.activeOperations.has(operationId)) {
            return false;
        }
        this.activeOperations.add(operationId);
        return true;
    }

    endOperation(operationId) {
        this.activeOperations.delete(operationId);
    }

    // Protect repository from automatic UI overwrites for a short period
    protectRepoFromRefresh(repoId, durationMs = 5000) {
        const expirationTime = Date.now() + durationMs;
        this.protectedRepos.set(repoId, expirationTime);
        console.log(`🛡️ Protected repo ${repoId} from refresh for ${durationMs}ms`);
    }

    // Check if repository is currently protected from refresh
    isRepoProtected(repoId) {
        const expirationTime = this.protectedRepos.get(repoId);
        if (!expirationTime) return false;

        if (Date.now() > expirationTime) {
            // Protection expired, remove it
            this.protectedRepos.delete(repoId);
            return false;
        }
        return true;
    }

    getAuthHashFromUrl() {
        const urlParams = new URLSearchParams(window.location.search);
        return urlParams.get('hash');
    }

    // Legacy function - kept for backward compatibility but should not be used for new code
    addAuthToRequest(data = {}) {
        if (this.authHash) {
            data.hash = this.authHash;
        }
        return data;
    }

    // New helper function - adds hash to URL parameters (nginx can see this)
    addHashToUrl(url) {
        if (!this.authHash) return url;
        const separator = url.includes('?') ? '&' : '?';
        return `${url}${separator}hash=${this.authHash}`;
    }

    init() {
        this.bindEvents();
        this.loadRepos();
        this.loadGlobalSettings();
        this.startAutoRefresh();
        this.checkFirstTimeUser();
    }

    startAutoRefresh() {
        // Refresh repository data every 20 seconds to catch external changes
        setInterval(async () => {
            try {
                await this.loadRepos();
            } catch (error) {
                console.error('Auto-refresh failed:', error);
            }
        }, 20000); // 20 seconds
    }

    bindEvents() {
        console.log('🔧 Binding events...');
        
        const checkUpdatesBtn = document.getElementById('check-updates-btn');
        if (checkUpdatesBtn) {
            checkUpdatesBtn.addEventListener('click', () => this.checkAllUpdates());
        }

        const settingsBtn = document.getElementById('settings-btn');
        if (settingsBtn) {
            settingsBtn.addEventListener('click', () => this.openSettingsModal());
        }
        
        const saveSettingsBtn = document.getElementById('save-settings-btn');
        if (saveSettingsBtn) {
            saveSettingsBtn.addEventListener('click', () => this.saveGlobalSettings());
        }
        
        const terminalBtn = document.getElementById('terminal-btn');
        if (terminalBtn) {
            terminalBtn.addEventListener('click', () => this.openInteractiveTerminal());
        }
        
        const logsBtn = document.getElementById('logs-btn');
        if (logsBtn) {
            logsBtn.addEventListener('click', () => {
                console.log('🔍 Service Logs button clicked');
                this.openServiceLogs();
            });
        }
        
        console.log('✅ Events bound successfully');

        document.querySelectorAll('.modal').forEach(modal => {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    this.closeModal(modal.id);
                }
            });
        });
    }

    async loadRepos() {
        try {
            const url = this.addHashToUrl('/api/admin/repos');
            const response = await axios.get(url);
            this.repos = response.data.repos || [];
            
            // Render first, then reapply disabled states (prevents HTML regeneration from wiping CSS classes)
            this.renderReposPreservingFocus();
            this.reapplyDisabledStates();
        } catch (error) {
            console.error('Failed to load repositories:', error);
            this.repos = [];
            this.renderReposPreservingFocus();
            this.reapplyDisabledStates();
        }
    }

    clearAllDisabledCards() {
        // Clear disabled states ONLY for cards that don't have active operations
        document.querySelectorAll('.repo-item[data-repo-id]').forEach(row => {
            const repoId = row.getAttribute('data-repo-id');
            if (repoId) {
                // Check if this repo has any active operations
                const hasActiveOperation = Array.from(this.activeOperations).some(opId => 
                    opId.includes(repoId) || opId.includes('empty')
                );
                
                // Only clear disabled state if no active operations
                if (!hasActiveOperation) {
                    this.setCardDisabled(repoId, false);
                }
            }
        });
    }

    clearDisabledCardForRepo(repoId) {
        // Force clear disabled state for a specific repo (used when operations complete)
        this.setCardDisabled(repoId, false);
    }

    reapplyDisabledStates() {
        // Reapply disabled states after HTML regeneration to restore visual states
        document.querySelectorAll('.repo-item[data-repo-id]').forEach(row => {
            const repoId = row.getAttribute('data-repo-id');
            if (repoId) {
                // Check if this repo has any active operations
                const hasActiveOperation = Array.from(this.activeOperations).some(opId => 
                    opId.includes(repoId) || opId.includes('empty')
                );
                
                // Reapply disabled state if there are active operations
                if (hasActiveOperation) {
                    this.setCardDisabled(repoId, true);
                }
            }
        });
    }

    renderReposPreservingFocus() {
        // Check if user is typing in the empty repo form
        const emptyRepoInput = document.querySelector('.repo-item:last-child input[type="text"]');
        const isUserTyping = emptyRepoInput && document.activeElement === emptyRepoInput;
        
        if (isUserTyping) {
            // User is typing - update only the existing repos, not the empty form
            this.updateExistingRepos();
        } else {
            // Safe to do full re-render
            this.renderReposWithStatePreservation();
        }
    }

    updateExistingRepos() {
        const repoList = document.getElementById('repo-list');
        if (!repoList) return;
        
        // Remove all existing repo items (but keep the empty form)
        const existingRepoItems = repoList.querySelectorAll('.repo-item:not(:last-child)');
        existingRepoItems.forEach(item => item.remove());
        
        // Add updated repo items before the empty form
        const emptyForm = repoList.querySelector('.repo-item:last-child');
        this.repos.forEach((repo, index) => {
            const newRepoElement = this.createRepoElement(repo, index);
            repoList.insertBefore(newRepoElement, emptyForm);
        });
    }
    
    async syncAndReload() {
        try {
            await new Promise(resolve => setTimeout(resolve, 2000));
            await this.loadRepos();
        } catch (error) {
            console.error('Failed to sync and reload:', error);
            await this.loadRepos();
        }
    }


    async loadGlobalSettings() {
        try {
            const url = this.addHashToUrl('/api/admin/settings');
            const response = await axios.get(url);
            this.globalSettings = {
                globalApiUpdatesEnabled: response.data.globalApiUpdatesEnabled !== false,
                defaultAutoUpdateInterval: response.data.defaultAutoUpdateInterval || 60,
                maxConcurrentBuilds: response.data.maxConcurrentBuilds || 2
            };
            this.updateSettingsUI();
        } catch (error) {
            console.error('Failed to load global settings:', error);
        }
    }

    renderReposWithStatePreservation() {
        // Wrapper function that renders and preserves disabled states
        this.renderRepos();
        this.reapplyDisabledStates();
    }

    renderRepos() {
        const repoList = document.getElementById('repo-list');
        if (!repoList) return;
        
        repoList.innerHTML = '';

        this.repos.forEach((repo, index) => {
            repoList.appendChild(this.createRepoElement(repo, index));
        });

        // Always add the empty row at the end for creating new repos
        const emptyRepoData = {
            id: 'empty',
            ...this.emptyRepoState,
            isEmpty: true
        };
        repoList.appendChild(this.createRepoElement(emptyRepoData, -1));
    }

    createRepoElement(repo, index) {
        const isEmpty = repo.isEmpty || repo.id === 'empty';
        const repoId = repo.id;
        
        const div = document.createElement('div');
        div.className = 'repo-item';
        div.setAttribute('data-repo-id', repoId);

        const repoUrl = repo.url || '';
        const repoType = repo.type || 'github';
        const status = repo.status || 'idle';
        const autoUpdate = repo.autoUpdate || false;
        const isInstalled = repo.isInstalled || false;
        const installationStatus = this.getInstallationStatus(repo);
        const lastBuildTime = repo.lastBuildTime ? this.formatDate(repo.lastBuildTime) : 'Never';
        const hasCompose = status !== 'empty' && status !== 'idle' && status !== 'importing';

        let displayName = repo.displayName || repo.name || (repoType === 'github' ? 'New GitHub App' : 'New Compose App');
        // Keep constant name for empty repos - don't extract from URL

        const nameHTML = `<h3 class="repo-name">${displayName}</h3>`;

        const typeDropdownHTML = `
            <select onchange="repoManager.handleTypeChange('empty', this.value)" ${!isEmpty ? 'disabled' : ''}>
                <option value="github" ${repoType === 'github' ? 'selected' : ''}>GitHub Repository</option>
                <option value="compose" ${repoType === 'compose' ? 'selected' : ''}>Docker Compose</option>
            </select>`;

        const updateStatus = this.getUpdateStatus(repo);
        const updateStatusHTML = updateStatus.status !== 'none' ? `
            <div class="update-status-container">
                <div class="update-status update-status-${updateStatus.status}" title="${updateStatus.version}" ${updateStatus.status === 'unknown' ? `onclick="repoManager.checkSingleRepoUpdate('${repoId}')"` : ''}>
                    ${updateStatus.display}
                </div>
                ${(updateStatus.status === 'unknown' || updateStatus.showRefreshButton) ? `
                    <button class="update-refresh-btn" title="Check for updates" onclick="repoManager.checkSingleRepoUpdate('${repoId}')">
                        <i class="fas fa-sync-alt"></i>
                    </button>
                ` : ''}
            </div>
        ` : '';

        const statusInfoHTML = `
            <div class="status-info">
                <div style="display: flex; align-items: center; gap: 8px;">
                    <span class="installation-badge installation-${installationStatus.status.split('-')[0]}">
                        ${installationStatus.label}
                    </span>
                    ${repo.installMismatch ? '<span class="warning-triangle" title="App is listed as installed but not found in CasaOS. It may have been removed manually."><i class="fas fa-exclamation-triangle"></i></span>' : ''}
                </div>
                ${updateStatusHTML}
                ${updateStatus.version ? `<div class="version-info">${updateStatus.version}</div>` : ''}
                <div>Last Action: ${lastBuildTime}</div>
            </div>
        `;

        div.innerHTML = `
            <div class="repo-icon-section">
                <div class="repo-icon">
                    ${this.getRepoIcon(repo)}
                </div>
                ${this.renderAppToggle(repo, repoId, isInstalled)}
            </div>
            <div class="repo-info">
                <div class="repo-details">
                    ${nameHTML}
                    <div class="repo-type-selector">
                        ${typeDropdownHTML}
                    </div>
                    <div class="repo-url" style="${repoType === 'compose' ? 'display: none;' : 'display: flex;'}">
                        <input type="text"
                               id="url-input-${repoId}"
                               placeholder="https://github.com/username/repository.git"
                               value="${repoUrl}"
                               oninput="repoManager.handleUrlChange('${repoId}', this.value)"
                               ${!isEmpty && !(this.urlEditState.isEditing && this.urlEditState.repoId === repoId) ? 'disabled' : ''}>
                        ${!isEmpty && repoType === 'github' ? `
                            ${!(this.urlEditState.isEditing && this.urlEditState.repoId === repoId) ? `
                                <button id="url-lock-btn-${repoId}"
                                        class="url-lock-btn"
                                        onclick="repoManager.toggleUrlEdit('${repoId}')"
                                        title="Edit URL">
                                    <i class="fas fa-lock"></i>
                                </button>
                            ` : `
                                <button class="url-save-btn" onclick="repoManager.saveUrlChange('${repoId}')" title="Save URL">
                                    <i class="fas fa-check"></i>
                                </button>
                                <button class="url-cancel-btn" onclick="repoManager.cancelUrlEdit('${repoId}')" title="Cancel">
                                    <i class="fas fa-times"></i>
                                </button>
                            `}
                        ` : ''}
                    </div>
                </div>
                <div class="repo-settings">
                    <div class="setting-row">
                        <label>Auto-Update:</label>
                        <div class="switch ${autoUpdate ? 'active' : ''}" onclick="repoManager.toggleRepoAutoUpdate('${repoId}')" ${isEmpty || repoType === 'compose' ? 'disabled' : ''}>
                            <div class="switch-slider"></div>
                        </div>
                    </div>
                    <div class="setting-row">
                        <label>Interval (min):</label>
                        <input type="number" min="5" max="10080" value="${repo.autoUpdateInterval || 60}" 
                               onchange="repoManager.updateRepoSettings('${repoId}', { autoUpdateInterval: this.value })" 
                               ${!autoUpdate || isEmpty || repoType === 'compose' ? 'disabled' : ''}>
                    </div>
                    <div class="setting-row">
                        <label>API Updates:</label>
                        <div class="switch ${repo.apiUpdatesEnabled !== false ? 'active' : ''}" onclick="repoManager.toggleRepoApiUpdates('${repoId}')" ${isEmpty || repoType === 'compose' ? 'disabled' : ''}>
                            <div class="switch-slider"></div>
                        </div>
                    </div>
                </div>
                ${statusInfoHTML}
            </div>
            <div class="repo-actions">
                ${this.renderActionButton(repo, repoId)}
                <button class="btn btn-small btn-secondary" 
                        title="View/Edit Docker Compose" 
                        onclick="repoManager.viewCompose('${repoId}')"
                        ${isEmpty || !hasCompose ? 'disabled' : ''}>
                    <i class="fas fa-file-code"></i>
                </button>
                <button class="btn btn-small btn-secondary" 
                        title="View App Terminal" 
                        onclick="repoManager.openAppLogs('${repoId}')"
                        ${isEmpty || !isInstalled ? 'disabled' : ''}>
                    <i class="fas fa-terminal"></i>
                </button>
                <button class="btn btn-small btn-warning" 
                        title="Remove Repository" 
                        onclick="repoManager.removeRepo('${repoId}')"
                        style="${isEmpty ? 'display: none;' : ''}">
                    <i class="fas fa-trash"></i>
                </button>
            </div>
        `;

        return div;
    }

    extractRepoName(url) {
        if (!url) return '';
        try {
            const path = new URL(url).pathname;
            return path.replace(/\.git$/, '').split('/').pop() || '';
        } catch (e) {
            const parts = url.replace(/\.git$/, '').split('/');
            const lastPart = parts.pop() || '';
            const repoPart = lastPart.split(':').pop() || '';
            return repoPart;
        }
    }

    formatDate(dateString) {
        if (!dateString) return 'Never';
        return new Date(dateString).toLocaleString();
    }

    capitalizeFirst(str) {
        if (!str) return '';
        return str.charAt(0).toUpperCase() + str.slice(1);
    }

    getUpdateStatus(repo) {
        if (!repo || repo.type !== 'github' || !repo.url) {
            return { status: 'none', display: '', version: '' };
        }

        const hasVersions = repo.currentVersion && repo.latestVersion;
        if (!hasVersions) {
            return { status: 'unknown', display: 'Check for updates', version: '' };
        }

        const isUpToDate = repo.currentVersion === repo.latestVersion;
        const lastChecked = repo.lastUpdateCheck ? new Date(repo.lastUpdateCheck).toLocaleTimeString('en-US', {
            hour: '2-digit', minute: '2-digit', hour12: false
        }) : '';

        if (isUpToDate) {
            return {
                status: 'uptodate',
                display: '✅ Up to date',
                version: `${repo.currentVersion} • ${lastChecked}`,
                showRefreshButton: true // Allow re-checking even when up to date
            };
        } else {
            const behindText = repo.commitsBehind > 0 ? ` (${repo.commitsBehind} commits behind)` : '';
            return {
                status: 'available',
                display: '🔄 Update available',
                version: `${repo.currentVersion} → ${repo.latestVersion}${behindText} • ${lastChecked}`,
                showRefreshButton: true // Allow re-checking when updates available
            };
        }
    }

    hasUpdatesAvailable(repo) {
        if (!repo || repo.type !== 'github' || !repo.url) return false;
        return repo.currentVersion && repo.latestVersion && repo.currentVersion !== repo.latestVersion;
    }

    getInstallationStatus(repo) {
        if (!repo || repo.id === 'empty') return { status: 'uninstalled', label: 'Not Created' };
        
        const { status, isInstalled, statusMessage } = repo;

        if (status === 'installing' || status === 'building') {
            return { status: 'installing', label: statusMessage || `${this.capitalizeFirst(status)}...` };
        }
        if (status === 'uninstalling') return { status: 'uninstalling', label: 'Uninstalling...' };
        if (status === 'starting') return { status: 'starting', label: 'Starting...' };
        if (status === 'stopping') return { status: 'stopping', label: 'Stopping...' };
        
        if (isInstalled) return { status: 'installed', label: 'Installed' };
        
        if (status === 'imported') return { status: 'imported', label: 'Ready to Install' };
        if (status === 'error') return { status: 'error', label: statusMessage || 'Action Failed' };
        
        return { status: 'uninstalled', label: 'Not Installed' };
    }

    getRepoIcon(repo) {
        if (repo && repo.icon) return `<img src="${repo.icon}" alt="${repo.name}">`;
        return repo.type === 'compose' ? '<i class="fab fa-docker"></i>' : '<i class="fab fa-github"></i>';
    }

    renderAppToggle(repo, repoId, isInstalled) {
        const isRunning = repo && repo.isRunning;
        const isInTransition = repo && (repo.status === 'starting' || repo.status === 'stopping');
        const isDisabled = !isInstalled || repoId === 'empty' || isInTransition;
        
        let toggleClass = 'app-toggle';
        let label = 'OFF';
        
        if (isInTransition) {
            toggleClass += ' disabled';
            label = repo.status.toUpperCase();
        } else if (isDisabled) {
            toggleClass += ' disabled';
        } else if (isRunning) {
            toggleClass += ' running';
            label = 'ON';
        }
        
        const clickHandler = isDisabled ? '' : `onclick="repoManager.toggleApp('${repoId}')"`;
        let title = 'App must be installed first';
        if (isInTransition) title = `App is ${repo.status}...`;
        else if (!isDisabled) title = isRunning ? 'Click to stop app' : 'Click to start app';

        return `
            <div style="display: flex; flex-direction: column; align-items: center;">
                <div class="${toggleClass}" ${clickHandler} title="${title}" id="app-toggle-${repoId}">
                    <div class="app-toggle-slider"></div>
                </div>
                <div class="app-toggle-label">${label}</div>
            </div>
        `;
    }

    renderActionButton(repo, repoId) {
        const isEmpty = repo.id === 'empty';

        if (isEmpty) {
            const { url, type } = this.emptyRepoState;
            let isDisabled;
            if (type === 'github') {
                isDisabled = !url;
            } else { // compose
                isDisabled = false; // Always enabled for compose type
            }
            const title = type === 'github' ? 'Import from URL' : 'Create from Compose';
            const action = type === 'github' ? `repoManager.importRepo('empty')` : `repoManager.createComposeRepo()`;
            const icon = type === 'github' ? 'fa-download' : 'fa-plus';
            return `<button class="btn btn-small btn-primary" title="${title}" onclick="${action}" ${isDisabled ? 'disabled' : ''}><i class="fas ${icon}"></i></button>`;
        }
        
        switch (repo.status) {
            case 'importing':
            case 'building':
            case 'installing':
                return `<button class="btn btn-small btn-primary" title="${this.capitalizeFirst(repo.status)}..." disabled><i class="fas fa-spinner fa-spin"></i></button>`;
            case 'imported':
                const buildText = repo.type === 'github' ? 'Build' : 'Install';
                return `<button class="btn btn-small btn-success" title="${buildText} Application" onclick="repoManager.buildRepo('${repoId}')"><i class="fas fa-cogs"></i></button>`;
            case 'success':
                if (repo.type === 'github') {
                    const hasUpdates = this.hasUpdatesAvailable(repo);
                    if (hasUpdates) {
                        return `<button class="btn btn-small btn-primary" title="Update Application" onclick="repoManager.buildRepo('${repoId}')"><i class="fas fa-download"></i></button>`;
                    } else {
                        return `<button class="btn btn-small btn-warning" title="Re-install" onclick="repoManager.reinstallRepo('${repoId}')"><i class="fas fa-sync-alt"></i></button>`;
                    }
                } else {
                    return `<button class="btn btn-small btn-warning" title="Re-install" onclick="repoManager.reinstallRepo('${repoId}')"><i class="fas fa-sync-alt"></i></button>`;
                }
            case 'error':
                const retryText = repo.type === 'github' ? 'Retry Build' : 'Retry Install';
                return `<button class="btn btn-small btn-danger" title="${retryText}" onclick="repoManager.buildRepo('${repoId}')"><i class="fas fa-redo"></i></button>`;
            case 'starting':
                return `<button class="btn btn-small btn-secondary" title="App Starting..." disabled><i class="fas fa-spinner fa-spin"></i></button>`;
            case 'stopping':
                return `<button class="btn btn-small btn-secondary" title="App Stopping..." disabled><i class="fas fa-spinner fa-spin"></i></button>`;
            case 'uninstalling':
                return `<button class="btn btn-small btn-secondary" title="Uninstalling..." disabled><i class="fas fa-spinner fa-spin"></i></button>`;
            default: // idle, empty
                const defaultActionText = repo.type === 'github' ? 'Import' : 'Install';
                const defaultIcon = repo.type === 'github' ? 'fa-download' : 'fa-cogs';
                const defaultAction = repo.type === 'github' ? `repoManager.importRepo('${repoId}')` : `repoManager.buildRepo('${repoId}')`;
                return `<button class="btn btn-small btn-primary" title="${defaultActionText}" onclick="${defaultAction}"><i class="fas ${defaultIcon}"></i></button>`;
        }
    }

    handleUrlChange(repoId, url) {
        if (repoId === 'empty') {
            this.emptyRepoState.url = url;
            // Update the display name without re-rendering the entire form
            this.updateEmptyRepoDisplayName();
        }
    }

    updateEmptyRepoDisplayName() {
        // Find the empty repo form by looking for the repo with id='empty'
        const emptyRepoItem = document.querySelector('.repo-item[data-repo-id="empty"]');
        if (!emptyRepoItem) return;
        
        const repoNameElement = emptyRepoItem.querySelector('.repo-name');
        const actionButton = emptyRepoItem.querySelector('.repo-actions button:first-child');
        
        // Keep display name constant - don't change it based on URL
        if (repoNameElement && this.emptyRepoState.type === 'github') {
            repoNameElement.textContent = 'New GitHub App';
        }
        
        // Update button state (for GitHub repos, disabled when no URL)
        if (actionButton && this.emptyRepoState.type === 'github') {
            const shouldDisable = !this.emptyRepoState.url.trim();
            actionButton.disabled = shouldDisable;
        }
    }
    
    handleTypeChange(repoId, type) {
        if (repoId === 'empty') {
            this.emptyRepoState.type = type;
            this.renderReposWithStatePreservation();
        }
    }
    
    createComposeRepo() {
        this.currentEditingRepo = 'new-compose';
        document.getElementById('yaml-textarea').value = '';
        this.openModal('yaml-modal');
    }

    async importRepo(repoId) {
        if (repoId !== 'empty') return;
        
        // Start import operation tracking
        const importOperationId = `import-empty`;
        if (!this.startOperation(importOperationId)) {
            this.showNotification('Import operation already in progress', 'warning');
            return;
        }
        
        this.disableActionButton('empty');
        this.setCardDisabled('empty', true);
        const { url } = this.emptyRepoState;
        const name = this.extractRepoName(url);

        if (!name) {
            this.showNotification('Could not determine repository name from URL.', 'error');
            this.enableActionButton('empty');
            this.clearDisabledCardForRepo('empty');
            this.endOperation(importOperationId);
            return;
        }

        try {
            const repo = await this.createNewRepo(name, url, 'github');
            
            if (!repo || !repo.id) {
                throw new Error('Repository creation failed - no repo ID returned');
            }
            
            this.emptyRepoState = { name: '', type: 'github', url: '' };
            await this.loadRepos();
            
            // Now trigger the actual import process for the newly created repo
            this.updateRepoStatus(repo.id, 'importing');
            this.setCardDisabled(repo.id, true);
            this.showNotification(`Importing ${repo.name}...`, 'info');
            
            const response = await axios.post(this.addHashToUrl(`/api/admin/repos/${repo.id}/import`), {});
            if (response.data.success) {
                this.showNotification(`${repo.name} imported successfully! Ready to build.`, 'success');
                // End the operation before loadRepos to prevent race condition
                this.endOperation(importOperationId);
                await this.loadRepos();
                return; // Skip the try/catch finally since we handled success here
            } else {
                throw new Error(response.data.message);
            }
        } catch (error) {
            this.showNotification(`Failed to import: ${error.message}`, 'error');
            this.enableActionButton('empty');
            this.clearDisabledCardForRepo('empty');
            if (error.repoId) {
                this.clearDisabledCardForRepo(error.repoId);
            }
            this.endOperation(importOperationId);
        }
    }

    async createNewRepo(name, url, type) {
        try {
            const response = await axios.post(this.addHashToUrl('/api/admin/repos'), {
                name, url, type,
                autoUpdate: false,
                autoUpdateInterval: 60,
                apiUpdatesEnabled: true,
                status: 'empty'
            });
            if (response.data.success) return response.data.repo;
            throw new Error(response.data.message);
        } catch (error) {
            const message = error.response?.data?.message || error.message || 'Unknown error';
            throw new Error(message);
        }
    }

    async reinstallRepo(repoId) {
        const repo = this.repos.find(r => r.id === repoId);
        if (!repo) return;

        const result = await this.showReinstallConfirmation(repo);
        if (!result || !result.proceed) {
            return;
        }

        if (result.deleteData) {
            try {
                await axios.post(this.addHashToUrl(`/api/admin/repos/${repoId}/reinstall/delete-data`));
                this.showNotification('Application data deleted successfully', 'success');
            } catch (error) {
                this.showNotification('Failed to delete application data: ' + (error.response?.data?.message || error.message), 'error');
                return;
            }
        }

        await this.buildRepo(repoId, result.runPreInstall);
    }

    async buildRepo(repoId, runPreInstall = false) {
        const repo = this.repos.find(r => r.id === repoId);
        if (!repo) return;

        const action = repo.type === 'github' ? 'building' : 'installing';
        this.updateRepoStatus(repoId, action);

        let selectedUser = 'ubuntu';

        try {
            let updateResult = null;
            if (repo.type === 'github' && repo.isInstalled && repo.rawDockerCompose) {
                updateResult = await this.showUpdateAvailablePopup(repo);
                if (!updateResult || !updateResult.proceed) {
                    // User cancelled - restore button state
                    this.updateRepoStatus(repoId, repo.status || 'ready');
                    return;
                }

                // Apply environment variable transfer if requested and compose was changed
                if (updateResult.transferEnvs && updateResult.newCompose && updateResult.oldCompose) {
                    try {
                        console.log('🔄 Applying environment variable transfer before build...');
                        const transferredCompose = this.transferEnvironmentVariables(updateResult.oldCompose, updateResult.newCompose);

                        // Update the stored compose with the transferred version
                        await axios.put(this.addHashToUrl(`/api/admin/repos/${repoId}/compose`), {
                            yaml: transferredCompose
                        });
                    } catch (error) {
                        console.error('❌ CRITICAL: Failed to transfer environment variables:', error);
                        this.showNotification('Error: Failed to transfer environment variables. Update aborted to prevent breaking the application.', 'error');
                        // ABORT THE UPDATE - restore button state and return
                        this.updateRepoStatus(repoId, repo.status || 'ready');
                        return;
                    }
                }
            }

            // Check if this repo has pre-install commands and show warning (only for first installation)
            const hasPreInstall = await this.checkForPreInstallCommand(repoId);
            if (hasPreInstall && !repo.isInstalled) {
                // Only show warning for first installation, not updates
                const warningResult = await this.showPreInstallWarning(repo, hasPreInstall);
                if (!warningResult || !warningResult.proceed) {
                    // User cancelled - restore button state
                    this.updateRepoStatus(repoId, repo.status || 'ready');
                    return;
                }
                selectedUser = warningResult.runAsUser;
            }
        } catch (error) {
            // On any error during dialogs, restore button state
            console.error('Error during build repo dialogs:', error);
            this.updateRepoStatus(repoId, repo.status || 'ready');
            return;
        }
        
        // Open terminal log popup
        this.openTerminalPopup(repo.name, repoId, action);

        try {
            await axios.post(this.addHashToUrl(`/api/admin/repos/${repoId}/compile`), { runAsUser: selectedUser, runPreInstall });
            console.log(`[${repo.name}] ${action} process initiated via Dashboard.`);

            // Refresh the UI immediately after successful initiation, then again after a delay
            setTimeout(() => this.loadRepos(), 1000);
            setTimeout(() => this.loadRepos(), 3000);
            setTimeout(() => this.loadRepos(), 6000);
        } catch (error) {
            const errorMessage = error.response?.data?.message || error.message;
            this.showNotification(`${this.capitalizeFirst(action)} failed to start: ${errorMessage}`, 'error');
            
            // Revert status on immediate failure
            const repoToUpdate = this.repos.find(r => r.id === repoId);
            if (repoToUpdate) {
                repoToUpdate.status = 'error';
                repoToUpdate.statusMessage = 'Failed to start';
            }
            this.renderReposWithStatePreservation();
        }
    }


    async viewCompose(repoId) {
        try {
            const response = await axios.get(this.addHashToUrl(`/api/admin/repos/${repoId}/compose`));
            this.currentEditingRepo = repoId;
            document.getElementById('yaml-textarea').value = response.data.yaml || '';
            this.openModal('yaml-modal');
        } catch (error) {
            this.showNotification('Failed to load Docker Compose file', 'error');
        }
    }

    async toggleApp(repoId) {
        const repo = this.repos.find(r => r.id === repoId);
        if (!repo || !repo.isInstalled) return;

        // Check if operation is already active
        const operationId = `toggle-${repoId}`;
        if (!this.startOperation(operationId)) {
            this.showNotification('App toggle operation already in progress', 'warning');
            return;
        }

        const action = repo.isRunning ? 'stop' : 'start';
        const actioningState = action === 'stop' ? 'stopping' : 'starting';
        
        // Set loading states
        this.updateRepoStatus(repoId, actioningState);
        this.renderReposWithStatePreservation();
        
        try {
            const response = await axios.post(this.addHashToUrl(`/api/admin/repos/${repoId}/toggle`), { start: !repo.isRunning });
            if (response.data.success) {
                this.showNotification(`Application ${action}ed successfully`, 'success');
                // End operation before loadRepos to prevent race condition
                this.endOperation(operationId);
                await this.loadRepos();
                return; // Skip the finally block since we handled it here
            } else {
                throw new Error(response.data.message);
            }
        } catch (error) {
            this.showNotification(`Error ${action}ing application: ${error.response?.data?.message || error.message}`, 'error');
            
            // Revert states on error - use force clear to override operation check
            this.updateRepoStatus(repoId, 'error');
            this.clearDisabledCardForRepo(repoId);
            this.renderReposWithStatePreservation();
            
            // Refresh after a delay to get actual status
            setTimeout(() => this.loadRepos(), 2000);
        } finally {
            // Always end the operation
            this.endOperation(operationId);
        }
    }

    async removeRepo(repoId) {
        const repo = this.repos.find(r => r.id === repoId);
        if (!repo) return;
        
        // Check if operation is already active BEFORE showing confirmation
        const operationId = `remove-${repoId}`;
        if (!this.startOperation(operationId)) {
            this.showNotification('Remove operation already in progress', 'warning');
            return;
        }
        
        // Disable the entire card for critical uninstall operations
        this.setCardDisabled(repoId, true);
        
        try {
            const result = await this.showUninstallConfirmation(repo);
            if (!result.proceed) {
                // User cancelled, restore the card and end the operation
                this.setCardDisabled(repoId, false);
                this.endOperation(operationId);
                return;
            }

            try {
                const url = `/api/admin/repos/${repoId}`;
                const response = await axios.delete(this.addHashToUrl(url), { data: { preserveData: result.preserveData } });
                // End operation before loadRepos to prevent race condition with successful removal
                this.endOperation(operationId);
                await this.loadRepos();
                this.showNotification(response.data.message || 'Repository removed successfully', 'success');
                return; // Skip finally block since we handled operation end here
            } catch (error) {
                const errorMessage = error.response?.data?.message || error.message || 'Unknown error occurred';
                this.showNotification(`Failed to remove repository: ${errorMessage}`, 'error');
                
                // Revert loading state and card on error - use force clear to override operation check
                this.clearDisabledCardForRepo(repoId);
                this.updateRepoStatus(repoId, 'error');
                this.renderReposWithStatePreservation();
                // Refresh after delay to get actual status
                setTimeout(() => this.loadRepos(), 2000);
            }
        } catch (error) {
            // Handle any errors during confirmation dialog
            this.clearDisabledCardForRepo(repoId);
            this.updateRepoStatus(repoId, 'error');
            this.renderReposWithStatePreservation();
        } finally {
            // Always end the operation
            this.endOperation(operationId);
        }
    }

    async updateRepoSettings(repoId, settings) {
        if (repoId === 'empty') return;
        if (Object.keys(settings).length === 0) return;

        try {
            const response = await axios.put(this.addHashToUrl(`/api/admin/repos/${repoId}`), settings);
            if (response.data.success) {
                await this.loadRepos();
            } else {
                throw new Error(response.data.message);
            }
        } catch (error) {
            this.showNotification('Failed to update repository setting', 'error');
        }
    }

    async toggleRepoAutoUpdate(repoId) {
        const repo = this.repos.find(r => r.id === repoId);
        if (!repo || repo.id === 'empty') return;
        await this.updateRepoSettings(repoId, { autoUpdate: !repo.autoUpdate });
    }

    async toggleRepoApiUpdates(repoId) {
        const repo = this.repos.find(r => r.id === repoId);
        if (!repo || repo.id === 'empty') return;
        await this.updateRepoSettings(repoId, { apiUpdatesEnabled: !repo.apiUpdatesEnabled });
    }

    // URL Editing Functions
    toggleUrlEdit(repoId) {
        const repo = this.repos.find(r => r.id === repoId);
        if (!repo || repo.id === 'empty') return;

        if (this.urlEditState.isEditing && this.urlEditState.repoId === repoId) {
            // Already editing, do nothing (user should use save or cancel)
            return;
        }

        // Start editing mode
        this.urlEditState = {
            repoId: repoId,
            originalUrl: repo.url,
            newUrl: repo.url,
            isEditing: true
        };

        // Re-render to show edit controls
        this.renderReposWithStatePreservation();
    }

    cancelUrlEdit(repoId) {
        // Reset edit state
        this.urlEditState = {
            repoId: null,
            originalUrl: null,
            newUrl: null,
            isEditing: false
        };

        // Re-render to hide edit controls and restore original URL
        this.renderReposWithStatePreservation();
    }

    async saveUrlChange(repoId) {
        const repo = this.repos.find(r => r.id === repoId);
        if (!repo || repo.id === 'empty') return;

        const urlInput = document.getElementById(`url-input-${repoId}`);
        if (!urlInput) return;

        const newUrl = urlInput.value.trim();
        const oldUrl = this.urlEditState.originalUrl;

        // Check if URL actually changed
        if (newUrl === oldUrl) {
            this.showNotification('URL unchanged', 'info');
            this.cancelUrlEdit(repoId);
            return;
        }

        // Validate URL format
        if (!newUrl || newUrl === '') {
            this.showNotification('URL cannot be empty', 'error');
            return;
        }

        // Store the new URL for validation
        this.urlEditState.newUrl = newUrl;

        // Validate the new URL
        try {
            const validationResult = await this.validateGithubUrl(newUrl, oldUrl);

            if (validationResult.needsWarning) {
                // Show warning modal
                this.showUrlWarningModal(repoId, oldUrl, newUrl, validationResult.message);
            } else {
                // URL is safe, proceed with update
                await this.performUrlUpdate(repoId, newUrl);
            }
        } catch (error) {
            this.showNotification(`Failed to validate URL: ${error.message}`, 'error');
        }
    }

    async validateGithubUrl(newUrl, oldUrl) {
        try {
            // Basic URL format validation
            let urlObj;
            try {
                urlObj = new URL(newUrl);
            } catch (e) {
                return {
                    needsWarning: true,
                    message: 'Invalid URL format. The URL does not appear to be valid.'
                };
            }

            // Check if it's a GitHub URL
            if (!newUrl.includes('github.com')) {
                return {
                    needsWarning: true,
                    message: 'This does not appear to be a GitHub URL. Please verify this is the correct repository.'
                };
            }

            // Extract repository info from URLs
            const extractRepoInfo = (url) => {
                try {
                    const urlObj = new URL(url);
                    const pathParts = urlObj.pathname.split('/').filter(p => p);
                    if (pathParts.length >= 2) {
                        return {
                            owner: pathParts[0],
                            repo: pathParts[1].replace('.git', '')
                        };
                    }
                } catch (e) {
                    return null;
                }
                return null;
            };

            const oldRepo = extractRepoInfo(oldUrl);
            const newRepo = extractRepoInfo(newUrl);

            // Check if it's a different project
            if (oldRepo && newRepo) {
                const isDifferentOwner = oldRepo.owner !== newRepo.owner;
                const isDifferentRepo = oldRepo.repo !== newRepo.repo;

                if (isDifferentOwner || isDifferentRepo) {
                    let message = 'The new URL points to a DIFFERENT project. ';
                    if (isDifferentOwner && isDifferentRepo) {
                        message += `You are changing from "${oldRepo.owner}/${oldRepo.repo}" to "${newRepo.owner}/${newRepo.repo}".`;
                    } else if (isDifferentOwner) {
                        message += `The repository owner is changing from "${oldRepo.owner}" to "${newRepo.owner}".`;
                    } else {
                        message += `The repository name is changing from "${oldRepo.repo}" to "${newRepo.repo}".`;
                    }
                    return {
                        needsWarning: true,
                        message: message
                    };
                }
            }

            // Try to check if URL is accessible (basic check)
            try {
                const response = await axios.get(this.addHashToUrl('/api/admin/validate-github-url'), {
                    params: { url: newUrl }
                });

                if (!response.data.success) {
                    return {
                        needsWarning: true,
                        message: response.data.message || 'Unable to access the GitHub repository. It may not exist, be private, or your GitHub PAT may be invalid/expired.'
                    };
                }
            } catch (error) {
                // If validation endpoint doesn't exist, skip this check
                console.warn('URL validation endpoint not available:', error);
            }

            // URL looks good
            return {
                needsWarning: false,
                message: 'URL is valid'
            };

        } catch (error) {
            return {
                needsWarning: true,
                message: `Validation error: ${error.message}`
            };
        }
    }

    showUrlWarningModal(repoId, oldUrl, newUrl, warningMessage) {
        const modal = document.getElementById('url-warning-modal');
        const messageEl = document.getElementById('url-warning-message');
        const currentUrlEl = document.getElementById('url-current');
        const newUrlEl = document.getElementById('url-new');

        messageEl.textContent = warningMessage;
        currentUrlEl.textContent = oldUrl;
        newUrlEl.textContent = newUrl;

        modal.style.display = 'block';
    }

    async confirmUrlChange() {
        const repoId = this.urlEditState.repoId;
        const newUrl = this.urlEditState.newUrl;

        // Close modal
        document.getElementById('url-warning-modal').style.display = 'none';

        // Perform the update
        await this.performUrlUpdate(repoId, newUrl);
    }

    cancelUrlChange() {
        // Close modal
        document.getElementById('url-warning-modal').style.display = 'none';

        // Reset URL input to original value
        if (this.urlEditState.repoId) {
            const urlInput = document.getElementById(`url-input-${this.urlEditState.repoId}`);
            if (urlInput && this.urlEditState.originalUrl) {
                urlInput.value = this.urlEditState.originalUrl;
            }
        }

        // Cancel edit mode
        this.cancelUrlEdit(this.urlEditState.repoId);
    }

    async performUrlUpdate(repoId, newUrl) {
        try {
            this.showNotification('Updating repository URL...', 'info');

            const response = await axios.put(this.addHashToUrl(`/api/admin/repos/${repoId}`), {
                url: newUrl
            });

            if (response.data.success) {
                this.showNotification('Repository URL updated successfully', 'success');

                // Reset edit state
                this.urlEditState = {
                    repoId: null,
                    originalUrl: null,
                    newUrl: null,
                    isEditing: false
                };

                // Reload repositories
                await this.loadRepos();
            } else {
                throw new Error(response.data.message || 'Failed to update URL');
            }
        } catch (error) {
            const errorMessage = error.response?.data?.message || error.message || 'Unknown error';
            this.showNotification(`Failed to update URL: ${errorMessage}`, 'error');
        }
    }

    openSettingsModal() {
        document.getElementById('global-api-updates').checked = this.globalSettings.globalApiUpdatesEnabled;
        document.getElementById('max-builds').value = this.globalSettings.maxConcurrentBuilds;
        document.getElementById('puid').value = this.globalSettings.puid;
        document.getElementById('pgid').value = this.globalSettings.pgid;
        document.getElementById('ref-domain').value = this.globalSettings.refDomain;
        this.openModal('settings-modal');
    }
    
    async saveGlobalSettings() {
        try {
            const newSettings = {
                ...this.globalSettings,
                globalApiUpdatesEnabled: document.getElementById('global-api-updates').checked,
                maxConcurrentBuilds: parseInt(document.getElementById('max-builds').value),
                puid: document.getElementById('puid').value,
                pgid: document.getElementById('pgid').value,
                refDomain: document.getElementById('ref-domain').value,
            };
            
            const response = await axios.put(this.addHashToUrl('/api/admin/settings'), newSettings);
            if (response.data.success) {
                this.globalSettings = newSettings;
                this.updateSettingsUI();
                this.closeModal('settings-modal');
                this.showNotification('Settings saved successfully', 'success');
            } else {
                throw new Error(response.data.message);
            }
        } catch (error) {
            this.showNotification('Failed to save settings', 'error');
        }
    }
    
    updateSettingsUI() {
        const apiStatus = document.getElementById('api-status');
        if (apiStatus) {
            apiStatus.textContent = this.globalSettings.globalApiUpdatesEnabled ? 'Enabled' : 'Disabled';
            apiStatus.className = this.globalSettings.globalApiUpdatesEnabled ? 'status-enabled' : 'status-disabled';
        }
    }

    async checkAllUpdates() {
        try {
            this.showNotification('Checking for updates...', 'info');
            console.log('🔍 Checking all updates - calling POST /api/admin/repos/check-updates');
            const response = await axios.post(this.addHashToUrl('/api/admin/repos/check-updates'), {});
            console.log('✅ Check all updates response:', response.data);
            if (response.data.success) {
                await this.loadRepos();
                this.showNotification('Update check completed', 'success');
            } else {
                this.showNotification(`Update check failed: ${response.data.message}`, 'error');
            }
        } catch (error) {
            console.error('❌ Check all updates failed:', error);
            console.error('Error details:', error.response?.data || error.message);
            this.showNotification(`Failed to check for updates: ${error.response?.data?.message || error.message}`, 'error');
        }
    }

    async checkSingleRepoUpdate(repoId) {
        try {
            const repo = this.repos.find(r => r.id === repoId);
            if (!repo) return;
            
            this.showNotification(`Checking updates for ${repo.name}...`, 'info');
            console.log(`🔍 Checking single repo update - calling GET /api/admin/repos/${repoId}/check-updates`);
            
            const url = this.addHashToUrl(`/api/admin/repos/${repoId}/check-updates`);
                
            const response = await axios.get(url);
            console.log('✅ Single repo update response:', response.data);
            
            if (response.data.success) {
                await this.loadRepos();
                const updateInfo = response.data.updateInfo;
                if (updateInfo.hasUpdates) {
                    this.showNotification(`${repo.name}: Update available (${updateInfo.commitsBehind} commits behind)`, 'success');
                } else {
                    this.showNotification(`${repo.name}: Up to date`, 'success');
                }
            } else {
                this.showNotification(`Update check failed: ${response.data.message}`, 'error');
            }
        } catch (error) {
            console.error('❌ Single repo update check failed:', error);
            console.error('Error details:', error.response?.data || error.message);
            this.showNotification(`Failed to check for updates: ${error.response?.data?.message || error.message}`, 'error');
        }
    }

    updateRepoStatus(repoId, status) {
        const repo = this.repos.find(r => r.id === repoId);
        if (repo) {
            // Check if this repo is protected from automatic updates
            if (this.isRepoProtected(repoId)) {
                console.log(`🛡️ Skipping status update for protected repo ${repoId} (${status})`);
                return;
            }

            repo.status = status;
            this.renderReposWithStatePreservation();
        }
    }
    
    disableActionButton(repoId) {
        const repo = this.repos.find(r => r.id === repoId);
        if (repo) {
            repo.status = 'loading';
        }
        this.renderReposWithStatePreservation();
    }
    
    enableActionButton(repoId) {
        this.loadRepos();
    }

    openModal(modalId) {
        document.getElementById(modalId).style.display = 'block';
    }

    closeModal(modalId) {
        document.getElementById(modalId).style.display = 'none';
        this.currentEditingRepo = null;
    }

    async saveYaml() {
        try {
            const yamlContent = document.getElementById('yaml-textarea').value;
            if (this.currentEditingRepo === 'new-compose') {
                // This is a new compose repo
                const response = await axios.post(this.addHashToUrl('/api/admin/repos/create-from-compose'), { yaml: yamlContent });
                if (response.data.success) {
                    this.showNotification(`Application '${response.data.repo.name}' created successfully.`, 'success');
                    await this.loadRepos();
                } else {
                    throw new Error(response.data.message);
                }
            } else if (this.currentEditingRepo) {
                // This is an existing repo
                await axios.put(this.addHashToUrl(`/api/admin/repos/${this.currentEditingRepo}/compose`), { yaml: yamlContent });
                this.showNotification('Docker Compose file saved successfully', 'success');
                await this.loadRepos();
            }
        } catch (error) {
            const message = error.response?.data?.message || 'Failed to save Docker Compose file';
            this.showNotification(message, 'error');
        }
        
        this.closeModal('yaml-modal');
    }

    openTerminalPopup(appName, repoId, action) {
        // Create terminal popup if it doesn't exist
        let terminal = document.getElementById('terminal-popup');
        if (terminal) {
            terminal.remove();
        }

        terminal = document.createElement('div');
        terminal.id = 'terminal-popup';
        terminal.innerHTML = `
            <div class="terminal-backdrop" onclick="this.parentElement.remove()"></div>
            <div class="terminal-container">
                <div class="terminal-header">
                    <div class="terminal-title">
                        <i class="fas fa-terminal"></i>
                        ${appName} - ${action.charAt(0).toUpperCase() + action.slice(1)} Logs
                    </div>
                    <div class="terminal-controls">
                        <button class="terminal-btn" onclick="document.getElementById('terminal-popup').remove()">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>
                </div>
                <div class="terminal-body">
                    <div class="terminal-content" id="terminal-content">
                        <div class="log-line system">🚀 Starting ${action} process for ${appName}...</div>
                        <div class="log-line system">📡 Connecting to build system...</div>
                    </div>
                </div>
                <div class="terminal-footer">
                    <div class="terminal-status">
                        <div class="status-indicator active"></div>
                        <span>Live streaming logs</span>
                    </div>
                </div>
            </div>
        `;

        // Add styles
        const style = document.createElement('style');
        style.textContent = `
            #terminal-popup {
                position: fixed;
                top: 0; left: 0; right: 0; bottom: 0;
                z-index: 9999;
                display: flex;
                align-items: center;
                justify-content: center;
                animation: fadeIn 0.2s ease;
            }
            
            .terminal-backdrop {
                position: absolute;
                top: 0; left: 0; right: 0; bottom: 0;
                background: rgba(0, 0, 0, 0.7);
                backdrop-filter: blur(4px);
            }
            
            .terminal-container {
                position: relative;
                width: 90%;
                max-width: 1000px;
                height: 70%;
                max-height: 600px;
                background: #1a1a1a;
                border-radius: 12px;
                border: 1px solid #333;
                display: flex;
                flex-direction: column;
                box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
            }
            
            .terminal-header {
                background: #2d2d2d;
                padding: 12px 16px;
                border-radius: 12px 12px 0 0;
                display: flex;
                justify-content: space-between;
                align-items: center;
                border-bottom: 1px solid #333;
            }
            
            .terminal-title {
                color: #fff;
                font-weight: 600;
                display: flex;
                align-items: center;
                gap: 8px;
            }
            
            .terminal-btn {
                background: transparent;
                border: none;
                color: #888;
                padding: 4px 8px;
                cursor: pointer;
                border-radius: 4px;
                transition: all 0.2s;
            }
            
            .terminal-btn:hover {
                background: #444;
                color: #fff;
            }
            
            .terminal-body {
                flex: 1;
                overflow: hidden;
                display: flex;
                flex-direction: column;
            }
            
            .terminal-content {
                flex: 1;
                overflow-y: auto;
                padding: 16px;
                font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
                font-size: 13px;
                line-height: 1.5;
                background: #1a1a1a;
                color: #e0e0e0;
            }
            
            .log-line {
                margin: 2px 0;
                word-break: break-all;
                white-space: pre-wrap;
            }
            
            .log-line.system { color: #64b5f6; }
            .log-line.success { color: #81c784; }
            .log-line.error { color: #e57373; }
            .log-line.warning { color: #ffb74d; }
            .log-line.info { color: #90caf9; }
            
            .terminal-footer {
                background: #2d2d2d;
                padding: 8px 16px;
                border-top: 1px solid #333;
                border-radius: 0 0 12px 12px;
                display: flex;
                justify-content: space-between;
                align-items: center;
            }
            
            .terminal-status {
                display: flex;
                align-items: center;
                gap: 8px;
                color: #888;
                font-size: 12px;
            }
            
            .status-indicator {
                width: 8px;
                height: 8px;
                border-radius: 50%;
                background: #666;
            }
            
            .status-indicator.active {
                background: #4caf50;
                animation: pulse 2s infinite;
            }
            
            @keyframes fadeIn {
                from { opacity: 0; }
                to { opacity: 1; }
            }
            
            @keyframes pulse {
                0%, 100% { opacity: 1; }
                50% { opacity: 0.5; }
            }
        `;
        
        document.head.appendChild(style);
        document.body.appendChild(terminal);
        
        // Start streaming logs
        this.streamLogs(repoId);
        
        // Auto-scroll to bottom
        const content = document.getElementById('terminal-content');
        content.scrollTop = content.scrollHeight;
    }

    async streamLogs(repoId) {
        const content = document.getElementById('terminal-content');
        if (!content) return;

        try {
            // Use EventSource for real-time log streaming
            const eventSource = new EventSource(this.addHashToUrl(`/api/admin/repos/${repoId}/logs`));
            
            eventSource.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    // Skip empty ping messages and messages with no content
                    if (data.type === 'ping' || !data.message || data.message.trim() === '') {
                        return;
                    }
                    this.addLogLine(data.message, data.type || 'info');
                } catch (e) {
                    // Skip empty raw messages too
                    if (event.data && event.data.trim() !== '') {
                        this.addLogLine(event.data, 'info');
                    }
                }
            };

            eventSource.onerror = () => {
                this.addLogLine('❌ Log stream disconnected', 'error');
                eventSource.close();
                
                // Update status indicator
                const indicator = document.querySelector('.status-indicator');
                if (indicator) {
                    indicator.classList.remove('active');
                    indicator.style.background = '#f44336';
                }
            };

            // Store reference for cleanup
            if (!this.activeLogStreams) this.activeLogStreams = new Set();
            this.activeLogStreams.add(eventSource);
            
        } catch (error) {
            this.addLogLine(`❌ Failed to connect to log stream: ${error.message}`, 'error');
        }
    }

    addLogLine(message, type = 'info') {
        const content = document.getElementById('terminal-content');
        if (!content) return;

        const line = document.createElement('div');
        line.className = `log-line ${type}`;
        line.textContent = `${new Date().toLocaleTimeString()} ${message}`;
        
        content.appendChild(line);
        content.scrollTop = content.scrollHeight;
    }

    async checkForPreInstallCommand(repoId) {
        try {
            const response = await axios.get(this.addHashToUrl(`/api/admin/repos/${repoId}/compose`));
            const composeContent = response.data.yaml || response.data.content;
            
            // Parse YAML to check for pre-install-cmd
            const lines = composeContent.split('\n');
            let inXCasaOS = false;
            
            for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
                const line = lines[lineIndex];
                const trimmed = line.trim();
                
                if (trimmed === 'x-casaos:') {
                    inXCasaOS = true;
                } else if (inXCasaOS && trimmed.startsWith('pre-install-cmd:')) {
                    // Extract the command content
                    let command = trimmed.substring('pre-install-cmd:'.length).trim();
                    
                    // Handle multiline commands
                    if (command === '|') {
                        // Multiline command, collect following indented lines
                        const commandLines = [];
                        for (let i = lineIndex + 1; i < lines.length; i++) {
                            const nextLine = lines[i];
                            if (nextLine.trim() === '' || nextLine.startsWith('    ')) {
                                commandLines.push(nextLine.substring(4)); // Remove indentation
                            } else {
                                break;
                            }
                        }
                        command = commandLines.join('\n').trim();
                    }
                    
                    return command;
                } else if (inXCasaOS && trimmed && !trimmed.startsWith('#')) {
                    // Check if this line has the same or less indentation than x-casaos (meaning we've left the section)
                    const currentIndentation = line.length - line.trimLeft().length;
                    const xCasaOSIndentation = 0; // x-casaos: is at root level
                    
                    if (currentIndentation <= xCasaOSIndentation && trimmed.endsWith(':') && !line.startsWith(' ')) {
                        // We've moved to another top-level key, stop looking
                        inXCasaOS = false;
                    }
                }
            }
            return null;
        } catch (error) {
            console.error('Failed to check for pre-install command:', error);
            return null;
        }
    }

    async checkForPostInstallCommand(repoId) {
        try {
            const response = await axios.get(this.addHashToUrl(`/api/admin/repos/${repoId}/compose`));
            const composeContent = response.data.yaml || response.data.content;

            // Parse YAML to check for post-install-cmd
            const lines = composeContent.split('\n');
            let inXCasaOS = false;

            for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
                const line = lines[lineIndex];
                const trimmed = line.trim();

                if (trimmed === 'x-casaos:') {
                    inXCasaOS = true;
                } else if (inXCasaOS && trimmed.startsWith('post-install-cmd:')) {
                    // Extract the command content
                    let command = trimmed.substring('post-install-cmd:'.length).trim();

                    // Handle multiline commands
                    if (command === '|') {
                        // Multiline command, collect following indented lines
                        const commandLines = [];
                        for (let i = lineIndex + 1; i < lines.length; i++) {
                            const nextLine = lines[i];
                            if (nextLine.trim() === '' || nextLine.startsWith('    ')) {
                                commandLines.push(nextLine.substring(4)); // Remove indentation
                            } else {
                                break;
                            }
                        }
                        command = commandLines.join('\n').trim();
                    }

                    return command;
                } else if (inXCasaOS && trimmed && !trimmed.startsWith('#')) {
                    // Check if this line has the same or less indentation than x-casaos (meaning we've left the section)
                    const currentIndentation = line.length - line.trimLeft().length;
                    const xCasaOSIndentation = 0; // x-casaos: is at root level

                    if (currentIndentation <= xCasaOSIndentation && trimmed.endsWith(':') && !line.startsWith(' ')) {
                        // We've moved to another top-level key, stop looking
                        inXCasaOS = false;
                    }
                }
            }
            return null;
        } catch (error) {
            console.error('Failed to check for post-install command:', error);
            return null;
        }
    }

    // Smart docker-compose comparison that ignores environment variable values
    compareDockerComposeStructure(currentCompose, newCompose) {
        try {
            // If they're identical, no changes
            if (currentCompose === newCompose) {
                return false;
            }

            // Parse both YAML files
            const yaml = window.jsyaml;
            if (!yaml) {
                console.warn('js-yaml not available, falling back to string comparison');
                return currentCompose !== newCompose;
            }

            // Load YAML with string schema to prevent number precision loss
            const loadOptions = { schema: yaml.FAILSAFE_SCHEMA };
            const currentConfig = yaml.load(currentCompose, loadOptions);
            const newConfig = yaml.load(newCompose, loadOptions);

            // Normalize both configurations (replace env values with placeholders)
            const normalizedCurrent = this.normalizeDockerComposeForComparison(currentConfig);
            const normalizedNew = this.normalizeDockerComposeForComparison(newConfig);

            // Compare the normalized structures
            const currentNormalizedYaml = yaml.dump(normalizedCurrent, { indent: 2, lineWidth: 120 });
            const newNormalizedYaml = yaml.dump(normalizedNew, { indent: 2, lineWidth: 120 });

            let hasChanges = currentNormalizedYaml !== newNormalizedYaml;

            if (hasChanges) {
                console.log('🔍 ANALYSIS: Changes detected (structural or formatting)');
            } else {
                console.log('🔍 ANALYSIS: Only environment variable values differ, no other changes');
            }

            return hasChanges;

        } catch (error) {
            console.warn('Error in smart docker-compose comparison:', error);
            // Fallback to string comparison if YAML parsing fails
            return currentCompose !== newCompose;
        }
    }

    // Normalize docker-compose for comparison by replacing env values with placeholders
    normalizeDockerComposeForComparison(config) {
        if (!config || typeof config !== 'object') {
            return config;
        }

        // Deep clone the config to avoid modifying the original
        const normalized = JSON.parse(JSON.stringify(config));

        // Recursively normalize the structure
        this.normalizeEnvironmentValues(normalized);

        return normalized;
    }

    // Recursively find and normalize environment variable values
    normalizeEnvironmentValues(obj) {
        if (!obj || typeof obj !== 'object') {
            return;
        }

        for (const key in obj) {
            if (key === 'environment' && obj[key]) {
                // Handle environment section
                if (Array.isArray(obj[key])) {
                    // Array format: ["KEY=value", "KEY2=value2"]
                    obj[key] = obj[key].map(envVar => {
                        if (typeof envVar === 'string' && envVar.includes('=')) {
                            const [envKey] = envVar.split('=', 1);
                            return `${envKey}=<PLACEHOLDER>`;
                        }
                        return envVar;
                    });
                } else if (typeof obj[key] === 'object') {
                    // Object format: {KEY: "value", KEY2: "value2"}
                    for (const envKey in obj[key]) {
                        obj[key][envKey] = '<PLACEHOLDER>';
                    }
                }
            } else if (typeof obj[key] === 'object') {
                // Recursively process nested objects
                this.normalizeEnvironmentValues(obj[key]);
            }
        }
    }


    async showDockerComposeChangePopup(composeChangeInfo, repo) {
        return new Promise((resolve) => {
            // Load JSDiff library if not already loaded
            this.loadJSDiffLibrary().then(() => {
                const popup = document.createElement('div');
                popup.id = 'docker-compose-change-popup';

                // Generate highlighted diff content
                const currentCompose = composeChangeInfo.modifiedCompose || composeChangeInfo.oldCompose;
                const newCompose = composeChangeInfo.newCompose;

                // Start with original highlighting (no environment transfer applied)
                const currentHighlighted = this.generateDiffHighlight(currentCompose, newCompose, 'old');
                // IMPORTANT: Use original escaped text to preserve YAML formatting
                const newHighlighted = this.escapeHtml(newCompose);

                popup.innerHTML = `
                    <div class="uninstall-backdrop"></div>
                    <div class="compose-change-container">
                        <div class="compose-change-header">
                            <div class="compose-change-icon">🔄</div>
                            <h2>Docker Compose Changes Detected</h2>
                        </div>
                        <div class="compose-change-content">
                            <p><strong>The docker-compose.yml file has changed since the last update for "${repo.displayName || repo.name}".</strong></p>
                            <p>You must review and approve these changes before proceeding with the update.</p>

                            <div class="compose-change-options">
                                <label class="compose-option">
                                    <input type="checkbox" id="update-compose" checked>
                                    <span class="option-text">
                                        <strong>Update Docker Compose</strong><br>
                                        <small>Replace the current configuration with the new one from the repository.</small>
                                    </span>
                                </label>

                                <label class="compose-option" id="transfer-env-option">
                                    <input type="checkbox" id="transfer-envs" checked>
                                    <span class="option-text">
                                        <strong>Transfer Environment Variables</strong><br>
                                        <small>Copy your custom environment variable values to the new configuration.</small>
                                    </span>
                                </label>
                            </div>

                            <div class="compose-diff-container">
                                <div class="diff-section">
                                    <h4>Current (Modified) Configuration</h4>
                                    <div class="compose-content" id="current-compose">
                                        <pre>${currentHighlighted}</pre>
                                    </div>
                                </div>
                                <div class="diff-section">
                                    <h4>New Repository Configuration</h4>
                                    <div class="compose-content" id="new-compose">
                                        <pre>${newHighlighted}</pre>
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div class="compose-change-actions">
                            <button class="btn btn-secondary" id="cancel-compose-change">Cancel</button>
                            <button class="btn btn-primary" id="apply-compose-changes">Apply Changes</button>
                        </div>
                    </div>

                <style>
                #docker-compose-change-popup {
                    position: fixed;
                    top: 0; left: 0; right: 0; bottom: 0;
                    z-index: 10001;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
                    animation: fadeIn 0.15s ease-out;
                }

                .compose-change-container {
                    position: relative;
                    width: 95%;
                    max-width: 800px;
                    max-height: 90vh;
                    background: white;
                    border-radius: 12px;
                    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
                    display: flex;
                    flex-direction: column;
                    overflow: hidden;
                }

                .compose-change-header {
                    background: #2563eb;
                    color: white;
                    padding: 20px;
                    display: flex;
                    align-items: center;
                    gap: 12px;
                }

                .compose-change-icon {
                    font-size: 24px;
                }

                .compose-change-header h2 {
                    margin: 0;
                    font-size: 20px;
                    color: white;
                }

                .compose-change-content {
                    padding: 20px;
                    overflow-y: auto;
                    flex: 1;
                }

                .compose-change-options {
                    margin: 20px 0;
                    padding: 16px;
                    background: #f8fafc;
                    border-radius: 8px;
                }

                .compose-option {
                    display: flex;
                    align-items: flex-start;
                    gap: 12px;
                    margin-bottom: 16px;
                    cursor: pointer;
                    padding: 12px;
                    border-radius: 8px;
                    transition: background-color 0.2s;
                }

                .compose-option:hover {
                    background: #e2e8f0;
                }

                .compose-option:last-child {
                    margin-bottom: 0;
                }

                .compose-option input[type="checkbox"] {
                    width: 18px;
                    height: 18px;
                    margin-top: 2px;
                }

                .compose-option.disabled {
                    opacity: 0.6;
                    cursor: not-allowed;
                }

                .compose-option.disabled input {
                    cursor: not-allowed;
                }

                .option-text strong {
                    font-weight: 600;
                    color: #1f2937;
                }

                .option-text small {
                    color: #6b7280;
                    line-height: 1.4;
                }

                .compose-diff-container {
                    display: grid;
                    grid-template-columns: 1fr 1fr;
                    gap: 20px;
                    margin-top: 20px;
                }

                .diff-section h4 {
                    margin: 0 0 12px 0;
                    font-size: 16px;
                    font-weight: 600;
                    color: #374151;
                }

                .compose-content {
                    border: 1px solid #d1d5db;
                    border-radius: 8px;
                    background: #f9fafb;
                    max-height: 400px;
                    overflow: auto;
                    word-break: break-all;
                    width: 100%;
                    box-sizing: border-box;
                }

                .compose-content pre {
                    margin: 0;
                    padding: 16px;
                    font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
                    font-size: 12px;
                    line-height: 1.5;
                    white-space: pre-wrap;
                    word-break: break-all;
                    overflow-x: hidden;
                }

                .compose-change-actions {
                    padding: 20px;
                    border-top: 1px solid #e5e7eb;
                    display: flex;
                    gap: 12px;
                    justify-content: flex-end;
                }

                @media (max-width: 768px) {
                    .compose-diff-container {
                        grid-template-columns: 1fr;
                        gap: 16px;
                    }
                }

                /* Diff highlighting styles */
                .diff-added {
                    background-color: #d4f6d4;
                    color: #155724;
                    padding: 1px 2px;
                    border-radius: 2px;
                }

                .diff-removed {
                    background-color: #fdd;
                    color: #721c24;
                    padding: 1px 2px;
                    border-radius: 2px;
                }

                .diff-env-transfer {
                    background-color: #fff3cd;
                    color: #856404;
                    border: 1px solid #ffc107;
                    padding: 1px 2px;
                    border-radius: 2px;
                }
                </style>
            `;

            document.body.appendChild(popup);

            // Handle checkbox interactions
            const updateComposeCheckbox = document.getElementById('update-compose');
            const transferEnvsCheckbox = document.getElementById('transfer-envs');
            const transferEnvOption = document.getElementById('transfer-env-option');

            updateComposeCheckbox.addEventListener('change', () => {
                if (updateComposeCheckbox.checked) {
                    transferEnvOption.classList.remove('disabled');
                    transferEnvsCheckbox.disabled = false;
                } else {
                    transferEnvOption.classList.add('disabled');
                    transferEnvsCheckbox.disabled = true;
                    transferEnvsCheckbox.checked = false;
                }
                // Update highlighting when checkbox state changes
                this.updateDiffHighlighting(currentCompose, newCompose, transferEnvsCheckbox.checked, updateComposeCheckbox.checked);
            });

            // Add environment variable transfer highlighting toggle
            transferEnvsCheckbox.addEventListener('change', () => {
                this.updateDiffHighlighting(currentCompose, newCompose, transferEnvsCheckbox.checked, updateComposeCheckbox.checked);
            });

            // Apply initial highlighting with default checkbox state (after DOM is ready)
            setTimeout(() => {
                this.updateDiffHighlighting(currentCompose, newCompose, transferEnvsCheckbox.checked, updateComposeCheckbox.checked);
            }, 0);

            // Handle buttons
            const cancelBtn = document.getElementById('cancel-compose-change');
            const applyBtn = document.getElementById('apply-compose-changes');

            cancelBtn.onclick = () => {
                // Protect repo from automatic refresh overwrites
                if (repo && repo.id) {
                    const repoManager = window.repoManager || this;
                    if (repoManager && repoManager.protectRepoFromRefresh) {
                        repoManager.protectRepoFromRefresh(repo.id, 5000); // 5 seconds protection
                    }
                }

                // Restore button state when user cancels - use multiple approaches
                try {
                    // Method 1: Direct DOM manipulation to find and restore the update button
                    const updateButtons = document.querySelectorAll(`[onclick*="repoManager.buildRepo('${repo.id}')"]`);
                    updateButtons.forEach(button => {
                        button.disabled = false;
                        // Set correct icon based on whether updates are available
                        const hasUpdates = repo.hasUpdates || button.getAttribute('title')?.includes('Update');
                        button.innerHTML = hasUpdates ? '<i class="fas fa-download"></i>' : '<i class="fas fa-sync-alt"></i>';
                    });

                    // Method 2: Try the repo manager approach as fallback
                    if (repo && repo.id) {
                        const repoManager = window.repoManager || this;
                        if (repoManager && repoManager.updateRepoStatus) {
                            repoManager.updateRepoStatus(repo.id, 'ready');
                        }
                    }

                    // Method 3: Final fallback - reload repo list to reset all states
                    if (window.repoManager && window.repoManager.loadRepos) {
                        setTimeout(() => window.repoManager.loadRepos(), 100);
                    }
                } catch (error) {
                    console.warn('Error restoring button state:', error);
                }

                document.body.removeChild(popup);
                resolve({ proceed: false });
            };

            applyBtn.onclick = () => {
                const updateCompose = updateComposeCheckbox.checked;
                const transferEnvs = transferEnvsCheckbox.checked;

                document.body.removeChild(popup);
                resolve({
                    proceed: true,
                    updateCompose,
                    transferEnvs,
                    oldCompose: composeChangeInfo.oldCompose,
                    newCompose: composeChangeInfo.newCompose,
                    modifiedCompose: composeChangeInfo.modifiedCompose
                });
            };

            // Handle backdrop click
            popup.querySelector('.uninstall-backdrop').addEventListener('click', () => {
                // Protect repo from automatic refresh overwrites
                if (repo && repo.id) {
                    const repoManager = window.repoManager || this;
                    if (repoManager && repoManager.protectRepoFromRefresh) {
                        repoManager.protectRepoFromRefresh(repo.id, 5000); // 5 seconds protection
                    }
                }

                // Restore button state when user cancels via backdrop - use multiple approaches
                try {
                    // Method 1: Direct DOM manipulation
                    const updateButtons = document.querySelectorAll(`[onclick*="repoManager.buildRepo('${repo.id}')"]`);
                    updateButtons.forEach(button => {
                        button.disabled = false;
                        // Set correct icon based on whether updates are available
                        const hasUpdates = repo.hasUpdates || button.getAttribute('title')?.includes('Update');
                        button.innerHTML = hasUpdates ? '<i class="fas fa-download"></i>' : '<i class="fas fa-sync-alt"></i>';
                    });

                    // Method 2: Try the repo manager approach as fallback
                    if (repo && repo.id) {
                        const repoManager = window.repoManager || this;
                        if (repoManager && repoManager.updateRepoStatus) {
                            repoManager.updateRepoStatus(repo.id, 'ready');
                        }
                    }

                    // Method 3: Final fallback - reload repo list to reset all states
                    if (window.repoManager && window.repoManager.loadRepos) {
                        setTimeout(() => window.repoManager.loadRepos(), 100);
                    }
                } catch (error) {
                    console.warn('Error restoring button state:', error);
                }

                document.body.removeChild(popup);
                resolve({ proceed: false });
            });

            // Handle escape key
            const escapeHandler = (e) => {
                if (e.key === 'Escape') {
                    // Restore button state when user cancels via escape
                    if (repo && repo.id) {
                        const repoManager = window.repoManager || this;
                        if (repoManager && repoManager.updateRepoStatus) {
                            repoManager.updateRepoStatus(repo.id, 'ready');
                        }
                    }
                    document.body.removeChild(popup);
                    document.removeEventListener('keydown', escapeHandler);
                    resolve({ proceed: false });
                }
            };
            document.addEventListener('keydown', escapeHandler);
            }); // Close the then callback
        });
    }

    // Helper function to load JSDiff library
    async loadJSDiffLibrary() {
        return new Promise((resolve, reject) => {
            // Check if JSDiff is already loaded
            if (window.Diff) {
                resolve();
                return;
            }

            // Create script element to load JSDiff from CDN
            const script = document.createElement('script');
            script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jsdiff/5.1.0/diff.min.js';
            script.crossOrigin = 'anonymous';
            script.onload = () => {
                console.log('✅ JSDiff library loaded successfully');
                resolve();
            };
            script.onerror = () => {
                console.warn('⚠️ Failed to load JSDiff library, falling back to plain text');
                // Fallback: create a minimal Diff object for graceful degradation
                window.Diff = {
                    diffWords: (oldText, newText) => [{ value: newText }]
                };
                resolve();
            };
            document.head.appendChild(script);
        });
    }

    // Helper function to generate diff highlighting with optional environment transfer awareness
    generateDiffHighlight(oldText, newText, side, envTransfers = null) {
        try {
            if (!window.Diff) {
                // Fallback if JSDiff is not available
                return this.escapeHtml(side === 'old' ? oldText : newText);
            }

            // Use character-based diffing for precise highlighting
            const diff = window.Diff.diffChars(oldText, newText);
            let html = '';

            for (const part of diff) {
                const escaped = this.escapeHtml(part.value);

                if (side === 'old') {
                    if (part.removed) {
                        html += `<span class="diff-removed">${escaped}</span>`;
                    } else if (!part.added) {
                        // Show unchanged content
                        html += escaped;
                    }
                    // Skip added parts on old side
                } else {
                    if (part.added) {
                        html += `<span class="diff-added">${escaped}</span>`;
                    } else if (!part.removed) {
                        // Show unchanged content
                        html += escaped;
                    }
                    // Skip removed parts on new side
                }
            }

            return html;

        } catch (error) {
            console.error('Error generating diff highlight:', error);
            return this.escapeHtml(side === 'old' ? oldText : newText);
        }
    }

    // Generate diff highlighting WITH environment transfer (shows yellow highlights on transferred env values)
    generateDiffWithTransfer(oldText, newText, side) {
        try {
            if (!window.Diff) {
                return this.escapeHtml(side === 'old' ? oldText : newText);
            }

            if (side === 'old') {
                // For old side with transfer: show current values with yellow highlights for transferred env vars
                return this.showEnvironmentPreviewForCurrentSide(oldText, newText);
            } else {
                // For new side with transfer: show transferred values with yellow highlighting
                return this.showEnvironmentPreview(oldText, newText);
            }

        } catch (error) {
            console.warn('Error generating diff with transfer:', error);
            return this.escapeHtml(side === 'old' ? oldText : newText);
        }
    }

    // Generate diff highlighting WITHOUT environment transfer (no env highlights)
    generateDiffWithoutTransfer(oldText, newText, side) {
        try {
            // Use structural diff approach - this will show red/green for structural changes
            // but won't highlight environment values at all
            return this.generateStructuralDiff(oldText, newText, side);

        } catch (error) {
            console.warn('Error generating diff without transfer:', error);
            return this.escapeHtml(side === 'old' ? oldText : newText);
        }
    }


    // Simple helper to check if content contains environment variables that will be transferred
    containsEnvironmentVariable(content, envTransfers) {
        if (!envTransfers || envTransfers.size === 0) {
            return false;
        }

        // Check each line for environment variables
        const lines = content.split('\n');
        for (const line of lines) {
            for (const [serviceName, envMap] of envTransfers) {
                for (const [envKey] of envMap) {
                    // Simple string matching: check if line contains "KEY:"
                    if (line.includes(`${envKey}:`)) {
                        return true;
                    }
                }
            }
        }
        return false;
    }


    // Helper function to escape HTML characters
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // Helper function to normalize environment variables to object format
    normalizeEnvironment(env) {
        if (!env) return {};

        if (Array.isArray(env)) {
            const result = {};
            env.forEach(item => {
                if (typeof item === 'string') {
                    const [key, ...valueParts] = item.split('=');
                    if (key) {
                        result[key] = valueParts.join('=') || '';
                    }
                }
            });
            return result;
        }

        if (typeof env === 'object' && env !== null) {
            // Ensure all values are strings to prevent scientific notation issues
            const result = {};
            for (const key in env) {
                const value = env[key];

                // DEBUG: Track number precision corruption
                if (typeof value === 'number' && value > Number.MAX_SAFE_INTEGER) {
                    console.warn(`⚠️ PRECISION LOSS DETECTED: ${key} = ${value} (exceeds safe integer limit)`);
                }

                // Convert all values to strings, preserving the original format
                const stringValue = typeof value === 'string' ? value : String(value);

                // DEBUG: Track if conversion changed the value
                if (typeof value === 'number' && stringValue !== String(value)) {
                    console.warn(`⚠️ VALUE CHANGED during string conversion: ${key} = ${value} → ${stringValue}`);
                }

                result[key] = stringValue;
            }
            return result;
        }

        return {};
    }

    // Helper function to update diff highlighting - NEVER calls transferEnvironmentVariables for display
    updateDiffHighlighting(currentCompose, newCompose, showEnvTransfer, updateComposeEnabled = true) {
        try {
            if (!updateComposeEnabled) {
                // When "Update Docker Compose" is disabled, both panels show the same content (current compose)
                const currentHighlighted = this.escapeHtml(currentCompose);
                document.getElementById('current-compose').innerHTML = `<pre>${currentHighlighted}</pre>`;
                document.getElementById('new-compose').innerHTML = `<pre>${currentHighlighted}</pre>`;
            } else if (showEnvTransfer) {
                // WITH transfer enabled: both panels show transferred values with yellow highlights
                const newHighlighted = this.generateDiffWithTransfer(currentCompose, newCompose, 'new');
                document.getElementById('new-compose').innerHTML = `<pre>${newHighlighted}</pre>`;

                // Current side also shows transferred values with yellow highlights
                const currentHighlighted = this.generateDiffWithTransfer(currentCompose, newCompose, 'old');
                document.getElementById('current-compose').innerHTML = `<pre>${currentHighlighted}</pre>`;
            } else {
                // WITHOUT transfer: show diffs but no highlighting on environment values
                const newHighlighted = this.generateDiffWithoutTransfer(currentCompose, newCompose, 'new');
                document.getElementById('new-compose').innerHTML = `<pre>${newHighlighted}</pre>`;

                // Current side also without env highlighting
                const currentHighlighted = this.generateDiffWithoutTransfer(currentCompose, newCompose, 'old');
                document.getElementById('current-compose').innerHTML = `<pre>${currentHighlighted}</pre>`;
            }
        } catch (error) {
            console.warn('Error updating diff highlighting:', error);
            // Fallback: show escaped original text without highlighting
            document.getElementById('new-compose').innerHTML = `<pre>${this.escapeHtml(newCompose)}</pre>`;
            document.getElementById('current-compose').innerHTML = `<pre>${this.escapeHtml(currentCompose)}</pre>`;
        }
    }

    // Helper function to show environment preview for current side (left panel)
    showEnvironmentPreviewForCurrentSide(currentCompose, newCompose) {
        try {
            // Step 1: Build environment transfer map
            const envTransfers = this.buildEnvironmentTransferMap(currentCompose, newCompose);

            if (envTransfers.size === 0) {
                // No environment transfers - use structural diff only
                return this.generateStructuralDiff(currentCompose, newCompose, 'old');
            }

            // Step 2: Generate structural diff for old side (red/green highlighting for non-env changes)
            const structuralDiffHTML = this.generateStructuralDiff(currentCompose, newCompose, 'old');

            // Step 3: Add yellow highlighting to current environment values that will be transferred
            const finalHTML = this.addCurrentSideEnvironmentHighlighting(structuralDiffHTML, envTransfers, currentCompose);

            return finalHTML;

        } catch (error) {
            console.warn('Error in showEnvironmentPreviewForCurrentSide:', error);
            return this.generateDiffHighlight(currentCompose, newCompose, 'old');
        }
    }

    // Helper function to add yellow highlighting to current side environment values
    addCurrentSideEnvironmentHighlighting(htmlContent, envTransfers, currentCompose) {
        try {
            if (envTransfers.size === 0) {
                return htmlContent;
            }

            let result = htmlContent;

            // Get current environment value formatting
            const currentEnvValues = this.extractEnvironmentValues(currentCompose);

            // Process each environment variable that will be transferred
            envTransfers.forEach((envMap, serviceName) => {
                envMap.forEach((transferredValue, envKey) => {
                    // Get the original formatting from the current compose file
                    const currentEnvData = currentEnvValues.get(envKey);
                    if (!currentEnvData) return;

                    // HTML-escape the current value
                    const currentValueStr = String(transferredValue); // This is the current value
                    const escapedCurrentValue = this.escapeHtml(currentValueStr);

                    // Build highlighted version based on original quote format
                    let highlightedValue;
                    if (currentEnvData.quoteType === 'single') {
                        highlightedValue = `<span class="diff-env-transfer">'${escapedCurrentValue}'</span>`;
                    } else if (currentEnvData.quoteType === 'double') {
                        highlightedValue = `<span class="diff-env-transfer">"${escapedCurrentValue}"</span>`;
                    } else {
                        highlightedValue = `<span class="diff-env-transfer">${currentValueStr}</span>`;
                    }

                    // Replace the restored original value with highlighted current value
                    // The structural diff has already restored placeholders to original values
                    const envKeyEscaped = envKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                    const originalValueEscaped = this.escapeHtml(currentEnvData.value);
                    const valuePattern = new RegExp(`(${envKeyEscaped}\\s*:\\s*)${originalValueEscaped.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'g');

                    const beforeReplace = result;
                    result = result.replace(valuePattern, `$1${highlightedValue}`);

                    // Silently apply highlighting
                });
            });

            return result;

        } catch (error) {
            console.warn('Error adding current side environment highlighting:', error);
            return htmlContent;
        }
    }

    // Helper function to show environment preview using two-phase smart diff system
    showEnvironmentPreview(currentCompose, newCompose) {
        try {
            // Step 1: Build environment transfer map
            const envTransfers = this.buildEnvironmentTransferMap(currentCompose, newCompose);

            if (envTransfers.size === 0) {
                // No environment transfers - use structural diff only
                return this.generateStructuralDiff(currentCompose, newCompose, 'new');
            }

            // Step 2: Generate structural diff (red/green highlighting for non-env changes)
            // This compares placeholder versions and restores original env values
            const structuralDiffHTML = this.generateStructuralDiff(currentCompose, newCompose, 'new');

            // Step 3: Add yellow highlighting for transferred environment values
            // This adds highlighting to specific env values that are being transferred
            const finalHTML = this.addEnvironmentHighlighting(structuralDiffHTML, envTransfers, currentCompose, newCompose);

            return finalHTML;

        } catch (error) {
            console.warn('Error in showEnvironmentPreview:', error);
            // Fallback: show regular diff highlighting
            return this.generateDiffHighlight(currentCompose, newCompose, 'new');
        }
    }

    // Helper function to add yellow highlighting to transferred environment values
    addEnvironmentHighlighting(htmlContent, envTransfers, currentCompose, newCompose) {
        try {
            if (envTransfers.size === 0) {
                return htmlContent;
            }

            let result = htmlContent;

            // Get environment value formatting from CURRENT compose (preserve original formatting)
            const currentEnvValues = this.extractEnvironmentValues(currentCompose);
            const newEnvValues = this.extractEnvironmentValues(newCompose);

            // Process each environment variable transfer
            envTransfers.forEach((envMap, serviceName) => {
                envMap.forEach((transferredValue, envKey) => {
                    // Get the original formatting from the CURRENT compose file (not new)
                    const currentEnvData = currentEnvValues.get(envKey);
                    const newEnvData = newEnvValues.get(envKey);
                    if (!currentEnvData || !newEnvData) return;

                    // HTML-escape the transferred value for safe insertion
                    const transferredStr = String(transferredValue);
                    const escapedTransferredValue = this.escapeHtml(transferredStr);

                    // Build the replacement based on CURRENT compose quote format (preserve original)
                    let highlightedValue;
                    if (currentEnvData.quoteType === 'single') {
                        // Current has single quotes -> use single quotes for transferred value
                        highlightedValue = `<span class="diff-env-transfer">'${escapedTransferredValue}'</span>`;
                    } else if (currentEnvData.quoteType === 'double') {
                        // Current has double quotes -> use double quotes for transferred value
                        highlightedValue = `<span class="diff-env-transfer">"${escapedTransferredValue}"</span>`;
                    } else {
                        // Current has no quotes -> use no quotes for transferred value
                        highlightedValue = `<span class="diff-env-transfer">${transferredStr}</span>`;
                    }

                    // Replace the restored original value with highlighted transferred value
                    // The structural diff has already restored placeholders to original values
                    const envKeyEscaped = envKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                    const originalValueEscaped = this.escapeHtml(newEnvData.value);
                    const valuePattern = new RegExp(`(${envKeyEscaped}\\s*:\\s*)${originalValueEscaped.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'g');

                    const beforeReplace = result;
                    result = result.replace(valuePattern, `$1${highlightedValue}`);

                    // Silently apply highlighting
                });
            });

            return result;

        } catch (error) {
            console.warn('Error adding environment highlighting:', error);
            return htmlContent;
        }
    }

    // Helper function to create placeholder version of docker-compose for structural diff
    createPlaceholderVersion(composeText) {
        try {
            // Replace all environment variable values with <PLACEHOLDER> to isolate structural changes
            let result = composeText;

            // Pattern to match environment variable assignments with different quote formats
            const envPatterns = [
                // Match: KEY: 'any value with single quotes' -> KEY: <PLACEHOLDER>
                /^(\s*[A-Z_][A-Z0-9_]*\s*:\s*)'[^']*'/gm,
                // Match: KEY: "any value with double quotes" -> KEY: <PLACEHOLDER>
                /^(\s*[A-Z_][A-Z0-9_]*\s*:\s*)"[^"]*"/gm,
                // Match: KEY: unquoted_value -> KEY: <PLACEHOLDER>
                /^(\s*[A-Z_][A-Z0-9_]*\s*:\s*)([^#\n\s][^#\n]*?)(\s*(?:#.*)?$)/gm
            ];

            envPatterns.forEach(pattern => {
                result = result.replace(pattern, '$1<PLACEHOLDER>');
            });

            return result;

        } catch (error) {
            console.warn('Error creating placeholder version:', error);
            return composeText;
        }
    }

    // Helper function to extract environment values with their original formatting
    extractEnvironmentValues(composeText) {
        try {
            const envValues = new Map();
            const lines = composeText.split('\n');

            lines.forEach((line, lineIndex) => {
                // Check if line contains environment variable assignment
                const envMatch = line.match(/^(\s*)([A-Z_][A-Z0-9_]*)\s*:\s*(.+?)(\s*(?:#.*)?)$/);

                if (envMatch) {
                    const [, indent, envKey, value, comment] = envMatch;

                    // Store the complete original formatting
                    envValues.set(envKey, {
                        fullLine: line,
                        indent,
                        key: envKey,
                        value: value.trim(),
                        comment: comment || '',
                        lineIndex,
                        // Detect quote format
                        hasQuotes: value.startsWith('"') || value.startsWith("'"),
                        quoteType: value.startsWith('"') ? 'double' : (value.startsWith("'") ? 'single' : 'none')
                    });
                }
            });

            return envValues;

        } catch (error) {
            console.warn('Error extracting environment values:', error);
            return new Map();
        }
    }

    // Helper function to check if a line contains an environment variable assignment
    isEnvironmentValueLine(line) {
        // Match lines that look like environment variable assignments
        // Examples: "      DISCORD_TOKEN: 'value'", "      CLIENT_ID: 123", "GUILD_ID: \"value\""
        return /^\s*[A-Z_][A-Z0-9_]*\s*:\s*.+/.test(line.trim());
    }

    // Helper function to generate structural diff (red/green) using placeholder versions
    generateStructuralDiff(currentCompose, newCompose, side) {
        try {
            if (!window.Diff) {
                return this.escapeHtml(side === 'old' ? currentCompose : newCompose);
            }

            // Step 1: Create placeholder versions that hide environment values
            const currentPlaceholder = this.createPlaceholderVersion(currentCompose);
            const newPlaceholder = this.createPlaceholderVersion(newCompose);

            // Step 2: Generate diff on placeholder versions (shows only structural changes)
            const diff = window.Diff.diffChars(currentPlaceholder, newPlaceholder);
            let html = '';

            // Step 3: Apply red/green highlighting only to structural differences
            for (const part of diff) {
                const escaped = this.escapeHtml(part.value);

                if (side === 'old') {
                    if (part.removed) {
                        html += `<span class="diff-removed">${escaped}</span>`;
                    } else if (!part.added) {
                        html += escaped;
                    }
                } else {
                    if (part.added) {
                        html += `<span class="diff-added">${escaped}</span>`;
                    } else if (!part.removed) {
                        html += escaped;
                    }
                }
            }

            // Step 4: Restore ALL environment values from placeholders (preserving exact formatting)
            // This ensures no environment variable is left as <PLACEHOLDER>
            const originalEnvValues = this.extractEnvironmentValues(side === 'old' ? currentCompose : newCompose);

            originalEnvValues.forEach((envData, envKey) => {
                // Replace <PLACEHOLDER> with the original value (preserving exact formatting)
                const envKeyEscaped = envKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const placeholderPattern = new RegExp(`(${envKeyEscaped}\\s*:\\s*)&lt;PLACEHOLDER&gt;`, 'g');
                html = html.replace(placeholderPattern, `$1${this.escapeHtml(envData.value)}`);
            });

            return html;

        } catch (error) {
            console.warn('Error generating structural diff:', error);
            return this.escapeHtml(side === 'old' ? currentCompose : newCompose);
        }
    }

    // Helper function to build environment transfer map
    buildEnvironmentTransferMap(currentCompose, newCompose) {
        const envTransfers = new Map();

        try {
            const yaml = window.jsyaml;
            if (!yaml) return envTransfers;

            // Load YAML with string schema to prevent number precision loss
            const loadOptions = { schema: yaml.FAILSAFE_SCHEMA };
            const currentConfig = yaml.load(currentCompose, loadOptions);
            const newConfig = yaml.load(newCompose, loadOptions);

            if (currentConfig?.services && newConfig?.services) {
                Object.keys(newConfig.services).forEach(serviceName => {
                    const currentService = currentConfig.services[serviceName];
                    const newService = newConfig.services[serviceName];

                    if (currentService?.environment && newService?.environment) {
                        const currentEnv = this.normalizeEnvironment(currentService.environment);
                        const newEnv = this.normalizeEnvironment(newService.environment);

                        Object.keys(newEnv).forEach(envKey => {
                            if (currentEnv.hasOwnProperty(envKey)) {
                                // Convert both to strings for reliable comparison
                                const currentValue = String(currentEnv[envKey]);
                                const newValue = String(newEnv[envKey]);

                                if (currentValue !== newValue) {
                                    if (!envTransfers.has(serviceName)) {
                                        envTransfers.set(serviceName, new Map());
                                    }
                                    // Store original value (preserve type)
                                    envTransfers.get(serviceName).set(envKey, currentEnv[envKey]);
                                }
                            }
                        });
                    }
                });
            }
        } catch (error) {
            console.warn('Error building environment transfer map:', error);
        }

        return envTransfers;
    }


    // Helper function to replace only environment sections while preserving YAML formatting
    replaceEnvironmentSectionsInYaml(originalYaml, modifiedConfig, envTransfers) {
        try {
            let result = originalYaml;

            envTransfers.forEach((envMap, serviceName) => {
                envMap.forEach((transferredValue, envKey) => {
                    // Pattern for array format: - KEY=value
                    const envPattern = new RegExp(
                        `(\\s*-\\s*${this.escapeRegex(envKey)}=)[^\\n\\r]*`,
                        'g'
                    );
                    // Pattern for object format: KEY: value (with possible quotes)
                    const envPatternObj = new RegExp(
                        `(\\s*${this.escapeRegex(envKey)}:\\s*)['"]?[^\\n\\r'"]*(["']?)`,
                        'g'
                    );

                    // Replace with transferred value, preserving quotes if they existed
                    result = result.replace(envPattern, `$1${transferredValue}`);
                    result = result.replace(envPatternObj, `$1'${transferredValue}'`);
                });
            });

            return result;
        } catch (error) {
            console.warn('Error replacing environment sections:', error);
            return originalYaml;
        }
    }

    // Helper function to escape regex special characters
    escapeRegex(string) {
        return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    // Helper function to highlight environment variable transfers (smart highlighting)
    generateEnvTransferHighlight(originalNew, processedNew) {
        try {
            if (!window.Diff) {
                return this.escapeHtml(processedNew);
            }

            // Parse both YAML files to identify actual environment variable changes
            const yaml = window.jsyaml;
            if (yaml) {
                const loadOptions = { schema: yaml.FAILSAFE_SCHEMA };
                const originalConfig = yaml.load(originalNew, loadOptions);
                const processedConfig = yaml.load(processedNew, loadOptions);

                // Find environment variables that were actually added or removed (not just transferred)
                const envChanges = this.detectEnvironmentVariableChanges(originalConfig, processedConfig);

                if (envChanges.length === 0) {
                    // No structural env var changes, just show the final result without highlighting
                    return this.escapeHtml(processedNew);
                }
            }

            // Fall back to word diff for any remaining changes
            const diff = window.Diff.diffWords(originalNew, processedNew);
            let html = '';

            for (const part of diff) {
                const escaped = this.escapeHtml(part.value);

                if (part.added) {
                    // Only highlight if it's a true addition (not just a value transfer)
                    html += `<span class="diff-env-transfer">${escaped}</span>`;
                } else if (!part.removed) {
                    html += escaped;
                }
                // Skip removed parts
            }

            return html;
        } catch (error) {
            console.warn('Error generating env transfer highlight:', error);
            return this.escapeHtml(processedNew);
        }
    }

    // Helper function to detect actual environment variable structure changes
    detectEnvironmentVariableChanges(originalConfig, processedConfig) {
        const changes = [];

        try {
            if (!originalConfig?.services || !processedConfig?.services) {
                return changes;
            }

            for (const serviceName in processedConfig.services) {
                // Use normalized environment objects for proper comparison
                const originalEnv = this.normalizeEnvironment(originalConfig.services[serviceName]?.environment);
                const processedEnv = this.normalizeEnvironment(processedConfig.services[serviceName]?.environment);

                // Find added variables
                for (const envVar in processedEnv) {
                    if (!(envVar in originalEnv)) {
                        changes.push({ type: 'added', service: serviceName, variable: envVar });
                    }
                }

                // Find removed variables
                for (const envVar in originalEnv) {
                    if (!(envVar in processedEnv)) {
                        changes.push({ type: 'removed', service: serviceName, variable: envVar });
                    }
                }
            }

            // Also check for services that had environment variables but are now missing entirely
            for (const serviceName in originalConfig.services) {
                if (!(serviceName in processedConfig.services)) {
                    const originalEnv = this.normalizeEnvironment(originalConfig.services[serviceName]?.environment);
                    for (const envVar in originalEnv) {
                        changes.push({ type: 'removed', service: serviceName, variable: envVar });
                    }
                }
            }
        } catch (error) {
            console.warn('Error detecting environment variable changes:', error);
        }

        return changes;
    }

    // Helper function to transfer environment variables between docker compose configurations
    transferEnvironmentVariables(oldCompose, newCompose) {
        try {
            // Input validation
            if (!oldCompose || !newCompose || typeof oldCompose !== 'string' || typeof newCompose !== 'string') {
                console.warn('Invalid input to transferEnvironmentVariables');
                return newCompose || '';
            }

            // Starting environment transfer for installation

            // Build environment transfer map
            const envTransfers = this.buildEnvironmentTransferMap(oldCompose, newCompose);
            if (envTransfers.size === 0) {
                console.log('No environment variables to transfer, returning original newCompose');
                return newCompose;
            }

            // Get current environment value formatting (preserve original formatting)
            const currentEnvValues = this.extractEnvironmentValues(oldCompose);
            let result = newCompose;
            let transferCount = 0;

            // Apply text-based environment transfers (preserves all formatting)
            envTransfers.forEach((envMap, serviceName) => {
                envMap.forEach((transferredValue, envKey) => {
                    // Get the original formatting from the CURRENT compose file
                    const currentEnvData = currentEnvValues.get(envKey);
                    if (!currentEnvData) {
                        console.warn(`Environment variable ${envKey} not found in current compose`);
                        return;
                    }

                    const transferredStr = String(transferredValue);
                    const envKeyEscaped = envKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

                    // Build replacement value using CURRENT compose formatting (not new compose)
                    let replacementValue;
                    if (currentEnvData.quoteType === 'single') {
                        replacementValue = `'${transferredStr.replace(/'/g, "\\'")}'`;
                    } else if (currentEnvData.quoteType === 'double') {
                        replacementValue = `"${transferredStr.replace(/"/g, '\\"')}"`;
                    } else {
                        replacementValue = transferredStr;
                    }

                    // Match different patterns in the new compose and replace with transferred value
                    const patterns = [
                        // Single quotes: KEY: 'VALUE' -> KEY: 'TRANSFERRED_VALUE'
                        {
                            search: new RegExp(`(${envKeyEscaped}:\\s*)'([^']*)'`, 'g'),
                            replace: `$1${replacementValue}`
                        },
                        // Double quotes: KEY: "VALUE" -> KEY: "TRANSFERRED_VALUE"
                        {
                            search: new RegExp(`(${envKeyEscaped}:\\s*)"([^"]*)"`, 'g'),
                            replace: `$1${replacementValue}`
                        },
                        // No quotes: KEY: VALUE -> KEY: TRANSFERRED_VALUE
                        {
                            search: new RegExp(`(${envKeyEscaped}:\\s*)([^\\s\\n#]+)`, 'g'),
                            replace: `$1${replacementValue}`
                        }
                    ];

                    // Apply the replacement
                    patterns.forEach(({search, replace}) => {
                        const beforeReplace = result;
                        result = result.replace(search, replace);
                        if (beforeReplace !== result) {
                            transferCount++;
                            return; // Stop after first successful replacement
                        }
                    });
                });
            });

            // Environment transfer complete
            return result;

        } catch (error) {
            console.error('Error transferring environment variables:', error);
            return newCompose || '';
        }
    }

    async showUpdateAvailablePopup(repo) {
        return new Promise(async (resolve) => {
            const popup = document.createElement('div');
            popup.id = 'update-available-popup';

            // Start with loading/analysis state
            popup.innerHTML = `
                <div class="update-popup-backdrop"></div>
                <div class="uninstall-container">
                    <div class="uninstall-header">
                        <div class="uninstall-icon">
                            <div class="loading-spinner"></div>
                        </div>
                        <h2>Analyzing Docker Compose</h2>
                    </div>
                    <div class="uninstall-content">
                        <p>Comparing current docker-compose.yml with repository version...</p>
                    </div>
                </div>

                <style>
                #update-available-popup {
                    position: fixed;
                    top: 0; left: 0; right: 0; bottom: 0;
                    z-index: 10000;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
                    animation: fadeIn 0.15s ease-out;
                }
                .loading-spinner {
                    width: 40px;
                    height: 40px;
                    border: 4px solid #e5e7eb;
                    border-top: 4px solid #3b82f6;
                    border-radius: 50%;
                    animation: spin 1s linear infinite;
                }
                @keyframes spin {
                    0% { transform: rotate(0deg); }
                    100% { transform: rotate(360deg); }
                }
                </style>
            `;

            // Ensure update popup styles are available
            if (!document.getElementById('update-popup-styles')) {
                const style = document.createElement('style');
                style.id = 'update-popup-styles';
                style.textContent = `
                    .update-popup-backdrop {
                        position: fixed;
                        top: 0; left: 0; right: 0; bottom: 0;
                        background: rgba(0, 0, 0, 0.75);
                        backdrop-filter: blur(4px);
                    }
                    .uninstall-container {
                        background: white;
                        border-radius: 12px;
                        box-shadow: 0 10px 40px rgba(0, 0, 0, 0.3);
                        max-width: 500px;
                        width: 90%;
                        max-height: 90vh;
                        overflow-y: auto;
                        position: relative;
                        z-index: 10001;
                    }
                    .uninstall-header {
                        padding: 24px 24px 16px 24px;
                        border-bottom: 1px solid #e5e7eb;
                        text-align: center;
                    }
                    .uninstall-icon {
                        font-size: 48px;
                        margin-bottom: 12px;
                        display: flex;
                        justify-content: center;
                        align-items: center;
                        height: 60px;
                    }
                    .uninstall-header h2 {
                        margin: 0;
                        color: #1f2937;
                        font-size: 20px;
                        font-weight: 600;
                    }
                    .uninstall-content {
                        padding: 20px 24px;
                        text-align: center;
                    }
                    .uninstall-content p {
                        margin: 0 0 16px 0;
                        color: #374151;
                        line-height: 1.5;
                    }
                    .uninstall-actions {
                        padding: 16px 24px 24px 24px;
                        display: flex;
                        gap: 12px;
                        justify-content: flex-end;
                        border-top: 1px solid #e5e7eb;
                    }
                    @keyframes fadeIn {
                        from { opacity: 0; transform: scale(0.95); }
                        to { opacity: 1; transform: scale(1); }
                    }
                `;
                document.head.appendChild(style);
            }

            document.body.appendChild(popup);

            const cleanup = () => {
                if (popup.parentNode) {
                    document.body.removeChild(popup);
                }
            };

            try {
                // Add minimum 3-second delay so user can see the analysis popup
                const [analysisResult] = await Promise.all([
                    this.performDockerComposeAnalysis(repo),
                    new Promise(resolve => setTimeout(resolve, 3000)) // 3 second minimum
                ]);

                if (analysisResult.composeChanged) {
                    // Docker-compose has changed - show comparison popup
                    cleanup();
                    const compareResult = await this.showDockerComposeChangePopup(analysisResult.composeChangeInfo, repo);
                    resolve(compareResult); // Return full result with transfer settings
                } else {
                    // No changes, proceed with normal update
                    cleanup();
                    resolve({ proceed: true });
                }
            } catch (error) {
                cleanup();
                this.showNotification('Failed to analyze docker-compose: ' + error.message, 'error');
                resolve(false);
            }
        });
    }

    async performDockerComposeAnalysis(repo) {
        console.log('🔍 ANALYSIS: Starting docker-compose analysis for repo:', repo.name);
        console.log('🔍 ANALYSIS: Repo data:', { id: repo.id, type: repo.type, isInstalled: repo.isInstalled });

        // Get the current stored docker-compose (what user has now)
        let currentDockerCompose = repo.modifiedDockerCompose;

        console.log('🔍 ANALYSIS: Current stored docker-compose exists:', !!currentDockerCompose);

        // If we don't have the current composition, fetch it
        if (!currentDockerCompose) {
            console.log('🔍 ANALYSIS: Missing current data, fetching from API...');
            try {
                const response = await axios.get(this.addHashToUrl(`/api/admin/repos/${repo.id}/compose`));
                if (response.data.success) {
                    currentDockerCompose = response.data.yaml;
                    console.log('🔍 ANALYSIS: Fetched current docker-compose length:', currentDockerCompose?.length || 0);
                }
            } catch (error) {
                console.warn('🔍 ANALYSIS: Could not fetch current docker-compose:', error);
                return { proceed: true, composeChanged: false };
            }
        }

        // Now fetch the LATEST docker-compose.yml from GitHub using direct raw URL
        console.log('🔍 ANALYSIS: Fetching latest docker-compose.yml from GitHub...');
        let latestDockerCompose = null;

        try {
            // Extract GitHub repo info from the URL
            const githubUrl = repo.url;
            console.log('🔍 ANALYSIS: Repository URL:', githubUrl);

            // Use GitHub API instead of raw URLs to handle private repos with tokens
            if (githubUrl.includes('github.com')) {
                // Extract token and repo info
                let token = null;
                let cleanUrl = githubUrl;

                // Check if URL has authentication token
                const tokenMatch = githubUrl.match(/https:\/\/([^@]+)@github\.com/);
                if (tokenMatch) {
                    token = tokenMatch[1];
                    cleanUrl = githubUrl.replace(/^https:\/\/[^@]+@/, 'https://');
                }

                cleanUrl = cleanUrl.replace(/\.git$/, ''); // Remove .git suffix
                const urlParts = cleanUrl.replace('https://github.com/', '').split('/');

                if (urlParts.length >= 2) {
                    const owner = urlParts[0];
                    const repoName = urlParts[1];

                    // Try main branch first using GitHub API
                    let apiUrl = `https://api.github.com/repos/${owner}/${repoName}/contents/docker-compose.yml?ref=main`;
                    console.log('🔍 ANALYSIS: Trying GitHub API with main branch');

                    const headers = {
                        'Accept': 'application/vnd.github.v3.raw'
                    };

                    // Add authorization if token is present
                    if (token) {
                        headers['Authorization'] = `token ${token}`;
                        console.log('🔍 ANALYSIS: Using authentication token for private repo');
                    }

                    try {
                        // NOTE: You may see GitHub cookie warnings in the console like:
                        // Cookie "_gh_sess" has been rejected because it is in a cross-site context and its "SameSite" is "Lax" or "Strict"
                        // These warnings are harmless and occur when accessing GitHub's API from a different domain.
                        // They do not affect functionality and can be safely ignored.
                        const response = await fetch(apiUrl, { headers });
                        if (response.ok) {
                            latestDockerCompose = await response.text();
                            console.log('🔍 ANALYSIS: Successfully fetched from main branch via API');
                        } else if (response.status === 404) {
                            // Try master branch instead
                            apiUrl = `https://api.github.com/repos/${owner}/${repoName}/contents/docker-compose.yml?ref=master`;
                            console.log('🔍 ANALYSIS: Trying GitHub API with master branch');

                            const masterResponse = await fetch(apiUrl, { headers });
                            if (masterResponse.ok) {
                                latestDockerCompose = await masterResponse.text();
                                console.log('🔍 ANALYSIS: Successfully fetched from master branch via API');
                            } else {
                                console.warn('🔍 ANALYSIS: GitHub API returned:', response.status, await response.text());
                            }
                        } else {
                            console.warn('🔍 ANALYSIS: GitHub API returned:', response.status, await response.text());
                        }
                    } catch (fetchError) {
                        console.warn('🔍 ANALYSIS: Failed to fetch from GitHub API:', fetchError);
                    }
                }
            }

            if (latestDockerCompose) {
                console.log('🔍 ANALYSIS: Latest docker-compose length:', latestDockerCompose.length);
            } else {
                console.log('🔍 ANALYSIS: Could not fetch from GitHub, using fallback');
                latestDockerCompose = repo.rawDockerCompose;
            }
        } catch (error) {
            console.warn('🔍 ANALYSIS: Error during GitHub fetch:', error);
            latestDockerCompose = repo.rawDockerCompose;
            console.log('🔍 ANALYSIS: Using fallback rawDockerCompose');
        }

        // If we still don't have both, proceed with normal installation
        if (!currentDockerCompose || !latestDockerCompose) {
            console.log('🔍 ANALYSIS: Missing data after all attempts, proceeding with normal installation');
            return { proceed: true, composeChanged: false };
        }

        const currentTrimmed = currentDockerCompose.trim();
        const latestTrimmed = latestDockerCompose.trim();

        console.log('🔍 ANALYSIS: Comparing docker-compose files using smart comparison...');

        // Smart comparison: ignore environment variable values, focus on structure
        const structuralChanges = this.compareDockerComposeStructure(currentTrimmed, latestTrimmed);
        console.log('🔍 ANALYSIS: Structural changes detected:', structuralChanges);

        if (!structuralChanges) {
            // No structural changes, proceed with normal installation
            console.log('🔍 ANALYSIS: No structural changes detected, proceeding with normal installation');
            return { proceed: true, composeChanged: false };
        }

        // Structural changes detected, return change info for comparison popup
        console.log('🔍 ANALYSIS: Changes detected! Showing comparison popup');
        return {
            proceed: true,
            composeChanged: true,
            composeChangeInfo: {
                oldCompose: currentDockerCompose, // What user currently has
                newCompose: latestDockerCompose,  // Latest from GitHub
                modifiedCompose: currentDockerCompose // User's current version
            }
        };
    }

    async showReinstallConfirmation(repo) {
        return new Promise((resolve) => {
            // Create reinstall confirmation popup
            const popup = document.createElement('div');
            popup.id = 'reinstall-confirmation';
            popup.innerHTML = `
                <div class="uninstall-backdrop"></div>
                <div class="uninstall-container">
                    <div class="uninstall-header">
                        <div class="uninstall-icon">🔄</div>
                        <h2>Re-install Application</h2>
                    </div>
                    <div class="uninstall-content">
                        <p><strong>Are you sure you want to re-install "${repo.displayName || repo.name}"?</strong></p>

                        <div class="uninstall-notice">
                            <p><i class="fas fa-info-circle"></i> This will rebuild and redeploy the application with the latest configuration.</p>
                        </div>

                        <div class="data-preservation">
                            <div class="data-option">
                                <label class="data-checkbox">
                                    <input type="checkbox" id="reinstall-delete-data">
                                    <span class="data-checkmark"></span>
                                    <span class="data-label">Delete application data before re-install</span>
                                </label>
                            </div>
                            <div class="data-option">
                                <label class="data-checkbox">
                                    <input type="checkbox" id="reinstall-run-preinstall">
                                    <span class="data-checkmark"></span>
                                    <span class="data-label">Run pre-install command (if exists)</span>
                                </label>
                            </div>
                        </div>

                        <div class="uninstall-warning">
                            <p><strong>⚠️ Important Information</strong></p>
                            <ul>
                                <li>The application will be temporarily stopped during re-installation</li>
                                <li>Any unsaved data in the containers will be lost</li>
                                <li>The process may take several minutes to complete</li>
                            </ul>
                        </div>
                    </div>
                    <div class="uninstall-actions">
                        <button class="btn btn-secondary" id="cancel-reinstall">Cancel</button>
                        <button class="btn btn-warning" id="confirm-reinstall">Re-install Application</button>
                    </div>
                </div>

                <style>
                #reinstall-confirmation {
                    position: fixed;
                    top: 0; left: 0; right: 0; bottom: 0;
                    z-index: 10000;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
                    animation: fadeIn 0.15s ease-out;
                }
                </style>
            `;

            // Ensure reinstall popup styles are available (inject only if not already present)
            if (!document.getElementById('reinstall-popup-styles')) {
                const style = document.createElement('style');
                style.id = 'reinstall-popup-styles';
                style.textContent = `
                    .uninstall-backdrop {
                        position: absolute;
                        top: 0; left: 0; right: 0; bottom: 0;
                        background: rgba(0, 0, 0, 0.8);
                        backdrop-filter: blur(4px);
                    }

                    .uninstall-container {
                        position: relative;
                        width: 90%;
                        max-width: 500px;
                        max-height: 80vh;
                        background: white;
                        border-radius: 12px;
                        box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
                        display: flex;
                        flex-direction: column;
                    }

                    .uninstall-header {
                        background: #dc2626;
                        color: white;
                        padding: 20px;
                        border-radius: 12px 12px 0 0;
                        display: flex;
                        align-items: center;
                        gap: 12px;
                    }

                    .uninstall-icon {
                        font-size: 24px;
                    }

                    .uninstall-header h2 {
                        margin: 0;
                        font-size: 20px;
                        color: white;
                    }

                    .uninstall-content {
                        padding: 20px;
                        overflow-y: auto;
                        flex: 1;
                    }

                    .uninstall-notice {
                        background: #f0f9ff;
                        border: 1px solid #0ea5e9;
                        border-radius: 8px;
                        padding: 12px;
                        margin: 16px 0;
                        color: #0c4a6e;
                    }

                    .uninstall-notice i {
                        margin-right: 8px;
                    }

                    .uninstall-warning {
                        background: #fef2f2;
                        border: 1px solid #f87171;
                        border-radius: 8px;
                        padding: 12px;
                        margin: 16px 0;
                        color: #991b1b;
                    }

                    .uninstall-warning strong {
                        display: block;
                        margin-bottom: 8px;
                    }

                    .uninstall-warning ul {
                        margin: 8px 0 0 0;
                        padding-left: 20px;
                    }

                    .uninstall-warning li {
                        margin-bottom: 4px;
                    }

                    .uninstall-actions {
                        padding: 20px;
                        border-top: 1px solid #e5e7eb;
                        display: flex;
                        gap: 12px;
                        justify-content: flex-end;
                    }
                `;
                document.head.appendChild(style);
            }

            document.body.appendChild(popup);

            // Handle cancel
            const cancelBtn = document.getElementById('cancel-reinstall');
            const confirmBtn = document.getElementById('confirm-reinstall');

            cancelBtn.onclick = () => {
                document.body.removeChild(popup);
                resolve(false);
            };

            // Handle confirmation
            confirmBtn.onclick = () => {
                const deleteData = document.getElementById('reinstall-delete-data').checked;
                const runPreInstall = document.getElementById('reinstall-run-preinstall').checked;
                document.body.removeChild(popup);
                resolve({ proceed: true, deleteData, runPreInstall });
            };

            // Handle click on backdrop
            popup.querySelector('.uninstall-backdrop').addEventListener('click', () => {
                document.body.removeChild(popup);
                resolve(false);
            });

            // Handle escape key
            const escapeHandler = (e) => {
                if (e.key === 'Escape') {
                    document.body.removeChild(popup);
                    document.removeEventListener('keydown', escapeHandler);
                    resolve(false);
                }
            };
            document.addEventListener('keydown', escapeHandler);
        });
    }

    async showPreInstallWarning(repo, preInstallCommand) {
        return new Promise((resolve) => {
            // Create warning popup
            const popup = document.createElement('div');
            popup.id = 'pre-install-warning';
            popup.innerHTML = `
                <div class="warning-backdrop"></div>
                <div class="warning-container">
                    <div class="warning-header">
                        <div class="warning-icon">⚠️</div>
                        <h2>Security Warning</h2>
                    </div>
                    <div class="warning-content">
                        <p><strong>${repo.name}</strong> uses pre-installation commands that will execute with full system privileges.</p>
                        
                        <div class="warning-explanation">
                            <h3>Why pre-install commands are sometimes needed:</h3>
                            <ul>
                                <li>Creating host directories with specific permissions</li>
                                <li>Installing system dependencies</li>
                                <li>Configuring network settings</li>
                                <li>Setting up SSL certificates or keys</li>
                            </ul>
                        </div>

                        <div class="command-preview">
                            <h3>Command to be executed:</h3>
                            <textarea readonly class="command-text">${preInstallCommand}</textarea>
                        </div>

                        <div class="user-selection">
                            <h3>Run pre-install command as:</h3>
                            <div class="radio-group">
                                <label class="radio-option">
                                    <input type="radio" name="run-as-user" value="ubuntu" checked>
                                    <span class="radio-mark"></span>
                                    <div class="radio-content">
                                        <strong>Ubuntu User (Recommended)</strong>
                                        <div class="radio-description">Run with standard user permissions - safer option</div>
                                    </div>
                                </label>
                                <label class="radio-option">
                                    <input type="radio" name="run-as-user" value="root">
                                    <span class="radio-mark"></span>
                                    <div class="radio-content">
                                        <strong>Root User</strong>
                                        <div class="radio-description">Run with administrator privileges - use only if required</div>
                                    </div>
                                </label>
                                <label class="radio-option">
                                    <input type="radio" name="run-as-user" value="custom">
                                    <span class="radio-mark"></span>
                                    <div class="radio-content">
                                        <strong>Custom User</strong>
                                        <div class="radio-description">
                                            Specify a custom username:
                                            <input type="text" id="custom-username" placeholder="Enter username" disabled>
                                        </div>
                                    </div>
                                </label>
                            </div>
                        </div>

                        <div class="risk-warning">
                            <p><strong>⚠️ These commands have full access to your system and can:</strong></p>
                            <ul>
                                <li>Modify any files on your server</li>
                                <li>Install software or change system settings</li>
                                <li>Access sensitive data or credentials</li>
                                <li>Potentially compromise system security</li>
                            </ul>
                        </div>

                    </div>
                    <div class="warning-actions">
                        <div class="consent-section">
                            <label class="consent-checkbox">
                                <input type="checkbox" id="understand-risks">
                                <span class="checkmark"></span>
                                I understand the risks and have reviewed the command above. I trust the developer of this application.
                            </label>
                        </div>
                        <div class="action-buttons">
                            <button class="btn btn-secondary" id="cancel-install">Cancel</button>
                            <button class="btn btn-danger" id="proceed-install" disabled>Install Anyway</button>
                        </div>
                    </div>
                </div>
            `;

            // Add styles
            const style = document.createElement('style');
            style.textContent = `
                #pre-install-warning {
                    position: fixed;
                    top: 0; left: 0; right: 0; bottom: 0;
                    z-index: 10000;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                }
                
                .warning-backdrop {
                    position: absolute;
                    top: 0; left: 0; right: 0; bottom: 0;
                    background: rgba(0, 0, 0, 0.8);
                    backdrop-filter: blur(4px);
                }
                
                .warning-container {
                    position: relative;
                    width: 90%;
                    max-width: 600px;
                    max-height: 80vh;
                    background: white;
                    border-radius: 12px;
                    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
                    overflow: hidden;
                    display: flex;
                    flex-direction: column;
                }
                
                .warning-header {
                    background: #dc2626;
                    color: white;
                    padding: 20px;
                    display: flex;
                    align-items: center;
                    gap: 12px;
                }
                
                .warning-icon {
                    font-size: 24px;
                }
                
                .warning-header h2 {
                    margin: 0;
                    font-size: 20px;
                }
                
                .warning-content {
                    padding: 20px;
                    overflow-y: auto;
                    flex: 1;
                }
                
                .warning-explanation {
                    background: #f3f4f6;
                    padding: 16px;
                    border-radius: 8px;
                    margin: 16px 0;
                }
                
                .warning-explanation h3 {
                    margin: 0 0 12px 0;
                    color: #374151;
                    font-size: 14px;
                }
                
                .warning-explanation ul {
                    margin: 0;
                    padding-left: 20px;
                    color: #6b7280;
                    font-size: 13px;
                }
                
                .command-preview {
                    margin: 16px 0;
                }
                
                .command-preview h3 {
                    margin: 0 0 8px 0;
                    color: #374151;
                    font-size: 14px;
                }
                
                .command-text {
                    width: 100%;
                    height: 200px;
                    padding: 12px;
                    border: 1px solid #d1d5db;
                    border-radius: 6px;
                    font-family: 'Monaco', 'Menlo', monospace;
                    font-size: 12px;
                    background: #f9fafb;
                    resize: none;
                }
                
                .risk-warning {
                    background: #fef2f2;
                    border: 1px solid #fecaca;
                    padding: 16px;
                    border-radius: 8px;
                    margin: 16px 0;
                }
                
                .risk-warning p {
                    margin: 0 0 8px 0;
                    color: #dc2626;
                    font-weight: 600;
                }
                
                .risk-warning ul {
                    margin: 0;
                    padding-left: 20px;
                    color: #dc2626;
                }
                
                .consent-section {
                    margin: 0;
                    flex: 1;
                }
                
                .consent-checkbox {
                    display: flex;
                    align-items: center;
                    gap: 12px;
                    cursor: pointer;
                    user-select: none;
                }
                
                .consent-checkbox input[type="checkbox"] {
                    width: 18px;
                    height: 18px;
                    cursor: pointer;
                }
                
                .user-selection {
                    background: #f8fafc;
                    border: 1px solid #e2e8f0;
                    border-radius: 8px;
                    padding: 16px;
                    margin: 16px 0;
                }
                
                .user-selection h3 {
                    margin: 0 0 12px 0;
                    color: #374151;
                    font-size: 16px;
                }
                
                .radio-group {
                    display: flex;
                    flex-direction: column;
                    gap: 12px;
                }
                
                .radio-option {
                    display: flex;
                    align-items: flex-start;
                    gap: 12px;
                    padding: 12px;
                    border: 2px solid #e5e7eb;
                    border-radius: 8px;
                    cursor: pointer;
                    transition: all 0.2s ease;
                }
                
                .radio-option:hover {
                    border-color: #3b82f6;
                    background: #f0f9ff;
                }
                
                .radio-option input[type="radio"]:checked + .radio-mark + .radio-content {
                    color: #1e40af;
                }
                
                .radio-option input[type="radio"]:checked {
                    border-color: #3b82f6;
                    background: #3b82f6;
                }
                
                .radio-mark {
                    width: 16px;
                    height: 16px;
                    border: 2px solid #d1d5db;
                    border-radius: 50%;
                    background: white;
                    flex-shrink: 0;
                    position: relative;
                }
                
                .radio-option input[type="radio"] {
                    display: none;
                }
                
                .radio-option input[type="radio"]:checked + .radio-mark {
                    border-color: #3b82f6;
                    background: #3b82f6;
                }
                
                .radio-option input[type="radio"]:checked + .radio-mark::after {
                    content: '';
                    position: absolute;
                    top: 2px;
                    left: 2px;
                    width: 8px;
                    height: 8px;
                    background: white;
                    border-radius: 50%;
                }
                
                .radio-content {
                    flex: 1;
                }
                
                .radio-content strong {
                    display: block;
                    margin-bottom: 4px;
                    font-weight: 600;
                }
                
                .radio-description {
                    font-size: 14px;
                    color: #6b7280;
                    line-height: 1.4;
                }
                
                #custom-username {
                    margin-top: 8px;
                    padding: 6px 8px;
                    border: 1px solid #d1d5db;
                    border-radius: 4px;
                    width: 200px;
                    font-size: 14px;
                }
                
                #custom-username:disabled {
                    background: #f3f4f6;
                    color: #9ca3af;
                }
                
                .warning-actions {
                    padding: 16px 20px;
                    border-top: 1px solid #e5e7eb;
                    display: flex;
                    align-items: center;
                    gap: 20px;
                    justify-content: space-between;
                }
                
                .action-buttons {
                    display: flex;
                    gap: 12px;
                }
                
                .btn:disabled {
                    opacity: 0.5;
                    cursor: not-allowed;
                }
            `;
            
            document.head.appendChild(style);
            document.body.appendChild(popup);

            // Handle radio button state and custom username input
            const radioButtons = document.querySelectorAll('input[name="run-as-user"]');
            const customUsernameInput = document.getElementById('custom-username');
            
            radioButtons.forEach(radio => {
                radio.addEventListener('change', () => {
                    customUsernameInput.disabled = radio.value !== 'custom';
                    if (radio.value !== 'custom') {
                        customUsernameInput.value = '';
                    }
                });
            });
            
            // Handle checkbox state and button clicks
            const checkbox = document.getElementById('understand-risks');
            const proceedBtn = document.getElementById('proceed-install');
            const cancelBtn = document.getElementById('cancel-install');
            
            checkbox.addEventListener('change', () => {
                proceedBtn.disabled = !checkbox.checked;
            });

            cancelBtn.addEventListener('click', () => {
                popup.remove();
                resolve(false);
            });

            proceedBtn.addEventListener('click', () => {
                // Get selected user option
                const selectedUser = document.querySelector('input[name="run-as-user"]:checked').value;
                let runAsUser = selectedUser;
                
                if (selectedUser === 'custom') {
                    const customUsername = customUsernameInput.value.trim();
                    if (!customUsername) {
                        alert('Please enter a custom username or select a different option.');
                        return;
                    }
                    runAsUser = customUsername;
                }
                
                popup.remove();
                resolve({ proceed: true, runAsUser: runAsUser });
            });
        });
    }

    async showUninstallConfirmation(repo) {
        return new Promise((resolve) => {
            // Create uninstall confirmation popup
            const popup = document.createElement('div');
            popup.id = 'uninstall-confirmation';
            popup.innerHTML = `
                <div class="uninstall-backdrop"></div>
                <div class="uninstall-container">
                    <div class="uninstall-header">
                        <div class="uninstall-icon">🗑️</div>
                        <h2>Remove Repository</h2>
                    </div>
                    <div class="uninstall-content">
                        <p><strong>Are you sure you want to remove "${repo.displayName || repo.name}"?</strong></p>
                        
                        ${repo.isInstalled ? 
                            `<div class="uninstall-notice">
                                <p><i class="fas fa-info-circle"></i> This will uninstall the app from CasaOS and remove the repository.</p>
                            </div>` : 
                            `<div class="uninstall-notice">
                                <p><i class="fas fa-info-circle"></i> This will remove the repository and associated configuration files.</p>
                            </div>`
                        }

                        <div class="data-preservation">
                            <h3>Data Handling</h3>
                            <div class="data-option">
                                <label class="data-checkbox">
                                    <input type="checkbox" id="preserve-app-data" ${!repo.isInstalled ? 'disabled' : ''}>
                                    <span class="data-checkmark"></span>
                                    <div class="data-content">
                                        <strong>Also delete application data</strong>
                                        <div class="data-description">
                                            ${repo.isInstalled ?
                                                'By default, data in /DATA/AppData/' + (repo.appName || repo.name) + '/ will be preserved. Check this to delete it permanently.' :
                                                'No application data to delete (app is not installed).'
                                            }
                                        </div>
                                    </div>
                                </label>
                            </div>
                        </div>

                        <div class="uninstall-warning">
                            <p><strong>⚠️ This action cannot be undone</strong></p>
                            <ul>
                                <li>Repository configuration will be permanently removed</li>
                                ${repo.isInstalled ? '<li>Application will be uninstalled from CasaOS</li>' : ''}
                                <li>Without data preservation, all settings and user data will be lost</li>
                            </ul>
                        </div>
                    </div>
                    <div class="uninstall-actions">
                        <button class="btn btn-secondary" id="cancel-uninstall">Cancel</button>
                        <button class="btn btn-danger" id="confirm-uninstall">Remove Repository</button>
                    </div>
                </div>
            `;

            // Add styles (only if not already present)
            if (!document.getElementById('uninstall-popup-styles')) {
                const style = document.createElement('style');
                style.id = 'uninstall-popup-styles';
                style.textContent = `
                    #uninstall-confirmation {
                        position: fixed;
                        top: 0; left: 0; right: 0; bottom: 0;
                        z-index: 10000;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                    }

                .uninstall-backdrop {
                    position: absolute;
                    top: 0; left: 0; right: 0; bottom: 0;
                    background: rgba(0, 0, 0, 0.8);
                    backdrop-filter: blur(4px);
                }

                .uninstall-container {
                    position: relative;
                    width: 90%;
                    max-width: 500px;
                    max-height: 80vh;
                    background: white;
                    border-radius: 12px;
                    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
                    display: flex;
                    flex-direction: column;
                }
                
                .uninstall-header {
                    background: #dc2626;
                    color: white;
                    padding: 20px;
                    border-radius: 12px 12px 0 0;
                    display: flex;
                    align-items: center;
                    gap: 12px;
                }
                
                .uninstall-icon {
                    font-size: 24px;
                }
                
                .uninstall-header h2 {
                    margin: 0;
                    font-size: 20px;
                }
                
                .uninstall-content {
                    padding: 20px;
                    overflow-y: auto;
                    flex: 1;
                }
                
                .uninstall-notice {
                    background: #f0f9ff;
                    border: 1px solid #0ea5e9;
                    border-radius: 8px;
                    padding: 12px;
                    margin: 16px 0;
                    color: #0c4a6e;
                }
                
                .uninstall-notice i {
                    margin-right: 8px;
                }
                
                .data-preservation {
                    background: #f8fafc;
                    border: 1px solid #e2e8f0;
                    border-radius: 8px;
                    padding: 16px;
                    margin: 16px 0;
                }
                
                .data-preservation h3 {
                    margin: 0 0 12px 0;
                    color: #374151;
                    font-size: 16px;
                }
                
                .data-option {
                    display: flex;
                    align-items: flex-start;
                }
                
                .data-checkbox {
                    display: flex;
                    align-items: flex-start;
                    gap: 12px;
                    cursor: pointer;
                    width: 100%;
                }
                
                .data-checkbox input[type="checkbox"] {
                    display: none;
                }
                
                .data-checkmark {
                    width: 18px;
                    height: 18px;
                    border: 2px solid #d1d5db;
                    border-radius: 4px;
                    background: white;
                    flex-shrink: 0;
                    position: relative;
                    margin-top: 2px;
                }
                
                .data-checkbox input[type="checkbox"]:checked + .data-checkmark {
                    border-color: #059669;
                    background: #059669;
                }
                
                .data-checkbox input[type="checkbox"]:checked + .data-checkmark::after {
                    content: '✓';
                    position: absolute;
                    top: -2px;
                    left: 2px;
                    color: white;
                    font-size: 14px;
                    font-weight: bold;
                }
                
                .data-checkbox input[type="checkbox"]:disabled + .data-checkmark {
                    background: #f3f4f6;
                    border-color: #d1d5db;
                    cursor: not-allowed;
                }
                
                .data-checkbox:has(input:disabled) {
                    cursor: not-allowed;
                    opacity: 0.6;
                }
                
                .data-content {
                    flex: 1;
                }
                
                .data-content strong {
                    display: block;
                    margin-bottom: 4px;
                    font-weight: 600;
                }
                
                .data-description {
                    font-size: 14px;
                    color: #6b7280;
                    line-height: 1.4;
                }
                
                .uninstall-warning {
                    background: #fef2f2;
                    border: 1px solid #fecaca;
                    border-radius: 8px;
                    padding: 16px;
                    margin: 16px 0;
                }
                
                .uninstall-warning p {
                    margin: 0 0 8px 0;
                    color: #dc2626;
                    font-weight: 600;
                }
                
                .uninstall-warning ul {
                    margin: 0;
                    padding-left: 20px;
                    color: #dc2626;
                }
                
                .uninstall-actions {
                    padding: 16px 20px;
                    border-top: 1px solid #e5e7eb;
                    display: flex;
                    gap: 12px;
                    justify-content: flex-end;
                }
                `;
                document.head.appendChild(style);
            }
            document.body.appendChild(popup);

            // Handle button clicks
            const cancelBtn = document.getElementById('cancel-uninstall');
            const confirmBtn = document.getElementById('confirm-uninstall');
            const preserveDataCheckbox = document.getElementById('preserve-app-data');

            cancelBtn.addEventListener('click', () => {
                popup.remove();
                resolve({ proceed: false });
            });

            confirmBtn.addEventListener('click', () => {
                // Checkbox checked = delete data, unchecked = preserve data (default)
                const preserveData = !preserveDataCheckbox.checked;
                popup.remove();
                resolve({ proceed: true, preserveData: preserveData });
            });
        });
    }

    checkFirstTimeUser() {
        const hasAcceptedRisks = localStorage.getItem('yundera-risks-accepted');
        if (!hasAcceptedRisks) {
            this.showFirstTimeRiskWarning();
        }
    }

    showFirstTimeRiskWarning() {
        const popup = document.createElement('div');
        popup.id = 'first-time-warning';
        popup.innerHTML = `
            <div class="first-time-backdrop"></div>
            <div class="first-time-container">
                <div class="first-time-header">
                    <div class="first-time-icon">⚠️</div>
                    <h2>Risks of Using Unreviewed Yundera Custom Apps</h2>
                </div>
                <div class="first-time-content">
                    <div class="overview">
                        <h3>Overview</h3>
                        <p>Custom CasaOS compose applications that have not undergone security review pose significant risks to system stability and security.</p>
                    </div>

                    <div class="risks-section">
                        <h3>Key Risks:</h3>
                        
                        <div class="risk-item">
                            <h4>1. Resource Management Issues</h4>
                            <ul>
                                <li>Unreviewed applications may lack proper resource limit configurations</li>
                                <li>Applications without resource limits can consume excessive RAM and CPU resources</li>
                                <li>This can lead to system-wide Denial of Service (DOS), affecting all running services</li>
                                <li>When resource limits are properly configured, only the problematic application is affected</li>
                            </ul>
                        </div>

                        <div class="risk-item">
                            <h4>2. File Permission Corruption</h4>
                            <ul>
                                <li>Unreviewed applications may incorrectly modify file access permissions</li>
                                <li>This can render the Personal Cloud Server (PCS) inaccessible through the standard user interface</li>
                                <li>Recovery requires SSH access for manual permission correction</li>
                            </ul>
                        </div>

                        <div class="risk-item">
                            <h4>3. Data Loss Risk</h4>
                            <ul>
                                <li>Unreviewed applications may not have persistent data volumes properly configured</li>
                                <li>Without correct persistence settings, application data may be stored in ephemeral containers</li>
                                <li>Container updates, restarts, or crashes can result in permanent data loss</li>
                                <li>Critical user data and configurations may be irretrievably lost</li>
                            </ul>
                        </div>
                    </div>

                    <div class="best-practice">
                        <h3>Best Practice</h3>
                        <p><strong>Only install reviewed and approved applications on production systems. Use dedicated test environments for evaluating new applications before deployment.</strong></p>
                    </div>

                    <div class="consent-section">
                        <label class="consent-checkbox">
                            <input type="checkbox" id="accept-risks">
                            <span class="checkmark"></span>
                            I understand these risks and accept responsibility for any damage that may occur to my system or data.
                        </label>
                    </div>
                </div>
                <div class="first-time-actions">
                    <button class="btn btn-danger" id="accept-risks-btn" disabled>I Accept the Risks</button>
                </div>
            </div>
        `;

        // Add styles
        const style = document.createElement('style');
        style.textContent = `
            #first-time-warning {
                position: fixed;
                top: 0; left: 0; right: 0; bottom: 0;
                z-index: 10001;
                display: flex;
                align-items: center;
                justify-content: center;
            }
            
            .first-time-backdrop {
                position: absolute;
                top: 0; left: 0; right: 0; bottom: 0;
                background: rgba(0, 0, 0, 0.9);
                backdrop-filter: blur(4px);
            }
            
            .first-time-container {
                position: relative;
                width: 95%;
                max-width: 800px;
                max-height: 90vh;
                background: white;
                border-radius: 12px;
                box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
                overflow: hidden;
                display: flex;
                flex-direction: column;
            }
            
            .first-time-header {
                background: #dc2626;
                color: white;
                padding: 20px;
                display: flex;
                align-items: center;
                gap: 12px;
            }
            
            .first-time-icon {
                font-size: 28px;
            }
            
            .first-time-header h2 {
                margin: 0;
                font-size: 22px;
            }
            
            .first-time-content {
                padding: 24px;
                overflow-y: auto;
                flex: 1;
            }
            
            .overview {
                margin-bottom: 24px;
            }
            
            .overview h3 {
                margin: 0 0 12px 0;
                color: #dc2626;
                font-size: 18px;
            }
            
            .overview p {
                margin: 0;
                color: #374151;
                line-height: 1.6;
            }
            
            .risks-section h3 {
                margin: 0 0 16px 0;
                color: #dc2626;
                font-size: 18px;
            }
            
            .risk-item {
                margin-bottom: 20px;
                padding: 16px;
                background: #fef2f2;
                border: 1px solid #fecaca;
                border-radius: 8px;
            }
            
            .risk-item h4 {
                margin: 0 0 8px 0;
                color: #dc2626;
                font-size: 16px;
            }
            
            .risk-item ul {
                margin: 0;
                padding-left: 20px;
                color: #374151;
            }
            
            .risk-item li {
                margin-bottom: 4px;
                line-height: 1.5;
            }
            
            .best-practice {
                margin: 24px 0;
                padding: 16px;
                background: #f0f9ff;
                border: 1px solid #bae6fd;
                border-radius: 8px;
            }
            
            .best-practice h3 {
                margin: 0 0 8px 0;
                color: #0369a1;
                font-size: 16px;
            }
            
            .best-practice p {
                margin: 0;
                color: #0369a1;
                line-height: 1.6;
            }
            
            .first-time-actions {
                padding: 20px 24px;
                border-top: 1px solid #e5e7eb;
                display: flex;
                justify-content: center;
            }
        `;
        
        document.head.appendChild(style);
        document.body.appendChild(popup);

        // Handle acceptance
        const checkbox = document.getElementById('accept-risks');
        const acceptBtn = document.getElementById('accept-risks-btn');
        
        checkbox.addEventListener('change', () => {
            acceptBtn.disabled = !checkbox.checked;
        });

        acceptBtn.addEventListener('click', () => {
            localStorage.setItem('yundera-risks-accepted', 'true');
            popup.remove();
        });
    }

    openInteractiveTerminal() {
        // Initialize terminal session state
        this.terminalSession = {
            currentDir: '/',
            envVars: {},
            user: 'ubuntu',
            commandHistory: [],
            historyIndex: -1,
            directoryCache: new Map() // Cache directory listings for faster autocomplete
        };
        
        // Create terminal popup
        let terminal = document.getElementById('interactive-terminal-popup');
        if (terminal) {
            terminal.remove();
        }

        terminal = document.createElement('div');
        terminal.id = 'interactive-terminal-popup';
        terminal.innerHTML = `
            <div class="terminal-backdrop" onclick="this.parentElement.remove()"></div>
            <div class="terminal-container">
                <div class="terminal-header">
                    <div class="terminal-title">
                        <i class="fas fa-terminal"></i>
                        Interactive Terminal
                    </div>
                    <div class="terminal-controls">
                        <div class="user-selector">
                            <label for="terminal-user">Run as:</label>
                            <select id="terminal-user">
                                <option value="ubuntu">Ubuntu</option>
                                <option value="root">Root</option>
                                <option value="custom">Custom</option>
                            </select>
                            <input type="text" id="custom-user" placeholder="Enter username" style="display: none; margin-left: 5px; padding: 2px 5px;">
                        </div>
                        <button class="terminal-btn" onclick="document.getElementById('interactive-terminal-popup').remove()">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>
                </div>
                <div class="terminal-body">
                    <div class="terminal-sidebar" id="terminal-sidebar">
                        <div class="sidebar-header">
                            <span class="sidebar-title">Files</span>
                            <button id="refresh-files-btn" class="terminal-btn" title="Refresh directory listing">
                                <i class="fas fa-sync-alt"></i>
                            </button>
                        </div>
                        <div class="sidebar-path" id="sidebar-current-path">/</div>
                        <div class="file-list" id="file-browser">
                            <div class="loading-files">Loading...</div>
                        </div>
                    </div>
                    <div class="terminal-content" id="terminal-output">
                        <div class="log-line system">🖥️ Interactive Terminal Ready</div>
                    </div>
                </div>
                <div class="terminal-input-section">
                    <div class="terminal-prompt">
                        <span id="terminal-prompt-text">ubuntu@casaos:/$</span>
                        <input type="text" id="terminal-command-input" placeholder="Enter command..." autocomplete="off">
                        <div class="terminal-controls">
                            <button id="history-prev-btn" class="terminal-btn" title="Previous command (↑)" disabled>
                                <i class="fas fa-chevron-up"></i>
                            </button>
                            <button id="history-next-btn" class="terminal-btn" title="Next command (↓)" disabled>
                                <i class="fas fa-chevron-down"></i>
                            </button>
                            <button id="terminal-execute-btn" class="terminal-btn" title="Execute command (Enter)">
                                <i class="fas fa-play"></i>
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        `;

        // Add enhanced styles for interactive terminal
        const style = document.createElement('style');
        style.textContent = `
            #interactive-terminal-popup {
                position: fixed;
                top: 0; left: 0; right: 0; bottom: 0;
                z-index: 9999;
                display: flex;
                align-items: center;
                justify-content: center;
                animation: fadeIn 0.2s ease;
            }
            
            #interactive-terminal-popup .terminal-backdrop {
                position: absolute;
                top: 0; left: 0; right: 0; bottom: 0;
                background: rgba(0, 0, 0, 0.7);
                backdrop-filter: blur(4px);
            }
            
            #interactive-terminal-popup .terminal-container {
                position: relative;
                width: 95%;
                max-width: 1400px;
                height: 80%;
                max-height: 800px;
                background: #1a1a1a;
                border-radius: 12px;
                border: 1px solid #333;
                display: flex;
                flex-direction: column;
                box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
            }
            
            #interactive-terminal-popup .terminal-header {
                background: #2d2d2d;
                padding: 12px 16px;
                border-radius: 12px 12px 0 0;
                display: flex;
                justify-content: space-between;
                align-items: center;
                border-bottom: 1px solid #333;
            }
            
            #interactive-terminal-popup .terminal-title {
                color: #fff;
                font-weight: 600;
                display: flex;
                align-items: center;
                gap: 8px;
            }
            
            #interactive-terminal-popup .terminal-controls {
                display: flex;
                align-items: center;
                gap: 15px;
            }
            
            #interactive-terminal-popup .user-selector {
                display: flex;
                align-items: center;
                gap: 5px;
                color: #ccc;
                font-size: 12px;
            }
            
            #interactive-terminal-popup .user-selector select {
                background: #333;
                color: #fff;
                border: 1px solid #555;
                border-radius: 4px;
                padding: 2px 5px;
                font-size: 12px;
            }
            
            #interactive-terminal-popup .user-selector input {
                background: #333;
                color: #fff;
                border: 1px solid #555;
                border-radius: 4px;
                font-size: 12px;
                width: 100px;
            }
            
            #interactive-terminal-popup .terminal-btn {
                background: transparent;
                border: none;
                color: #888;
                padding: 4px 8px;
                cursor: pointer;
                border-radius: 4px;
                transition: all 0.2s;
            }
            
            #interactive-terminal-popup .terminal-btn:hover {
                background: #444;
                color: #fff;
            }
            
            #interactive-terminal-popup .terminal-body {
                flex: 1;
                overflow: hidden;
                display: flex;
                flex-direction: row;
            }
            
            #interactive-terminal-popup .terminal-content {
                flex: 1;
                overflow-y: auto;
                padding: 16px;
                font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
                font-size: 13px;
                line-height: 1.5;
                background: #1a1a1a;
                color: #e0e0e0;
            }
            
            #interactive-terminal-popup .terminal-input-section {
                background: #2d2d2d;
                border-top: 1px solid #333;
                padding: 12px 16px;
            }
            
            #interactive-terminal-popup .terminal-prompt {
                display: flex;
                align-items: center;
                gap: 8px;
                font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
                font-size: 13px;
            }
            
            #interactive-terminal-popup .terminal-controls {
                display: flex;
                align-items: center;
                gap: 4px;
            }
            
            #interactive-terminal-popup .terminal-prompt span {
                color: #81c784;
                white-space: nowrap;
            }
            
            #interactive-terminal-popup .terminal-prompt input {
                flex: 1;
                background: transparent;
                border: none;
                color: #e0e0e0;
                font-family: inherit;
                font-size: inherit;
                outline: none;
                padding: 4px 0;
            }
            
            #interactive-terminal-popup .log-line {
                margin: 2px 0;
                word-break: break-all;
                white-space: pre-wrap;
            }
            
            #interactive-terminal-popup .log-line.system { color: #64b5f6; }
            #interactive-terminal-popup .log-line.success { color: #81c784; }
            #interactive-terminal-popup .log-line.error { color: #e57373; }
            #interactive-terminal-popup .log-line.warning { color: #ffb74d; }
            #interactive-terminal-popup .log-line.info { color: #90caf9; }
            #interactive-terminal-popup .log-line.command { color: #81c784; }
            #interactive-terminal-popup .log-line.output { color: #e0e0e0; }
            
            /* Sidebar styles */
            #interactive-terminal-popup .terminal-sidebar {
                width: 280px;
                min-width: 280px;
                background: #2d2d2d;
                border-right: 1px solid #333;
                display: flex;
                flex-direction: column;
                overflow: hidden;
            }
            
            #interactive-terminal-popup .sidebar-header {
                padding: 8px 12px;
                background: #333;
                border-bottom: 1px solid #444;
                display: flex;
                justify-content: space-between;
                align-items: center;
            }
            
            #interactive-terminal-popup .sidebar-title {
                color: #fff;
                font-weight: 600;
                font-size: 12px;
                text-transform: uppercase;
                letter-spacing: 0.5px;
            }
            
            #interactive-terminal-popup .sidebar-path {
                padding: 8px 12px;
                background: #262626;
                border-bottom: 1px solid #333;
                color: #888;
                font-size: 11px;
                font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
                word-break: break-all;
            }
            
            #interactive-terminal-popup .file-list {
                flex: 1;
                overflow-y: auto;
                padding: 4px 0;
            }
            
            #interactive-terminal-popup .file-item {
                padding: 4px 12px;
                cursor: pointer;
                display: flex;
                align-items: center;
                gap: 8px;
                color: #ccc;
                font-size: 12px;
                font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
                border-bottom: 1px solid transparent;
                transition: all 0.1s;
                user-select: none;
                -webkit-user-select: none;
                -moz-user-select: none;
                -ms-user-select: none;
            }
            
            #interactive-terminal-popup .file-item:hover {
                background: #333;
                color: #fff;
            }
            
            #interactive-terminal-popup .file-item.directory {
                color: #64b5f6;
            }
            
            #interactive-terminal-popup .file-item.file {
                color: #e0e0e0;
            }
            
            #interactive-terminal-popup .file-item.executable {
                color: #81c784;
            }
            
            #interactive-terminal-popup .file-icon {
                width: 14px;
                text-align: center;
                flex-shrink: 0;
            }
            
            #interactive-terminal-popup .file-name {
                flex: 1;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
            }
            
            #interactive-terminal-popup .file-details {
                font-size: 10px;
                color: #666;
                flex-shrink: 0;
            }
            
            #interactive-terminal-popup .loading-files {
                padding: 20px;
                text-align: center;
                color: #888;
                font-size: 12px;
            }
            
            /* File item selection and context menu */
            #interactive-terminal-popup .file-item.selected {
                background: #2563eb;
                color: white;
            }
            
            #interactive-terminal-popup .context-menu {
                position: absolute;
                background: #2d2d2d;
                border: 1px solid #555;
                border-radius: 6px;
                padding: 4px 0;
                box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
                z-index: 100;
                min-width: 150px;
                display: none;
            }
            
            #interactive-terminal-popup .context-menu-item {
                padding: 8px 16px;
                color: #ccc;
                cursor: pointer;
                font-size: 12px;
                display: flex;
                align-items: center;
                gap: 8px;
                transition: background 0.1s;
            }
            
            #interactive-terminal-popup .context-menu-item:hover {
                background: #444;
                color: white;
            }
            
            #interactive-terminal-popup .context-menu-item.disabled {
                color: #666;
                cursor: not-allowed;
            }
            
            #interactive-terminal-popup .context-menu-item.disabled:hover {
                background: transparent;
                color: #666;
            }
            
            #interactive-terminal-popup .context-menu-separator {
                height: 1px;
                background: #555;
                margin: 4px 0;
            }
        `;

        if (!document.getElementById('interactive-terminal-styles')) {
            style.id = 'interactive-terminal-styles';
            document.head.appendChild(style);
        }

        document.body.appendChild(terminal);

        // Set up event handlers
        this.setupInteractiveTerminalHandlers();
    }

    openServiceLogs() {
        console.log('📋 openServiceLogs called');
        
        // Initialize service logs state with persistent terminal sessions
        this.serviceLogsState = {
            selectedService: 'github-compiler',
            services: {
                'github-compiler': { 
                    name: 'GitHub Compiler', 
                    container: 'yunderagithubcompiler',
                    terminalHistory: [],  // Each service keeps its own terminal history
                    logHistory: [],  // Store log messages for this service
                    terminalSession: {
                        currentDir: '/',
                        envVars: {},
                        user: 'ubuntu',
                        commandHistory: [],
                        historyIndex: -1
                    }
                },
                'casaos': { 
                    name: 'CasaOS', 
                    container: 'casaos',
                    terminalHistory: [],
                    logHistory: [],  // Store log messages for this service
                    terminalSession: {
                        currentDir: '/',
                        envVars: {},
                        user: 'ubuntu',
                        commandHistory: [],
                        historyIndex: -1
                    }
                },
                'mesh-router': { 
                    name: 'Mesh Router', 
                    container: 'mesh-router',
                    terminalHistory: [],
                    logHistory: [],  // Store log messages for this service
                    terminalSession: {
                        currentDir: '/',
                        envVars: {},
                        user: 'ubuntu',
                        commandHistory: [],
                        historyIndex: -1
                    }
                },
                'admin': { 
                    name: 'Settings Center', 
                    container: 'admin',
                    isApp: true,  // Force it to use Docker container endpoint instead of service endpoint
                    terminalHistory: [],
                    logHistory: [],  // Store log messages for this service
                    terminalSession: {
                        currentDir: '/',
                        envVars: {},
                        user: 'ubuntu',
                        commandHistory: [],
                        historyIndex: -1
                    }
                }
            }
        };

        // Create service logs popup
        let logsPopup = document.getElementById('service-logs-popup');
        if (logsPopup) {
            logsPopup.remove();
        }

        logsPopup = document.createElement('div');
        logsPopup.id = 'service-logs-popup';
        logsPopup.innerHTML = `
            <div class="terminal-backdrop" onclick="repoManager.closeServiceLogs()"></div>
            <div class="logs-container">
                <div class="logs-header">
                    <div class="logs-title">
                        <i class="fas fa-file-alt"></i>
                        Service Logs
                    </div>
                    <div class="logs-controls">
                        <button class="logs-btn" onclick="repoManager.closeServiceLogs()">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>
                </div>
                <div class="logs-body">
                    <div class="logs-sidebar" id="logs-sidebar">
                        <div class="sidebar-header">
                            <span class="sidebar-title">Services</span>
                        </div>
                        <div class="service-list" id="service-list">
                            <div class="service-item active" data-service="github-compiler">
                                <div class="service-icon"><i class="fas fa-code-branch"></i></div>
                                <div class="service-info">
                                    <div class="service-name">GitHub Compiler</div>
                                    <div class="service-status">Active</div>
                                </div>
                            </div>
                            <div class="service-item" data-service="casaos">
                                <div class="service-icon"><i class="fas fa-home"></i></div>
                                <div class="service-info">
                                    <div class="service-name">CasaOS</div>
                                    <div class="service-status">Running</div>
                                </div>
                            </div>
                            <div class="service-item" data-service="mesh-router">
                                <div class="service-icon"><i class="fas fa-network-wired"></i></div>
                                <div class="service-info">
                                    <div class="service-name">Mesh Router</div>
                                    <div class="service-status">Running</div>
                                </div>
                            </div>
                            <div class="service-item" data-service="admin">
                                <div class="service-icon"><i class="fas fa-cogs"></i></div>
                                <div class="service-info">
                                    <div class="service-name">Settings Center</div>
                                    <div class="service-status">Running</div>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div class="logs-main">
                        <div class="logs-tabs">
                            <button class="logs-tab active" data-tab="logs">
                                <i class="fas fa-file-alt"></i>
                                Logs
                            </button>
                            <button class="logs-tab" data-tab="terminal">
                                <i class="fas fa-terminal"></i>
                                Terminal
                            </button>
                        </div>
                        <div class="logs-content">
                            <div class="logs-panel active" id="logs-panel">
                                <div class="logs-toolbar">
                                    <div class="logs-service-title">GitHub Compiler Logs</div>
                                    <div class="logs-toolbar-controls">
                                        <button class="logs-btn" id="logs-refresh-btn" title="Refresh logs">
                                            <i class="fas fa-sync-alt"></i>
                                        </button>
                                        <button class="logs-btn" id="logs-clear-btn" title="Clear logs">
                                            <i class="fas fa-trash"></i>
                                        </button>
                                        <button class="logs-btn" id="logs-follow-btn" title="Auto-scroll">
                                            <i class="fas fa-arrow-down"></i>
                                        </button>
                                    </div>
                                </div>
                                <div class="logs-viewer" id="logs-viewer">
                                    <div class="log-line system">📋 Loading logs for GitHub Compiler...</div>
                                </div>
                            </div>
                            <div class="logs-panel" id="terminal-panel">
                                <div class="terminal-content" id="service-terminal-output">
                                    <div class="log-line system">🖥️ Service Terminal Ready</div>
                                </div>
                                <div class="terminal-input-section">
                                    <div class="terminal-prompt">
                                        <span id="service-terminal-prompt">ubuntu@github-compiler:/$</span>
                                        <input type="text" id="service-terminal-input" placeholder="Enter command..." autocomplete="off">
                                        <div class="terminal-controls">
                                            <button id="service-terminal-execute" class="logs-btn" title="Execute command">
                                                <i class="fas fa-play"></i>
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;

        // Add styles for service logs
        const style = document.createElement('style');
        style.textContent = `
            #service-logs-popup {
                position: fixed;
                top: 0; left: 0; right: 0; bottom: 0;
                z-index: 9999;
                display: flex;
                align-items: center;
                justify-content: center;
                animation: fadeIn 0.2s ease;
            }
            
            #service-logs-popup .terminal-backdrop {
                position: absolute;
                top: 0; left: 0; right: 0; bottom: 0;
                background: rgba(0, 0, 0, 0.7);
                backdrop-filter: blur(4px);
            }
            
            .logs-container {
                position: relative;
                width: 95%;
                max-width: 1400px;
                height: 85%;
                max-height: 900px;
                background: #1a1a1a;
                border-radius: 12px;
                border: 1px solid #333;
                display: flex;
                flex-direction: column;
                overflow: hidden;
            }
            
            .logs-header {
                background: #2d2d2d;
                padding: 12px 16px;
                border-radius: 12px 12px 0 0;
                display: flex;
                justify-content: space-between;
                align-items: center;
                border-bottom: 1px solid #333;
            }
            
            .logs-title {
                color: #fff;
                font-weight: 600;
                display: flex;
                align-items: center;
                gap: 8px;
            }
            
            .logs-btn {
                background: transparent;
                border: none;
                color: #888;
                padding: 4px 8px;
                cursor: pointer;
                border-radius: 4px;
                transition: all 0.2s;
            }
            
            .logs-btn:hover {
                background: #444;
                color: #fff;
            }
            
            .logs-body {
                flex: 1;
                display: flex;
                overflow: hidden;
            }
            
            .logs-sidebar {
                width: 250px;
                background: #252525;
                border-right: 1px solid #333;
                display: flex;
                flex-direction: column;
            }
            
            .logs-sidebar .sidebar-header {
                padding: 12px 16px;
                background: #2d2d2d;
                border-bottom: 1px solid #333;
                color: #fff;
                font-weight: 600;
                font-size: 14px;
            }
            
            .service-list {
                flex: 1;
                overflow-y: auto;
                padding: 8px;
            }
            
            .service-item {
                display: flex;
                align-items: center;
                gap: 12px;
                padding: 12px;
                border-radius: 8px;
                cursor: pointer;
                transition: all 0.2s;
                margin-bottom: 4px;
            }
            
            .service-item:hover {
                background: #333;
            }
            
            .service-item.active {
                background: #2563eb;
                color: white;
            }
            
            .service-icon {
                width: 24px;
                height: 24px;
                display: flex;
                align-items: center;
                justify-content: center;
                color: #888;
                font-size: 14px;
            }
            
            .service-item.active .service-icon {
                color: white;
            }
            
            .service-info {
                flex: 1;
            }
            
            .service-name {
                color: #e0e0e0;
                font-size: 13px;
                font-weight: 500;
                margin-bottom: 2px;
            }
            
            .service-item.active .service-name {
                color: white;
            }
            
            .service-status {
                color: #888;
                font-size: 11px;
            }
            
            .service-item.active .service-status {
                color: #bfdbfe;
            }
            
            .logs-main {
                flex: 1;
                display: flex;
                flex-direction: column;
                overflow: hidden;
            }
            
            .logs-tabs {
                display: flex;
                background: #2d2d2d;
                border-bottom: 1px solid #333;
            }
            
            .logs-tab {
                background: transparent;
                border: none;
                color: #888;
                padding: 12px 20px;
                cursor: pointer;
                display: flex;
                align-items: center;
                gap: 8px;
                font-size: 13px;
                transition: all 0.2s;
                border-bottom: 2px solid transparent;
            }
            
            .logs-tab:hover {
                background: #333;
                color: #fff;
            }
            
            .logs-tab.active {
                color: #2563eb;
                border-bottom-color: #2563eb;
            }
            
            .logs-content {
                flex: 1;
                position: relative;
                overflow: hidden;
            }
            
            .logs-panel {
                position: absolute;
                top: 0; left: 0; right: 0; bottom: 0;
                display: none;
                flex-direction: column;
            }
            
            .logs-panel.active {
                display: flex;
            }
            
            .logs-toolbar {
                background: #2a2a2a;
                padding: 8px 16px;
                border-bottom: 1px solid #333;
                display: flex;
                justify-content: space-between;
                align-items: center;
            }
            
            .logs-service-title {
                color: #fff;
                font-size: 14px;
                font-weight: 500;
            }
            
            .logs-toolbar-controls {
                display: flex;
                gap: 4px;
            }
            
            .logs-viewer {
                flex: 1;
                overflow-y: auto;
                padding: 16px;
                font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
                font-size: 13px;
                line-height: 1.5;
                background: #1a1a1a;
                color: #e0e0e0;
            }
            
            #terminal-panel {
                background: #1a1a1a;
            }
            
            #service-terminal-output {
                flex: 1;
                overflow-y: auto;
                padding: 16px;
                font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
                font-size: 13px;
                line-height: 1.5;
                color: #e0e0e0;
            }
            
            #terminal-panel .terminal-input-section {
                border-top: 1px solid #333;
                background: #2d2d2d;
                padding: 12px 16px;
            }
            
            #terminal-panel .terminal-prompt {
                display: flex;
                align-items: center;
                gap: 8px;
            }
            
            #service-terminal-prompt {
                color: #2563eb;
                font-weight: 600;
                font-size: 13px;
                font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
                white-space: nowrap;
            }
            
            #service-terminal-input {
                flex: 1;
                background: #1a1a1a;
                border: 1px solid #444;
                color: #e0e0e0;
                padding: 8px 12px;
                border-radius: 4px;
                font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
                font-size: 13px;
            }
            
            #service-terminal-input:focus {
                outline: none;
                border-color: #2563eb;
            }
            
            .terminal-controls {
                display: flex;
                gap: 4px;
            }
            
            .logs-btn.active {
                background: #2563eb !important;
                color: white !important;
            }
            
            .log-line.error {
                color: #ef4444;
            }
            
            .log-line.system {
                color: #10b981;
            }
            
            .log-line.command {
                color: #f59e0b;
                background: rgba(245, 158, 11, 0.1);
                padding: 4px 8px;
                border-radius: 4px;
                margin: 2px 0;
            }
            
            .log-line.output {
                color: #e0e0e0;
                padding-left: 16px;
            }
        `;

        if (!document.getElementById('service-logs-styles')) {
            style.id = 'service-logs-styles';
            document.head.appendChild(style);
        }

        document.body.appendChild(logsPopup);

        // Set up event handlers for service logs
        this.setupServiceLogsHandlers();
    }

    setupServiceLogsHandlers() {
        // Service selection
        document.querySelectorAll('.service-item').forEach(item => {
            item.addEventListener('click', () => {
                const service = item.dataset.service;
                this.selectService(service);
            });
        });

        // Tab switching
        document.querySelectorAll('.logs-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                const tabType = tab.dataset.tab;
                this.switchLogsTab(tabType);
            });
        });

        // Logs toolbar controls
        document.getElementById('logs-refresh-btn')?.addEventListener('click', () => {
            this.refreshServiceLogs();
        });

        document.getElementById('logs-clear-btn')?.addEventListener('click', () => {
            this.clearServiceLogs();
        });

        document.getElementById('logs-follow-btn')?.addEventListener('click', () => {
            this.toggleAutoScroll();
        });

        // Set up terminal handlers using event delegation to handle elements created in innerHTML
        this.setupServiceTerminalHandlers();

        // Enable auto-scroll by default
        const followBtn = document.getElementById('logs-follow-btn');
        if (followBtn) {
            followBtn.classList.add('active');
            followBtn.style.color = '#2563eb';
            followBtn.title = 'Auto-scroll: ON';
        }

        // Load service status and initial logs
        this.updateServiceStatus();
        this.loadServiceLogs();
    }

    setupServiceTerminalHandlers() {
        // Use setTimeout to ensure DOM elements are ready
        setTimeout(() => {
            const terminalInput = document.getElementById('service-terminal-input');
            const executeBtn = document.getElementById('service-terminal-execute');

            if (terminalInput && executeBtn) {
                console.log('✅ Setting up service terminal handlers');
                
                // Remove any existing handlers to avoid duplicates
                const newTerminalInput = terminalInput.cloneNode(true);
                terminalInput.parentNode.replaceChild(newTerminalInput, terminalInput);
                
                const newExecuteBtn = executeBtn.cloneNode(true);
                executeBtn.parentNode.replaceChild(newExecuteBtn, executeBtn);

                // Handle key events (TAB completion removed for service terminals)
                newTerminalInput.addEventListener('keydown', (e) => {
                    // TAB completion disabled for service terminals due to performance issues
                });
                
                newTerminalInput.addEventListener('keypress', (e) => {
                    if (e.key === 'Enter') {
                        this.executeServiceCommand();
                    }
                });

                newExecuteBtn.addEventListener('click', () => {
                    this.executeServiceCommand();
                });
            } else {
                console.log('❌ Service terminal elements not found');
            }
        }, 100);
    }

    selectService(serviceId) {
        // Update active service
        document.querySelectorAll('.service-item').forEach(item => {
            item.classList.remove('active');
        });
        document.querySelector(`[data-service="${serviceId}"]`)?.classList.add('active');

        // Update state
        this.serviceLogsState.selectedService = serviceId;
        const service = this.serviceLogsState.services[serviceId];

        // Update UI
        document.querySelector('.logs-service-title').textContent = `${service.name} Logs`;
        document.getElementById('service-terminal-prompt').textContent = `ubuntu@${service.container}:/$`;

        // Restore terminal history for the selected service
        const terminalOutput = document.getElementById('service-terminal-output');
        if (terminalOutput) {
            // Clear and restore the specific service's terminal history
            terminalOutput.innerHTML = '<div class="log-line system">🖥️ Service Terminal Ready</div>';
            
            // Restore previous terminal history for this service
            const serviceHistory = service.terminalHistory || [];
            serviceHistory.forEach(historyItem => {
                terminalOutput.innerHTML += historyItem;
            });
            
            // Scroll to bottom
            terminalOutput.scrollTop = terminalOutput.scrollHeight;
        }

        // Load logs for selected service
        this.loadServiceLogs();
    }

    updateServiceSidebar() {
        const serviceList = document.getElementById('service-list');
        if (!serviceList) return;

        // Clear existing items
        serviceList.innerHTML = '';

        // Add all services (both system services and apps)
        Object.keys(this.serviceLogsState.services).forEach(serviceKey => {
            const service = this.serviceLogsState.services[serviceKey];
            
            let icon, status;
            if (service.isApp) {
                icon = '<i class="fas fa-cube"></i>';
                status = 'App';
            } else if (serviceKey === 'github-compiler') {
                icon = '<i class="fas fa-code-branch"></i>';
                status = 'Active';
            } else if (serviceKey === 'casaos') {
                icon = '<i class="fas fa-home"></i>';
                status = 'Running';
            } else if (serviceKey === 'mesh-router') {
                icon = '<i class="fas fa-network-wired"></i>';
                status = 'Running';
            } else {
                icon = '<i class="fas fa-server"></i>';
                status = 'Service';
            }

            const isActive = serviceKey === this.serviceLogsState.selectedService ? 'active' : '';
            
            const serviceItem = document.createElement('div');
            serviceItem.className = `service-item ${isActive}`;
            serviceItem.setAttribute('data-service', serviceKey);
            serviceItem.innerHTML = `
                <div class="service-icon">${icon}</div>
                <div class="service-info">
                    <div class="service-name">${service.name}</div>
                    <div class="service-status">${status}</div>
                </div>
            `;
            
            serviceList.appendChild(serviceItem);
        });

        // Re-bind click events for service items
        document.querySelectorAll('.service-item').forEach(item => {
            item.addEventListener('click', () => {
                const service = item.dataset.service;
                this.selectService(service);
            });
        });
    }

    switchLogsTab(tabType) {
        // Update active tab
        document.querySelectorAll('.logs-tab').forEach(tab => {
            tab.classList.remove('active');
        });
        document.querySelector(`[data-tab="${tabType}"]`)?.classList.add('active');

        // Update active panel
        document.querySelectorAll('.logs-panel').forEach(panel => {
            panel.classList.remove('active');
        });
        document.getElementById(`${tabType}-panel`)?.classList.add('active');
    }

    async loadServiceLogs() {
        const selectedServiceKey = this.serviceLogsState.selectedService;
        const service = this.serviceLogsState.services[selectedServiceKey];
        const logsViewer = document.getElementById('logs-viewer');
        
        if (!logsViewer) return;

        try {
            // Show loading message
            logsViewer.innerHTML = '<div class="log-line system">📋 Connecting to log stream...</div>';

            // Start real-time log streaming if not already active for this service
            if (!service.eventSource) {
                this.startLogStreaming();
            } else {
                // Restore saved log history for this service
                this.restoreServiceLogHistory();
            }
            
        } catch (error) {
            console.error('Failed to load service logs:', error);
            logsViewer.innerHTML = '<div class="log-line error">❌ Error loading logs: ' + (error.response?.data?.message || error.message) + '</div>';
        }
    }

    restoreServiceLogHistory() {
        const selectedServiceKey = this.serviceLogsState.selectedService;
        const service = this.serviceLogsState.services[selectedServiceKey];
        const logsViewer = document.getElementById('logs-viewer');
        
        if (!logsViewer || !service) return;

        // Restore saved log history for this service
        if (service.logHistory && service.logHistory.length > 0) {
            logsViewer.innerHTML = service.logHistory.join('');
            // Scroll to bottom
            logsViewer.scrollTop = logsViewer.scrollHeight;
        } else {
            logsViewer.innerHTML = '<div class="log-line system">📡 Log stream active (no previous logs)</div>';
        }
    }

    startLogStreaming() {
        const selectedServiceKey = this.serviceLogsState.selectedService;
        const service = this.serviceLogsState.services[selectedServiceKey];
        const logsViewer = document.getElementById('logs-viewer');
        
        if (!logsViewer || !service) return;

        let streamUrl;
        
        // Check if this is an app or a system service
        if (service.isApp) {
            // For apps, use the Docker container logs endpoint
            streamUrl = this.addHashToUrl(`/api/admin/docker/${service.container}/logs/stream`) + '&lines=50';
        } else {
            // For system services, use the services endpoint
            streamUrl = this.addHashToUrl(`/api/admin/services/${selectedServiceKey}/logs/stream`) + '&lines=50';
        }
        
        console.log(`📡 Starting log stream for ${selectedServiceKey} (${service.name})`);
        
        // Create EventSource for real-time logs and store it per service
        const eventSource = new EventSource(streamUrl);
        service.eventSource = eventSource;
        
        // Clear logs on connection
        eventSource.addEventListener('connected', (event) => {
            const data = JSON.parse(event.data);
            // Only update viewer if this service is currently selected
            if (this.serviceLogsState.selectedService === selectedServiceKey) {
                logsViewer.innerHTML = '<div class="log-line system">📡 ' + data.message + '</div>';
            }
        });
        
        // Handle log messages
        eventSource.addEventListener('log', (event) => {
            const data = JSON.parse(event.data);
            // Save log to this service's history (always save, regardless of what's currently selected)
            this.saveLogToServiceHistory(selectedServiceKey, data.log, data.timestamp);
            
            // Only update viewer if this service is currently selected
            if (this.serviceLogsState.selectedService === selectedServiceKey) {
                this.addLogToViewer(data.log, data.timestamp);
            }
        });
        
        // Handle connection errors with retry logic
        eventSource.addEventListener('error', (event) => {
            console.error('Log stream error for service:', selectedServiceKey);
            
            // Only show error if connection is permanently closed
            if (eventSource.readyState === EventSource.CLOSED) {
                // Save error to history and show if this service is currently selected
                this.saveLogToServiceHistory(selectedServiceKey, '❌ Log stream disconnected. Attempting to reconnect...', new Date().toISOString(), 'error');
                
                if (this.serviceLogsState.selectedService === selectedServiceKey) {
                    this.addLogToViewer('❌ Log stream disconnected. Attempting to reconnect...', new Date().toISOString(), 'error');
                }
                
                // Clear the eventSource from the service since it's closed
                service.eventSource = null;
                
                // Attempt to reconnect after 3 seconds
                setTimeout(() => {
                    if (this.serviceLogsState && this.serviceLogsState.selectedService === selectedServiceKey) {
                        console.log('🔄 Attempting to reconnect log stream...');
                        this.startLogStreaming();
                    }
                }, 3000);
            }
        });
        
        // Handle ping (keep-alive)
        eventSource.addEventListener('ping', (event) => {
            // Update connection status indicator if needed
            console.log('📡 Log stream keep-alive ping received');
        });
        
        // Enhanced error handling
        eventSource.onerror = (error) => {
            // Only log detailed error info, don't spam user with technical details
            if (eventSource.readyState === EventSource.CONNECTING) {
                console.log('📡 Log stream connecting...');
            } else if (eventSource.readyState === EventSource.CLOSED) {
                console.warn('📡 Log stream connection closed');
            }
        };
    }

    saveLogToServiceHistory(serviceKey, logText, timestamp, type = 'log') {
        const service = this.serviceLogsState.services[serviceKey];
        if (!service) return;

        // Create the same HTML that would be displayed
        const time = new Date(timestamp).toLocaleTimeString();
        const logHtml = `<div class="log-line ${type}"><span style="color: #666; font-size: 11px;">[${time}]</span> ${logText}</div>`;
        
        // Add to service's log history
        service.logHistory.push(logHtml);
        
        // Limit history to prevent memory issues (keep last 500 logs per service)
        const maxHistoryLines = 500;
        if (service.logHistory.length > maxHistoryLines) {
            service.logHistory.shift(); // Remove oldest log
        }
    }

    addLogToViewer(logText, timestamp, type = 'log') {
        const logsViewer = document.getElementById('logs-viewer');
        if (!logsViewer) return;

        const line = document.createElement('div');
        line.className = `log-line ${type}`;
        
        // Format timestamp for display
        const time = new Date(timestamp).toLocaleTimeString();
        line.innerHTML = `<span style="color: #666; font-size: 11px;">[${time}]</span> ${logText}`;
        
        logsViewer.appendChild(line);
        
        // Auto-scroll to bottom if follow mode is active
        const followBtn = document.getElementById('logs-follow-btn');
        if (followBtn && followBtn.classList.contains('active')) {
            logsViewer.scrollTop = logsViewer.scrollHeight;
        }
        
        // Limit number of log lines to prevent memory issues
        const maxLines = 1000;
        while (logsViewer.children.length > maxLines) {
            logsViewer.removeChild(logsViewer.firstChild);
        }
    }

    displayLogs(logs) {
        const logsViewer = document.getElementById('logs-viewer');
        if (!logsViewer) return;

        if (!logs || logs.length === 0) {
            logsViewer.innerHTML = '<div class="log-line system">📄 No logs available</div>';
            return;
        }

        logsViewer.innerHTML = '';
        logs.forEach(logLine => {
            const line = document.createElement('div');
            line.className = 'log-line';
            line.textContent = logLine;
            logsViewer.appendChild(line);
        });

        // Auto-scroll to bottom
        logsViewer.scrollTop = logsViewer.scrollHeight;
    }

    refreshServiceLogs() {
        this.loadServiceLogs();
    }

    clearServiceLogs() {
        const logsViewer = document.getElementById('logs-viewer');
        if (logsViewer) {
            logsViewer.innerHTML = '<div class="log-line system">📄 Logs cleared</div>';
        }
    }

    toggleAutoScroll() {
        const followBtn = document.getElementById('logs-follow-btn');
        const logsViewer = document.getElementById('logs-viewer');
        
        if (followBtn) {
            followBtn.classList.toggle('active');
            
            // If activating auto-scroll, scroll to bottom immediately
            if (followBtn.classList.contains('active') && logsViewer) {
                logsViewer.scrollTop = logsViewer.scrollHeight;
                followBtn.style.color = '#2563eb';
                followBtn.title = 'Auto-scroll: ON';
            } else {
                followBtn.style.color = '';
                followBtn.title = 'Auto-scroll: OFF';
            }
        }
    }

    async executeServiceCommand() {
        const terminalInput = document.getElementById('service-terminal-input');
        const terminalOutput = document.getElementById('service-terminal-output');
        
        if (!terminalInput || !terminalOutput) return;

        const command = terminalInput.value.trim();
        if (!command) return;

        const service = this.serviceLogsState.services[this.serviceLogsState.selectedService];

        // Add command to output
        const commandLine = document.createElement('div');
        commandLine.className = 'log-line command';
        commandLine.innerHTML = `<span style="color: #2563eb">ubuntu@${service.container}:/$</span> ${command}`;
        terminalOutput.appendChild(commandLine);

        // Save command to service history
        const commandHTML = commandLine.outerHTML;
        if (!service.terminalHistory) {
            service.terminalHistory = [];
        }
        service.terminalHistory.push(commandHTML);

        // Clear input
        terminalInput.value = '';

        try {
            // Simplify API call - just use services endpoint for better performance
            const response = await axios.post(this.addHashToUrl('/api/admin/services/execute'), {
                service: this.serviceLogsState.selectedService,
                command: command
            });

            if (response.data.success) {
                // Add output to terminal
                if (response.data.output) {
                    const outputLine = document.createElement('div');
                    outputLine.className = 'log-line output';
                    outputLine.textContent = response.data.output;
                    terminalOutput.appendChild(outputLine);
                    
                    // Save output to service history
                    service.terminalHistory.push(outputLine.outerHTML);
                }
            } else {
                const errorLine = document.createElement('div');
                errorLine.className = 'log-line error';
                errorLine.textContent = `Error: ${response.data.message}`;
                terminalOutput.appendChild(errorLine);
                
                // Save error to service history
                service.terminalHistory.push(errorLine.outerHTML);
            }
        } catch (error) {
            const errorLine = document.createElement('div');
            errorLine.className = 'log-line error';
            errorLine.textContent = `Error: ${error.response?.data?.message || error.message}`;
            terminalOutput.appendChild(errorLine);
            
            // Save error to service history
            service.terminalHistory.push(errorLine.outerHTML);
        }

        // Auto-scroll to bottom
        terminalOutput.scrollTop = terminalOutput.scrollHeight;
    }

    // TAB completion removed from service logs for better performance

    async updateServiceStatus() {
        try {
            const url = this.addHashToUrl('/api/admin/services/status');
            const response = await axios.get(url);
            if (response.data.success) {
                const services = response.data.services;
                
                // Update status indicators in the sidebar
                services.forEach(service => {
                    let serviceId;
                    switch (service.container) {
                        case 'yunderagithubcompiler':
                            serviceId = 'github-compiler';
                            break;
                        case 'casaos':
                            serviceId = 'casaos';
                            break;
                        case 'mesh-router':
                            serviceId = 'mesh-router';
                            break;
                    }
                    
                    if (serviceId) {
                        const statusElement = document.querySelector(`[data-service="${serviceId}"] .service-status`);
                        if (statusElement) {
                            statusElement.textContent = service.running ? 'Running' : 'Stopped';
                            statusElement.style.color = service.running ? '#10b981' : '#ef4444';
                        }
                    }
                });
            }
        } catch (error) {
            console.error('Failed to update service status:', error);
        }
    }

    async openAppLogs(repoId) {
        console.log('📱 openAppLogs called with repoId:', repoId);
        
        const repo = this.repos.find(r => r.id === repoId);
        if (!repo || !repo.name) {
            console.log('❌ Repository not found:', repoId);
            this.showNotification('Repository not found or not configured', 'error');
            return;
        }

        if (!repo.isInstalled) {
            console.log('❌ App not installed');
            this.showNotification('App must be installed first to view logs', 'error');
            return;
        }

        // Close any existing popups
        this.closeServiceLogs();
        this.closeAppLogsPopup();

        // Create popup immediately with loading state
        this.appLogsState = {
            repoId: repoId,
            repo: repo,
            selectedContainer: null,
            containers: {},
            eventSources: {},
            loading: true
        };

        // Create the popup with loading state
        this.createAppLogsPopup();

        // Load containers in the background
        try {
            const response = await fetch(this.addHashToUrl(`/api/admin/repos/${repoId}/debug`));
            
            if (response.status === 401) {
                this.handleAuthError();
                return;
            }
            
            const debugInfo = await response.json();
            
            if (!debugInfo.success) {
                this.showNotification('Failed to get app container information', 'error');
                this.closeAppLogsPopup();
                return;
            }

            // Parse container list from debug info
            const containerList = debugInfo.debug?.dockerInfo?.containerList || '';
            const containers = [];
            
            if (containerList.trim()) {
                containerList.split('\n').forEach(line => {
                    if (line.trim()) {
                        const [name, status, state] = line.split('\t');
                        if (name) {
                            containers.push({
                                name: name.trim(),
                                status: status?.trim() || 'unknown',
                                state: state?.trim() || 'unknown'
                            });
                        }
                    }
                });
            }

            if (containers.length === 0) {
                this.showNotification('No containers found for this app', 'error');
                this.closeAppLogsPopup();
                return;
            }

            // Update state with containers
            this.appLogsState.selectedContainer = containers[0].name;
            this.appLogsState.loading = false;
            
            // Set up containers in the state
            containers.forEach(container => {
                this.appLogsState.containers[container.name] = {
                    name: container.name,
                    displayName: container.name.replace(/^[^_]*_/, ''), // Remove prefix for display
                    status: container.status,
                    state: container.state,
                    terminalHistory: [],
                    logHistory: [],  // Store log messages for this service
                    terminalSession: {
                        currentDir: '/',
                        envVars: {},
                        user: 'root',
                        commandHistory: [],
                        historyIndex: -1
                    }
                };
            });

            // Update the popup with actual containers
            this.updateAppLogsPopup();

        } catch (error) {
            console.error('Failed to load app containers:', error);
            this.showNotification('Failed to load app containers: ' + error.message, 'error');
            this.closeAppLogsPopup();
        }
    }

    closeAppLogsPopup() {
        // Close all EventSource connections for app containers
        if (this.appLogsState && this.appLogsState.eventSources) {
            Object.keys(this.appLogsState.eventSources).forEach(containerName => {
                const eventSource = this.appLogsState.eventSources[containerName];
                if (eventSource) {
                    console.log(`📡 Closing ${containerName} log stream connection`);
                    eventSource.close();
                }
            });
        }

        // Remove the popup (now uses service-logs-popup ID)
        const popup = document.getElementById('service-logs-popup');
        if (popup) {
            popup.remove();
        }
        
        this.appLogsState = null;
    }

    loadServiceLogsCSS() {
        const style = document.createElement('style');
        style.id = 'service-logs-styles';
        style.textContent = `
            #service-logs-popup {
                position: fixed;
                top: 0; left: 0; right: 0; bottom: 0;
                z-index: 9999;
                display: flex;
                align-items: center;
                justify-content: center;
                animation: fadeIn 0.2s ease;
            }
            
            #service-logs-popup .terminal-backdrop {
                position: absolute;
                top: 0; left: 0; right: 0; bottom: 0;
                background: rgba(0, 0, 0, 0.7);
                backdrop-filter: blur(4px);
            }
            
            .logs-container {
                position: relative;
                width: 95%;
                max-width: 1400px;
                height: 85%;
                max-height: 900px;
                background: #1a1a1a;
                border-radius: 12px;
                border: 1px solid #333;
                display: flex;
                flex-direction: column;
                overflow: hidden;
            }
            
            .logs-header {
                background: #2d2d2d;
                padding: 12px 16px;
                border-radius: 12px 12px 0 0;
                display: flex;
                justify-content: space-between;
                align-items: center;
                border-bottom: 1px solid #333;
            }
            
            .logs-title {
                color: #fff;
                font-weight: 600;
                display: flex;
                align-items: center;
                gap: 8px;
            }
            
            .logs-controls {
                display: flex;
                gap: 8px;
            }
            
            .logs-btn {
                background: #444;
                border: none;
                color: #e0e0e0;
                padding: 6px 8px;
                border-radius: 4px;
                cursor: pointer;
                transition: all 0.2s;
                font-size: 12px;
                display: flex;
                align-items: center;
                gap: 4px;
            }
            
            .logs-btn:hover {
                background: #555;
                color: #fff;
            }
            
            .logs-btn.active {
                background: #3b82f6;
                color: #fff;
            }
            
            .logs-body {
                flex: 1;
                display: flex;
                overflow: hidden;
            }
            
            .logs-sidebar {
                width: 280px;
                background: #2d2d2d;
                border-right: 1px solid #333;
                display: flex;
                flex-direction: column;
            }
            
            .sidebar-header {
                padding: 12px 16px;
                background: #3d3d3d;
                border-bottom: 1px solid #444;
            }
            
            .sidebar-title {
                color: #e0e0e0;
                font-weight: 600;
                font-size: 13px;
            }
            
            .service-list {
                flex: 1;
                overflow-y: auto;
            }
            
            .service-item {
                padding: 12px 16px;
                display: flex;
                align-items: center;
                gap: 12px;
                cursor: pointer;
                transition: all 0.2s;
                border-bottom: 1px solid #3d3d3d;
            }
            
            .service-item:hover {
                background: #3d3d3d;
            }
            
            .service-item.active {
                background: #3b82f6;
                color: #fff;
            }
            
            .service-icon {
                color: #888;
                font-size: 16px;
                width: 20px;
                text-align: center;
            }
            
            .service-item.active .service-icon {
                color: #fff;
            }
            
            .service-info {
                flex: 1;
            }
            
            .service-name {
                color: #e0e0e0;
                font-weight: 500;
                font-size: 13px;
                margin-bottom: 2px;
            }
            
            .service-item.active .service-name {
                color: #fff;
            }
            
            .service-status {
                color: #888;
                font-size: 11px;
            }
            
            .service-item.active .service-status {
                color: #bfdbfe;
            }
            
            .logs-main {
                flex: 1;
                display: flex;
                flex-direction: column;
                overflow: hidden;
            }
            
            .logs-tabs {
                display: flex;
                background: #2d2d2d;
                border-bottom: 1px solid #333;
            }
            
            .logs-tab {
                background: transparent;
                border: none;
                color: #888;
                padding: 12px 16px;
                cursor: pointer;
                transition: all 0.2s;
                display: flex;
                align-items: center;
                gap: 6px;
                font-size: 13px;
                border-bottom: 2px solid transparent;
            }
            
            .logs-tab:hover {
                background: #3d3d3d;
                color: #e0e0e0;
            }
            
            .logs-tab.active {
                background: #1a1a1a;
                color: #3b82f6;
                border-bottom-color: #3b82f6;
            }
            
            .logs-content {
                flex: 1;
                display: flex;
                flex-direction: column;
                overflow: hidden;
            }
            
            .logs-panel {
                display: none;
                flex-direction: column;
                flex: 1;
                overflow: hidden;
            }
            
            .logs-panel.active {
                display: flex;
            }
            
            .logs-toolbar {
                background: #2d2d2d;
                padding: 8px 16px;
                display: flex;
                justify-content: space-between;
                align-items: center;
                border-bottom: 1px solid #333;
            }
            
            .logs-service-title {
                color: #e0e0e0;
                font-weight: 500;
                font-size: 13px;
            }
            
            .logs-toolbar-controls {
                display: flex;
                gap: 4px;
            }
            
            .logs-viewer {
                flex: 1;
                overflow-y: auto;
                padding: 16px;
                font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
                font-size: 12px;
                line-height: 1.5;
                background: #1a1a1a;
                color: #e0e0e0;
            }
            
            #terminal-panel {
                background: #1a1a1a;
            }
            
            #service-terminal-output {
                flex: 1;
                overflow-y: auto;
                padding: 16px;
                font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
                font-size: 13px;
                line-height: 1.5;
                color: #e0e0e0;
            }
            
            #terminal-panel .terminal-input-section {
                border-top: 1px solid #333;
                background: #2d2d2d;
                padding: 12px 16px;
            }
            
            #terminal-panel .terminal-prompt {
                display: flex;
                align-items: center;
                gap: 8px;
            }
            
            #service-terminal-prompt, #app-terminal-prompt {
                color: #2563eb;
                font-weight: 600;
                font-size: 13px;
                font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
                white-space: nowrap;
            }
            
            #service-terminal-input, #app-terminal-input {
                flex: 1;
                background: #1a1a1a;
                border: 1px solid #444;
                color: #e0e0e0;
                padding: 8px 12px;
                border-radius: 4px;
                font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
                font-size: 13px;
            }
            
            #service-terminal-input:focus, #app-terminal-input:focus {
                outline: none;
                border-color: #3b82f6;
            }
            
            .terminal-controls {
                display: flex;
                gap: 4px;
            }
            
            .log-line {
                margin: 1px 0;
                word-break: break-word;
                white-space: pre-wrap;
            }
            
            .log-line.error {
                color: #ef4444;
            }
            
            .log-line.system {
                color: #10b981;
            }
            
            .log-line.command {
                color: #3b82f6;
                font-weight: 600;
            }
            
            .log-line.output {
                color: #e0e0e0;
            }
            
            .log-timestamp {
                color: #666;
                font-size: 11px;
                margin-right: 8px;
            }
            
            @keyframes fadeIn {
                from { opacity: 0; }
                to { opacity: 1; }
            }
        `;
        
        document.head.appendChild(style);
    }

    closeServiceLogs() {
        // Close all EventSource connections
        if (this.serviceLogsState && this.serviceLogsState.services) {
            Object.keys(this.serviceLogsState.services).forEach(serviceKey => {
                const service = this.serviceLogsState.services[serviceKey];
                if (service.eventSource) {
                    console.log(`📡 Closing ${serviceKey} log stream connection`);
                    service.eventSource.close();
                    service.eventSource = null;
                }
            });
        }

        // Remove the popup
        const popup = document.getElementById('service-logs-popup');
        if (popup) {
            popup.remove();
        }
        
        this.serviceLogsState = null;
    }

    createAppLogsPopup() {
        const repo = this.appLogsState.repo;
        
        // Create the popup HTML using service logs structure
        const logsPopup = document.createElement('div');
        logsPopup.id = 'service-logs-popup';  // Use same ID to reuse CSS
        
        // Generate container sidebar items
        let containerItems = '';
        if (this.appLogsState.loading) {
            containerItems = `
                <div class="service-item">
                    <div class="service-icon"><i class="fas fa-spinner fa-spin"></i></div>
                    <div class="service-info">
                        <div class="service-name">Loading containers...</div>
                        <div class="service-status">Please wait</div>
                    </div>
                </div>
            `;
        } else {
            Object.keys(this.appLogsState.containers).forEach(containerName => {
                const container = this.appLogsState.containers[containerName];
                const isActive = containerName === this.appLogsState.selectedContainer ? 'active' : '';
                const statusColor = container.state === 'running' ? '#10b981' : '#ef4444';
                
                containerItems += `
                    <div class="service-item ${isActive}" data-container="${containerName}">
                        <div class="service-icon"><i class="fas fa-cube"></i></div>
                        <div class="service-info">
                            <div class="service-name">${container.displayName}</div>
                            <div class="service-status" style="color: ${statusColor}">${container.state}</div>
                        </div>
                    </div>
                `;
            });
        }

        logsPopup.innerHTML = `
            <div class="terminal-backdrop" onclick="repoManager.closeAppLogsPopup()"></div>
            <div class="logs-container">
                <div class="logs-header">
                    <div class="logs-title">
                        <i class="fas fa-cube"></i>
                        ${repo.name} - Container Logs
                    </div>
                    <div class="logs-controls">
                        <button class="logs-btn" onclick="repoManager.closeAppLogsPopup()">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>
                </div>
                <div class="logs-body">
                    <div class="logs-sidebar" id="app-logs-sidebar">
                        <div class="sidebar-header">
                            <span class="sidebar-title">Containers</span>
                        </div>
                        <div class="service-list" id="app-container-list">
                            ${containerItems}
                        </div>
                    </div>
                    <div class="logs-main">
                        <div class="logs-tabs">
                            <button class="logs-tab active" data-tab="logs">
                                <i class="fas fa-file-alt"></i>
                                Logs
                            </button>
                            <button class="logs-tab" data-tab="terminal">
                                <i class="fas fa-terminal"></i>
                                Terminal
                            </button>
                        </div>
                        <div class="logs-content">
                            <div class="logs-panel active" id="logs-panel">
                                <div class="logs-toolbar">
                                    <div class="logs-service-title" id="app-logs-title">${this.appLogsState.loading ? 'Loading...' : (this.appLogsState.containers[this.appLogsState.selectedContainer]?.displayName || 'Container')} Logs</div>
                                    <div class="logs-toolbar-controls">
                                        <button class="logs-btn" id="logs-refresh-btn" title="Refresh logs">
                                            <i class="fas fa-sync-alt"></i>
                                        </button>
                                        <button class="logs-btn" id="logs-clear-btn" title="Clear logs">
                                            <i class="fas fa-trash"></i>
                                        </button>
                                        <button class="logs-btn active" id="logs-follow-btn" title="Auto-scroll: ON">
                                            <i class="fas fa-arrow-down"></i>
                                        </button>
                                    </div>
                                </div>
                                <div class="logs-viewer" id="logs-viewer">
                                    <div class="log-line system">📋 ${this.appLogsState.loading ? 'Loading containers...' : 'Loading logs...'}</div>
                                </div>
                            </div>
                            <div class="logs-panel" id="terminal-panel">
                                <div class="terminal-content" id="service-terminal-output">
                                    <div class="log-line system">🖥️ Container Terminal Ready</div>
                                </div>
                                <div class="terminal-input-section">
                                    <div class="terminal-prompt">
                                        <span id="service-terminal-prompt">root@${this.appLogsState.selectedContainer || 'container'}:/$</span>
                                        <input type="text" id="service-terminal-input" placeholder="Enter command..." autocomplete="off">
                                        <div class="terminal-controls">
                                            <button id="service-terminal-execute" class="logs-btn" title="Execute command">
                                                <i class="fas fa-play"></i>
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;

        // Load CSS if not already loaded (same as service logs)
        if (!document.getElementById('service-logs-styles')) {
            this.loadServiceLogsCSS();
        }

        document.body.appendChild(logsPopup);

        // Only set up handlers if not loading (will be set up later)
        if (!this.appLogsState.loading) {
            this.setupAppLogsHandlers();
            this.startAppLogStreaming();
        }
    }

    updateAppLogsPopup() {
        if (!this.appLogsState || this.appLogsState.loading) return;

        // Update sidebar with actual containers
        const containerList = document.getElementById('app-container-list');
        if (containerList) {
            let containerItems = '';
            Object.keys(this.appLogsState.containers).forEach(containerName => {
                const container = this.appLogsState.containers[containerName];
                const isActive = containerName === this.appLogsState.selectedContainer ? 'active' : '';
                const statusColor = container.state === 'running' ? '#10b981' : '#ef4444';
                
                containerItems += `
                    <div class="service-item ${isActive}" data-container="${containerName}">
                        <div class="service-icon"><i class="fas fa-cube"></i></div>
                        <div class="service-info">
                            <div class="service-name">${container.displayName}</div>
                            <div class="service-status" style="color: ${statusColor}">${container.state}</div>
                        </div>
                    </div>
                `;
            });
            containerList.innerHTML = containerItems;
        }

        // Update title
        const title = document.getElementById('app-logs-title');
        if (title && this.appLogsState.selectedContainer) {
            const container = this.appLogsState.containers[this.appLogsState.selectedContainer];
            title.textContent = `${container.displayName} Logs`;
        }

        // Update terminal prompt
        const prompt = document.getElementById('service-terminal-prompt');
        if (prompt && this.appLogsState.selectedContainer) {
            prompt.textContent = `root@${this.appLogsState.selectedContainer}:/$`;
        }

        // Update logs viewer
        const viewer = document.getElementById('logs-viewer');
        if (viewer) {
            viewer.innerHTML = '<div class="log-line system">📋 Loading logs...</div>';
        }

        // Set up event handlers and start streaming
        this.setupAppLogsHandlers();
        this.startAppLogStreaming();
    }

    setupAppLogsHandlers() {
        // Container selection
        document.querySelectorAll('#app-container-list .service-item').forEach(item => {
            item.addEventListener('click', () => {
                const containerName = item.dataset.container;
                this.selectAppContainer(containerName);
            });
        });

        // Tab switching
        document.querySelectorAll('.logs-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                const tabType = tab.dataset.tab;
                this.switchAppLogsTab(tabType);
            });
        });

        // Toolbar controls  
        document.getElementById('logs-refresh-btn')?.addEventListener('click', () => {
            this.refreshAppLogs();
        });

        document.getElementById('logs-clear-btn')?.addEventListener('click', () => {
            this.clearAppLogs();
        });

        document.getElementById('logs-follow-btn')?.addEventListener('click', () => {
            this.toggleAppAutoScroll();
        });

        // Terminal handlers
        const terminalInput = document.getElementById('service-terminal-input');
        const executeBtn = document.getElementById('service-terminal-execute');

        if (terminalInput) {
            terminalInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    this.executeAppCommand();
                }
                if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    this.navigateAppCommandHistory('up');
                }
                if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    this.navigateAppCommandHistory('down');
                }
            });
        }

        if (executeBtn) {
            executeBtn.addEventListener('click', () => {
                this.executeAppCommand();
            });
        }
    }

    selectAppContainer(containerName) {
        if (!this.appLogsState || !this.appLogsState.containers[containerName]) return;

        // Update UI
        document.querySelectorAll('#app-container-list .service-item').forEach(item => {
            item.classList.remove('active');
        });
        document.querySelector(`[data-container="${containerName}"]`)?.classList.add('active');

        // Update state
        this.appLogsState.selectedContainer = containerName;
        const container = this.appLogsState.containers[containerName];

        // Update titles
        document.getElementById('app-logs-title').textContent = `${container.displayName} Logs`;
        document.getElementById('service-terminal-prompt').textContent = `root@${containerName}:/$`;

        // Clear and reload logs
        this.refreshAppLogs();
    }

    switchAppLogsTab(tabType) {
        document.querySelectorAll('.logs-tab').forEach(tab => {
            tab.classList.remove('active');
        });
        document.querySelector(`.logs-tab[data-tab="${tabType}"]`)?.classList.add('active');

        document.querySelectorAll('.logs-panel').forEach(panel => {
            panel.classList.remove('active');
        });
        document.getElementById(`${tabType}-panel`)?.classList.add('active');

        if (tabType === 'terminal') {
            setTimeout(() => {
                document.getElementById('service-terminal-input')?.focus();
            }, 100);
        }
    }

    startAppLogStreaming() {
        if (!this.appLogsState || !this.appLogsState.selectedContainer) return;

        const containerName = this.appLogsState.selectedContainer;
        
        // Close existing connection for this container if any
        if (this.appLogsState.eventSources[containerName]) {
            this.appLogsState.eventSources[containerName].close();
        }

        console.log(`📡 Starting log stream for container: ${containerName}`);
        
        const streamUrl = this.addHashToUrl(`/api/admin/docker/${containerName}/logs/stream`) + '&lines=200';
        
        try {
            const eventSource = new EventSource(streamUrl);
            this.appLogsState.eventSources[containerName] = eventSource;

            // Handle connection establishment
            eventSource.addEventListener('connected', (event) => {
                const data = JSON.parse(event.data);
                // Only update viewer if this container is still selected
                if (this.appLogsState.selectedContainer === containerName) {
                    console.log(`✅ Connected to ${containerName} logs`);
                    this.appendAppLogLine('📡 ' + data.message, null, 'system');
                }
            });

            // Handle actual log messages (this is the key fix!)
            eventSource.addEventListener('log', (event) => {
                try {
                    const data = JSON.parse(event.data);
                    // Only update if this container is still selected
                    if (this.appLogsState.selectedContainer === containerName) {
                        this.appendAppLogLine(data.log, data.timestamp);
                    }
                } catch (error) {
                    console.error('Failed to parse log message:', error);
                }
            });

            // Handle connection errors with retry logic
            eventSource.addEventListener('error', (event) => {
                console.error(`App log stream error for ${containerName}:`, error);
                
                // Only show error if connection is permanently closed
                if (eventSource.readyState === EventSource.CLOSED) {
                    // Connection is closed, remove from eventSources
                    delete this.appLogsState.eventSources[containerName];
                    
                    // Only show error if this container is still selected
                    if (this.appLogsState.selectedContainer === containerName) {
                        this.appendAppLogLine('❌ Log stream disconnected. Attempting to reconnect...', null, 'error');
                        
                        // Attempt to reconnect after 5 seconds
                        setTimeout(() => {
                            if (this.appLogsState && this.appLogsState.selectedContainer === containerName) {
                                console.log(`🔄 Attempting to reconnect to ${containerName}...`);
                                this.startAppLogStreaming();
                            }
                        }, 5000);
                    }
                }
            });

            // Handle ping (keep-alive)
            eventSource.addEventListener('ping', (event) => {
                console.log(`📡 Log stream keep-alive ping received for ${containerName}`);
            });

        } catch (error) {
            console.error(`Failed to start log streaming for ${containerName}:`, error);
            this.appendAppLogLine(`❌ Failed to start log streaming: ${error.message}`, null, 'error');
        }
    }

    appendAppLogLine(message, timestamp, type = 'log') {
        const viewer = document.getElementById('logs-viewer');
        if (!viewer) return;

        const line = document.createElement('div');
        line.className = `log-line ${type}`;
        
        const time = timestamp ? new Date(timestamp).toLocaleTimeString() : new Date().toLocaleTimeString();
        const prefix = type === 'system' ? '🖥️' : type === 'error' ? '❌' : '📋';
        
        line.innerHTML = `<span class="log-timestamp">[${time}]</span> ${prefix} ${message}`;
        viewer.appendChild(line);

        // Auto-scroll to bottom
        viewer.scrollTop = viewer.scrollHeight;

        // Limit lines
        if (viewer.children.length > 1000) {
            viewer.removeChild(viewer.firstChild);
        }
    }

    refreshAppLogs() {
        const viewer = document.getElementById('logs-viewer');
        if (viewer) {
            viewer.innerHTML = '<div class="log-line system">📋 Refreshing logs...</div>';
        }
        this.startAppLogStreaming();
    }

    clearAppLogs() {
        const viewer = document.getElementById('logs-viewer');
        if (viewer) {
            viewer.innerHTML = '<div class="log-line system">📋 Logs cleared</div>';
        }
    }

    toggleAppAutoScroll() {
        // App logs always auto-scroll for now - just toggle the button appearance
        const btn = document.getElementById('logs-follow-btn');
        if (btn) {
            btn.classList.toggle('active');
            btn.title = btn.classList.contains('active') ? 'Auto-scroll: ON' : 'Auto-scroll: OFF';
        }
    }

    async executeAppCommand() {
        if (!this.appLogsState) return;

        const input = document.getElementById('service-terminal-input');
        if (!input || !input.value.trim()) return;

        const command = input.value.trim();
        const containerName = this.appLogsState.selectedContainer;
        const container = this.appLogsState.containers[containerName];
        
        // Add to command history
        container.terminalSession.commandHistory.push(command);
        container.terminalSession.historyIndex = container.terminalSession.commandHistory.length;

        // Show command in terminal
        this.appendAppTerminalLine(`$ ${command}`, 'command');
        
        // Clear input
        input.value = '';

        try {
            const response = await fetch(this.addHashToUrl(`/api/admin/docker/execute`), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ containerName, command })
            });

            if (response.status === 401) {
                this.handleAuthError();
                return;
            }

            const result = await response.json();
            
            if (result.success) {
                if (result.output) {
                    this.appendAppTerminalLine(result.output, 'output');
                }
            } else {
                this.appendAppTerminalLine(result.error || 'Command failed', 'error');
            }
        } catch (error) {
            console.error('Command execution failed:', error);
            this.appendAppTerminalLine(`Error: ${error.message}`, 'error');
        }
    }

    appendAppTerminalLine(message, type = 'output') {
        const output = document.getElementById('service-terminal-output');
        if (!output) return;

        const line = document.createElement('div');
        line.className = `log-line ${type}`;
        line.textContent = message;
        
        output.appendChild(line);
        output.scrollTop = output.scrollHeight;

        if (output.children.length > 500) {
            output.removeChild(output.firstChild);
        }
    }

    navigateAppCommandHistory(direction) {
        if (!this.appLogsState) return;

        const input = document.getElementById('service-terminal-input');
        if (!input) return;

        const container = this.appLogsState.containers[this.appLogsState.selectedContainer];
        const history = container.terminalSession.commandHistory;
        
        if (direction === 'up' && container.terminalSession.historyIndex > 0) {
            container.terminalSession.historyIndex--;
            input.value = history[container.terminalSession.historyIndex];
        } else if (direction === 'down') {
            container.terminalSession.historyIndex++;
            if (container.terminalSession.historyIndex >= history.length) {
                container.terminalSession.historyIndex = history.length;
                input.value = '';
            } else {
                input.value = history[container.terminalSession.historyIndex];
            }
        }
    }

    async uninstallApp(repoId) {
        console.log('🗑️ uninstallApp called with repoId:', repoId);
        
        const repo = this.repos.find(r => r.id === repoId);
        if (!repo || !repo.name) {
            console.log('❌ Repository not found:', repoId);
            this.showNotification('Repository not found or not configured', 'error');
            return;
        }

        if (!repo.isInstalled) {
            console.log('❌ App not installed');
            this.showNotification('Application is not installed', 'error');
            return;
        }

        console.log(`🗑️ Uninstalling app: ${repo.name}`);

        // Show confirmation dialog
        const result = await this.showAppUninstallConfirmation(repo);
        if (!result.proceed) {
            console.log('❌ Uninstall cancelled by user');
            return;
        }

        try {
            // Call uninstall API (reuse existing app management endpoint)
            const response = await axios.post(this.addHashToUrl(`/api/admin/repos/${repoId}/uninstall`), {
                preserveData: result.preserveData
            });

            if (response.data.success) {
                this.showNotification(`Application "${repo.name}" uninstalled successfully`, 'success');
                // Refresh the repo to update status
                await this.loadRepos();
            } else {
                this.showNotification(`Failed to uninstall "${repo.name}": ${response.data.message}`, 'error');
            }
        } catch (error) {
            console.error(`Failed to uninstall app ${repo.name}:`, error);
            this.showNotification(`Failed to uninstall "${repo.name}": ${error.response?.data?.message || error.message}`, 'error');
        }
    }

    async showAppUninstallConfirmation(repo) {
        return new Promise((resolve) => {
            // Create app uninstall confirmation popup  
            const popup = document.createElement('div');
            popup.id = 'app-uninstall-confirmation';
            popup.innerHTML = `
                <div class="uninstall-backdrop"></div>
                <div class="uninstall-container">
                    <div class="uninstall-header">
                        <div class="uninstall-icon">🗑️</div>
                        <h2>Uninstall Application</h2>
                    </div>
                    <div class="uninstall-content">
                        <p><strong>Are you sure you want to uninstall "${repo.name}"?</strong></p>
                        
                        <div class="uninstall-notice">
                            <p><i class="fas fa-info-circle"></i> This will uninstall the application from CasaOS but keep the repository configuration.</p>
                        </div>
                        
                        <div class="data-preservation-section">
                            <label class="preserve-data-label">
                                <input type="checkbox" id="preserve-app-data-uninstall" checked>
                                <span class="preserve-data-text">
                                    <strong>Preserve application data</strong><br>
                                    <small>Keep user data, settings, and configurations. You can reinstall later without losing data.</small>
                                </span>
                            </label>
                        </div>
                        
                        <div class="uninstall-warning">
                            <p><strong>⚠️ What will happen:</strong></p>
                            <ul>
                                <li>Application will be removed from CasaOS</li>
                                <li>Container will be stopped and removed</li>
                                <li>Repository configuration will remain intact</li>
                                <li id="data-warning">User data will be preserved for future reinstallation</li>
                            </ul>
                        </div>
                    </div>
                    <div class="uninstall-actions">
                        <button class="btn btn-secondary" id="cancel-app-uninstall">Cancel</button>
                        <button class="btn btn-danger" id="confirm-app-uninstall">Uninstall Application</button>
                    </div>
                </div>
            `;

            // Add styles
            const style = document.createElement('style');
            style.textContent = `
                #app-uninstall-confirmation {
                    position: fixed;
                    top: 0; left: 0; right: 0; bottom: 0;
                    z-index: 10000;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                }
                
                .preserve-data-label {
                    display: flex;
                    align-items: flex-start;
                    gap: 12px;
                    cursor: pointer;
                    padding: 12px;
                    border: 1px solid #e5e7eb;
                    border-radius: 8px;
                    margin: 16px 0;
                }
                
                .preserve-data-label input[type="checkbox"] {
                    margin-top: 2px;
                }
                
                .preserve-data-text {
                    flex: 1;
                }
                
                .preserve-data-text small {
                    color: #666;
                    line-height: 1.3;
                }
            `;

            if (!document.getElementById('app-uninstall-styles')) {
                style.id = 'app-uninstall-styles';
                document.head.appendChild(style);
            }

            document.body.appendChild(popup);

            // Handle button clicks
            const cancelBtn = document.getElementById('cancel-app-uninstall');
            const confirmBtn = document.getElementById('confirm-app-uninstall');
            const preserveDataCheckbox = document.getElementById('preserve-app-data-uninstall');
            const dataWarning = document.getElementById('data-warning');

            // Handle preserve data checkbox
            preserveDataCheckbox.addEventListener('change', () => {
                if (preserveDataCheckbox.checked) {
                    dataWarning.textContent = 'User data will be preserved for future reinstallation';
                    dataWarning.style.color = '#10b981';
                } else {
                    dataWarning.textContent = 'If data preservation is disabled, all user data will be lost';
                    dataWarning.style.color = '#dc2626';
                }
            });

            cancelBtn.addEventListener('click', () => {
                popup.remove();
                resolve({ proceed: false });
            });

            confirmBtn.addEventListener('click', () => {
                const preserveData = preserveDataCheckbox.checked;
                popup.remove();
                resolve({ proceed: true, preserveData });
            });

            // Handle backdrop click
            popup.querySelector('.uninstall-backdrop').addEventListener('click', () => {
                popup.remove();
                resolve({ proceed: false });
            });
        });
    }

    setupInteractiveTerminalHandlers() {
        const userSelect = document.getElementById('terminal-user');
        const customUserInput = document.getElementById('custom-user');
        const commandInput = document.getElementById('terminal-command-input');
        const executeBtn = document.getElementById('terminal-execute-btn');
        const promptText = document.getElementById('terminal-prompt-text');

        // Handle user selection
        userSelect.addEventListener('change', () => {
            if (userSelect.value === 'custom') {
                customUserInput.style.display = 'inline-block';
                customUserInput.focus();
            } else {
                customUserInput.style.display = 'none';
                this.terminalSession.user = userSelect.value;
                this.updateTerminalPrompt();
            }
        });

        customUserInput.addEventListener('input', () => {
            const customUser = customUserInput.value.trim() || 'user';
            this.terminalSession.user = customUser;
            this.updateTerminalPrompt();
        });

        // Handle command execution
        const executeCommand = () => {
            const command = commandInput.value.trim();
            if (!command) return;

            let runAsUser = userSelect.value;
            if (runAsUser === 'custom') {
                runAsUser = customUserInput.value.trim() || 'user';
            }

            this.executeTerminalCommand(command, runAsUser);
            commandInput.value = '';
        };

        executeBtn.addEventListener('click', executeCommand);
        
        // Handle keyboard events for command input
        commandInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                executeCommand();
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                this.navigateHistory('prev');
            } else if (e.key === 'ArrowDown') {
                e.preventDefault();
                this.navigateHistory('next');
            } else if (e.key === 'Tab') {
                e.preventDefault();
                this.handleTabCompletion();
            }
        });
        
        // Handle history navigation buttons
        const historyPrevBtn = document.getElementById('history-prev-btn');
        const historyNextBtn = document.getElementById('history-next-btn');
        
        historyPrevBtn.addEventListener('click', () => this.navigateHistory('prev'));
        historyNextBtn.addEventListener('click', () => this.navigateHistory('next'));

        // Focus command input
        commandInput.focus();
        
        // Initialize prompt
        this.updateTerminalPrompt();
        
        // Set up sidebar event handlers
        this.setupSidebarHandlers();
        
        // Cache initial directory listing and update sidebar
        this.initializeSidebar();
    }

    updateTerminalPrompt() {
        const promptText = document.getElementById('terminal-prompt-text');
        if (promptText) {
            // Format directory for prompt (shorten long paths)
            let displayDir = this.terminalSession.currentDir;
            if (displayDir.length > 25) {
                displayDir = '...' + displayDir.substring(displayDir.length - 22);
            }
            promptText.textContent = `${this.terminalSession.user}@casaos:${displayDir}$`;
        }
        
        // Update sidebar path display
        const sidebarPath = document.getElementById('sidebar-current-path');
        if (sidebarPath) {
            sidebarPath.textContent = this.terminalSession.currentDir;
        }
    }

    setupSidebarHandlers() {
        const refreshBtn = document.getElementById('refresh-files-btn');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', () => {
                this.updateSidebar();
            });
        }
    }

    async initializeSidebar() {
        try {
            // Wait for initial directory caching to complete
            await this.cacheDirectoryListing(this.terminalSession.currentDir, 'ubuntu');
            // Then update the sidebar with the cached data
            this.updateSidebar();
        } catch (error) {
            console.error('Failed to initialize sidebar:', error);
            // Still try to update sidebar even if caching failed
            this.updateSidebar();
        }
    }

    async updateSidebar() {
        const fileBrowser = document.getElementById('file-browser');
        if (!fileBrowser) return;

        // Check cache first
        const cached = this.terminalSession.directoryCache.get(this.terminalSession.currentDir);
        if (cached && (Date.now() - cached.timestamp < 30000)) { // 30 second cache
            console.log('Using cached directory listing for sidebar');
            this.renderFileList(cached.files);
            return;
        }

        // Show loading
        fileBrowser.innerHTML = '<div class="loading-files">Loading...</div>';

        try {
            const userSelect = document.getElementById('terminal-user');
            let runAsUser = userSelect ? userSelect.value : 'ubuntu';
            if (runAsUser === 'custom') {
                const customUserInput = document.getElementById('custom-user');
                runAsUser = customUserInput ? customUserInput.value.trim() || 'ubuntu' : 'ubuntu';
            }

            const response = await axios.post(this.addHashToUrl('/api/admin/terminal/autocomplete'), {
                path: '',
                currentDir: this.terminalSession.currentDir,
                runAsUser: runAsUser
            });

            if (response.data.success && response.data.completions) {
                console.log('Received directory listing:', response.data.completions);
                // Update cache
                this.terminalSession.directoryCache.set(this.terminalSession.currentDir, {
                    files: response.data.completions,
                    timestamp: Date.now()
                });

                this.renderFileList(response.data.completions);
            } else {
                fileBrowser.innerHTML = '<div class="loading-files">No files found</div>';
            }
        } catch (error) {
            console.error('Failed to load directory:', error);
            fileBrowser.innerHTML = '<div class="loading-files">Error loading files</div>';
        }
    }

    renderFileList(files) {
        const fileBrowser = document.getElementById('file-browser');
        if (!fileBrowser) return;

        // Sort files: directories first, then files, alphabetically
        const sortedFiles = files.sort((a, b) => {
            if (a.type !== b.type) {
                return a.type === 'directory' ? -1 : 1;
            }
            return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
        });

        fileBrowser.innerHTML = '';

        // Add parent directory entry if not in root
        if (this.terminalSession.currentDir !== '/') {
            const parentItem = document.createElement('div');
            parentItem.className = 'file-item directory';
            parentItem.innerHTML = `
                <span class="file-icon">📁</span>
                <span class="file-name">..</span>
                <span class="file-details">parent</span>
            `;
            parentItem.addEventListener('dblclick', () => {
                this.navigateToDirectory('..');
            });
            fileBrowser.appendChild(parentItem);
        }

        sortedFiles.forEach((file, index) => {
            const fileItem = document.createElement('div');
            fileItem.className = `file-item ${file.type}`;
            fileItem.dataset.fileName = file.name;
            fileItem.dataset.fileType = file.type;
            fileItem.dataset.index = index;
            
            let icon = '📄';
            if (file.type === 'directory') {
                icon = '📁';
            } else if (file.permissions && file.permissions.includes('x')) {
                icon = '⚡';
                fileItem.classList.add('executable');
            }

            fileItem.innerHTML = `
                <span class="file-icon">${icon}</span>
                <span class="file-name" title="${file.name}">${file.name}</span>
                <span class="file-details">${file.size || ''}</span>
            `;

            // Add click handler for selection
            fileItem.addEventListener('click', (e) => {
                this.handleFileItemClick(fileItem, e);
            });

            // Add double-click handler for directories
            if (file.type === 'directory') {
                fileItem.addEventListener('dblclick', () => {
                    this.navigateToDirectory(file.name);
                });
            }

            // Add right-click context menu
            fileItem.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                this.showContextMenu(e, fileItem);
            });

            fileBrowser.appendChild(fileItem);
        });

        // Add context menu HTML if not exists
        this.createContextMenu();
    }

    handleFileItemClick(fileItem, event) {
        const fileBrowser = document.getElementById('file-browser');
        
        if (event.shiftKey) {
            // Multi-selection with Shift
            const selectedItems = fileBrowser.querySelectorAll('.file-item.selected');
            const allItems = Array.from(fileBrowser.querySelectorAll('.file-item'));
            
            if (selectedItems.length > 0) {
                const lastSelected = selectedItems[selectedItems.length - 1];
                const startIndex = allItems.indexOf(lastSelected);
                const endIndex = allItems.indexOf(fileItem);
                const minIndex = Math.min(startIndex, endIndex);
                const maxIndex = Math.max(startIndex, endIndex);
                
                // Select range
                for (let i = minIndex; i <= maxIndex; i++) {
                    allItems[i].classList.add('selected');
                }
            } else {
                fileItem.classList.add('selected');
            }
        } else if (event.ctrlKey || event.metaKey) {
            // Toggle selection with Ctrl/Cmd
            fileItem.classList.toggle('selected');
        } else {
            // Single selection
            fileBrowser.querySelectorAll('.file-item.selected').forEach(item => {
                item.classList.remove('selected');
            });
            fileItem.classList.add('selected');
        }
    }

    createContextMenu() {
        let contextMenu = document.getElementById('file-context-menu');
        if (contextMenu) return;

        contextMenu = document.createElement('div');
        contextMenu.id = 'file-context-menu';
        contextMenu.className = 'context-menu';
        contextMenu.innerHTML = `
            <div class="context-menu-item" data-action="open">
                <span>📁</span>
                <span>Open</span>
            </div>
            <div class="context-menu-separator"></div>
            <div class="context-menu-item" data-action="rename">
                <span>✏️</span>
                <span>Rename</span>
            </div>
            <div class="context-menu-item" data-action="delete">
                <span>🗑️</span>
                <span>Delete</span>
            </div>
        `;

        // Add click handlers
        contextMenu.addEventListener('click', (e) => {
            const item = e.target.closest('.context-menu-item');
            if (item && !item.classList.contains('disabled')) {
                const action = item.dataset.action;
                this.handleContextMenuAction(action);
            }
            this.hideContextMenu();
        });

        // Append to terminal container instead of body
        const terminalContainer = document.querySelector('#interactive-terminal-popup .terminal-container');
        if (terminalContainer) {
            terminalContainer.appendChild(contextMenu);
        } else {
            document.body.appendChild(contextMenu);
        }

        // Hide context menu when clicking elsewhere
        document.addEventListener('click', () => {
            this.hideContextMenu();
        });
    }

    showContextMenu(event, fileItem) {
        const contextMenu = document.getElementById('file-context-menu');
        if (!contextMenu) return;

        // Select the right-clicked item if not already selected
        if (!fileItem.classList.contains('selected')) {
            document.querySelectorAll('.file-item.selected').forEach(item => {
                item.classList.remove('selected');
            });
            fileItem.classList.add('selected');
        }

        // Show context menu at cursor position relative to the terminal container
        const terminalContainer = document.querySelector('#interactive-terminal-popup .terminal-container');
        const containerRect = terminalContainer.getBoundingClientRect();
        
        contextMenu.style.display = 'block';
        contextMenu.style.left = (event.clientX - containerRect.left) + 'px';
        contextMenu.style.top = (event.clientY - containerRect.top) + 'px';

        // Update menu items based on selection
        const selectedItems = document.querySelectorAll('.file-item.selected');
        const openItem = contextMenu.querySelector('[data-action="open"]');
        
        if (selectedItems.length === 1 && selectedItems[0].dataset.fileType === 'directory') {
            openItem.classList.remove('disabled');
        } else {
            openItem.classList.add('disabled');
        }
    }

    hideContextMenu() {
        const contextMenu = document.getElementById('file-context-menu');
        if (contextMenu) {
            contextMenu.style.display = 'none';
        }
    }

    handleContextMenuAction(action) {
        const selectedItems = Array.from(document.querySelectorAll('.file-item.selected'));
        
        switch (action) {
            case 'open':
                if (selectedItems.length === 1 && selectedItems[0].dataset.fileType === 'directory') {
                    this.navigateToDirectory(selectedItems[0].dataset.fileName);
                }
                break;
            case 'rename':
                if (selectedItems.length === 1) {
                    this.renameFile(selectedItems[0].dataset.fileName);
                }
                break;
            case 'delete':
                if (selectedItems.length > 0) {
                    this.showDeleteConfirmation(selectedItems);
                }
                break;
        }
    }

    showDeleteConfirmation(selectedItems) {
        const fileNames = selectedItems.map(item => item.dataset.fileName);
        
        // Hide context menu first
        this.hideContextMenu();
        
        // Create delete confirmation modal
        const modal = document.createElement('div');
        modal.className = 'modal';
        modal.id = 'delete-confirmation-modal';
        modal.style.zIndex = '10002'; // Higher than context menu (z-index: 100)
        modal.innerHTML = `
            <div class="modal-content" style="width: 500px; max-height: 80vh;">
                <div class="modal-header">
                    <h3>⚠️ Confirm Delete</h3>
                    <button class="close-btn" onclick="this.closest('.modal').remove()">&times;</button>
                </div>
                <div class="modal-body">
                    <p><strong>Are you sure you want to delete the following ${fileNames.length} item(s)?</strong></p>
                    <p style="color: #dc2626; font-size: 14px; margin: 10px 0;">This action cannot be undone!</p>
                    <div style="max-height: 200px; overflow-y: auto; border: 1px solid #ddd; border-radius: 4px; padding: 10px; background: #f9f9f9;">
                        ${fileNames.map(name => `<div style="padding: 2px 0; font-family: monospace;">${name}</div>`).join('')}
                    </div>
                </div>
                <div class="modal-footer">
                    <button class="btn btn-secondary" onclick="this.closest('.modal').remove()">Cancel</button>
                    <button class="btn" style="background: #dc2626; color: white;" onclick="repoManager.confirmDelete(['${fileNames.join("', '")}']); this.closest('.modal').remove();">
                        🗑️ Delete ${fileNames.length} item(s)
                    </button>
                </div>
            </div>
        `;
        
        modal.style.display = 'block';
        document.body.appendChild(modal);
    }

    async confirmDelete(fileNames) {
        // Clear selections
        document.querySelectorAll('.file-item.selected').forEach(item => {
            item.classList.remove('selected');
        });

        try {
            const userSelect = document.getElementById('terminal-user');
            let runAsUser = userSelect ? userSelect.value : 'ubuntu';
            if (runAsUser === 'custom') {
                const customUserInput = document.getElementById('custom-user');
                runAsUser = customUserInput ? customUserInput.value.trim() || 'ubuntu' : 'ubuntu';
            }

            const response = await axios.post(this.addHashToUrl('/api/admin/terminal/delete'), {
                fileNames: fileNames,
                currentDir: this.terminalSession.currentDir,
                runAsUser: runAsUser
            });

            // Add to terminal history
            this.addToTerminalHistory(`rm ${fileNames.map(f => `"${f}"`).join(' ')}`, response.data.success ? response.data.message : `❌ ${response.data.message}`);

            if (response.data.success) {
                this.showNotification(`✅ ${response.data.message}`, 'success');
                // Clear cache and refresh sidebar after a small delay
                this.terminalSession.directoryCache.delete(this.terminalSession.currentDir);
                setTimeout(() => {
                    this.updateSidebar();
                }, 500);
            } else {
                this.showNotification(`❌ ${response.data.message}`, 'error');
            }
        } catch (error) {
            console.error('Delete failed:', error);
            this.showNotification(`❌ Delete failed: ${error.message}`, 'error');
        }
    }

    async renameFile(fileName) {
        const newName = prompt(`Rename "${fileName}" to:`, fileName);
        if (newName && newName !== fileName) {
            try {
                const userSelect = document.getElementById('terminal-user');
                let runAsUser = userSelect ? userSelect.value : 'ubuntu';
                if (runAsUser === 'custom') {
                    const customUserInput = document.getElementById('custom-user');
                    runAsUser = customUserInput ? customUserInput.value.trim() || 'ubuntu' : 'ubuntu';
                }

                const response = await axios.post(this.addHashToUrl('/api/admin/terminal/rename'), {
                    oldName: fileName,
                    newName: newName,
                    currentDir: this.terminalSession.currentDir,
                    runAsUser: runAsUser
                });

                // Add to terminal history
                this.addToTerminalHistory(`mv "${fileName}" "${newName}"`, response.data.success ? response.data.message : `❌ ${response.data.message}`);

                if (response.data.success) {
                    this.showNotification(`✅ ${response.data.message}`, 'success');
                    // Clear cache and refresh sidebar after a small delay
                    this.terminalSession.directoryCache.delete(this.terminalSession.currentDir);
                    setTimeout(() => {
                        this.updateSidebar();
                    }, 500);
                } else {
                    this.showNotification(`❌ ${response.data.message}`, 'error');
                }
            } catch (error) {
                console.error('Rename failed:', error);
                this.showNotification(`❌ Rename failed: ${error.message}`, 'error');
            }
        }
    }

    async navigateToDirectory(dirName) {
        try {
            const userSelect = document.getElementById('terminal-user');
            let runAsUser = userSelect ? userSelect.value : 'ubuntu';
            if (runAsUser === 'custom') {
                const customUserInput = document.getElementById('custom-user');
                runAsUser = customUserInput ? customUserInput.value.trim() || 'ubuntu' : 'ubuntu';
            }

            // Build the cd command
            let targetDir;
            if (dirName === '..') {
                targetDir = this.terminalSession.currentDir.split('/').slice(0, -1).join('/') || '/';
            } else {
                targetDir = this.terminalSession.currentDir === '/' ? 
                    `/${dirName}` : 
                    `${this.terminalSession.currentDir}/${dirName}`;
            }

            const response = await axios.post(this.addHashToUrl('/api/admin/terminal/execute'), {
                command: `cd "${targetDir}"`,
                runAsUser: runAsUser,
                currentDir: this.terminalSession.currentDir,
                envVars: this.terminalSession.envVars
            });

            if (response.data.success && response.data.newDir) {
                this.terminalSession.currentDir = response.data.newDir;
                this.updateTerminalPrompt();
                this.updateSidebar();
            }
        } catch (error) {
            console.error('Failed to navigate to directory:', error);
        }
    }

    navigateHistory(direction) {
        const commandInput = document.getElementById('terminal-command-input');
        const history = this.terminalSession.commandHistory;
        
        if (history.length === 0) return;
        
        if (direction === 'prev') {
            if (this.terminalSession.historyIndex === -1) {
                // Save current input before starting history navigation
                this.terminalSession.currentInput = commandInput.value;
                this.terminalSession.historyIndex = history.length - 1;
                commandInput.value = history[this.terminalSession.historyIndex];
            } else if (this.terminalSession.historyIndex > 0) {
                this.terminalSession.historyIndex--;
                commandInput.value = history[this.terminalSession.historyIndex];
            }
            // Don't loop - stop at first command
        } else if (direction === 'next') {
            if (this.terminalSession.historyIndex === -1) {
                // Already at current input, don't do anything
                return;
            } else if (this.terminalSession.historyIndex < history.length - 1) {
                this.terminalSession.historyIndex++;
                commandInput.value = history[this.terminalSession.historyIndex];
            } else {
                // Return to current input (what user was typing)
                this.terminalSession.historyIndex = -1;
                commandInput.value = this.terminalSession.currentInput || '';
            }
        }
        
        this.updateHistoryButtons();
    }

    updateHistoryButtons() {
        const historyPrevBtn = document.getElementById('history-prev-btn');
        const historyNextBtn = document.getElementById('history-next-btn');
        const history = this.terminalSession.commandHistory;
        
        if (historyPrevBtn && historyNextBtn) {
            // Disable prev button if no history or at oldest command
            historyPrevBtn.disabled = history.length === 0 || this.terminalSession.historyIndex === 0;
            
            // Disable next button if no history or at current input
            historyNextBtn.disabled = history.length === 0 || this.terminalSession.historyIndex === -1;
        }
    }

    async handleTabCompletion() {
        const commandInput = document.getElementById('terminal-command-input');
        const command = commandInput.value;
        const cursorPosition = commandInput.selectionStart;
        
        // TAB completion triggered
        
        // Find the word at cursor position
        const beforeCursor = command.substring(0, cursorPosition);
        const afterCursor = command.substring(cursorPosition);
        
        // Extract the current word (file/folder path)
        const lastSpaceIndex = beforeCursor.lastIndexOf(' ');
        const currentWord = beforeCursor.substring(lastSpaceIndex + 1);
        
        if (!currentWord) {
            // No current word, show cached directory listing if available
            const cached = this.terminalSession.directoryCache.get(this.terminalSession.currentDir);
            if (cached && (Date.now() - cached.timestamp < 30000)) { // 30 second cache
                const allFiles = cached.files.map(file => file.name || file);
                this.showCompletionsInOutput(allFiles, 'All files in current directory:');
                return;
            }
        }
        
        // Determine the directory we're completing in
        let searchDir = this.terminalSession.currentDir;
        let filePrefix = currentWord;
        
        if (currentWord.startsWith('/')) {
            // Absolute path
            const lastSlash = currentWord.lastIndexOf('/');
            if (lastSlash > 0) {
                searchDir = currentWord.substring(0, lastSlash);
                filePrefix = currentWord.substring(lastSlash + 1);
            } else {
                searchDir = '/';
                filePrefix = currentWord.substring(1);
            }
        } else if (currentWord.includes('/')) {
            // Relative path with subdirectory
            const lastSlash = currentWord.lastIndexOf('/');
            const relativeDir = currentWord.substring(0, lastSlash);
            searchDir = this.terminalSession.currentDir === '/' ? `/${relativeDir}` : `${this.terminalSession.currentDir}/${relativeDir}`;
            filePrefix = currentWord.substring(lastSlash + 1);
        }
        
        // Clean up the search directory path
        searchDir = searchDir.replace(/\/+/g, '/').replace(/\/$/, '') || '/';
        
        // Fast TAB completion processing
        
        // Check if we have a cached listing for this directory
        const cached = this.terminalSession.directoryCache.get(searchDir);
        // Check cache (removed debug for performance)
        
        if (cached && (Date.now() - cached.timestamp < 30000)) { // 30 second cache
            // Fast path for cached completions - minimal processing
            const filteredCompletions = cached.files
                .map(file => typeof file === 'object' && file.name ? file.name : String(file))
                .filter(filename => filename.toLowerCase().startsWith(filePrefix.toLowerCase()));
            
            if (filteredCompletions.length > 0) {
                this.processCompletions(filteredCompletions, beforeCursor, afterCursor, lastSpaceIndex, currentWord, commandInput);
                return;
            }
        }
        
        // Fall back to server-side autocomplete
        try {
            let runAsUser = document.getElementById('terminal-user').value;
            if (runAsUser === 'custom') {
                runAsUser = document.getElementById('custom-user').value.trim() || 'user';
            }
            
            
            const response = await axios.post(this.addHashToUrl('/api/admin/terminal/autocomplete'), {
                path: currentWord,
                currentDir: this.terminalSession.currentDir,
                runAsUser: runAsUser
            });
            
            
            if (response.data.success && response.data.completions.length > 0) {
                // If this was for a subdirectory, cache the results for future use
                if (searchDir !== this.terminalSession.currentDir) {
                    // Normalize the completions to just filenames (remove path prefixes)
                    const normalizedFiles = response.data.completions.map(completion => {
                        // If completion contains a path, extract just the filename
                        const filename = completion.includes('/') ? completion.split('/').pop() : completion;
                        return { name: filename, type: completion.endsWith('/') ? 'directory' : 'file' };
                    });
                    
                    const cacheEntry = {
                        files: normalizedFiles,
                        timestamp: Date.now()
                    };
                    this.terminalSession.directoryCache.set(searchDir, cacheEntry);
                }
                
                this.processCompletions(response.data.completions, beforeCursor, afterCursor, lastSpaceIndex, currentWord, commandInput);
            }
        } catch (error) {
            console.error('Tab completion failed:', error);
        }
    }

    processCompletions(completions, beforeCursor, afterCursor, lastSpaceIndex, currentWord, commandInput) {
        if (completions.length === 1) {
            // Single completion - auto-complete
            const completion = completions[0];
            
            // Handle path completion properly
            if (currentWord.includes('/')) {
                // Replace only the filename part after the last slash
                const lastSlash = currentWord.lastIndexOf('/');
                const pathPart = currentWord.substring(0, lastSlash + 1);
                const beforeWord = beforeCursor.substring(0, lastSpaceIndex + 1);
                
                const newValue = beforeWord + pathPart + completion + afterCursor;
                commandInput.value = newValue;
                
                // Set cursor position after completion
                const newCursorPos = beforeWord.length + pathPart.length + completion.length;
                commandInput.setSelectionRange(newCursorPos, newCursorPos);
                
                // If this completed to a directory, proactively cache it for faster future completions
                this.proactivelyCacheDirectory(pathPart + completion);
            } else {
                // Simple case - no path, just replace the word
                const beforeWord = beforeCursor.substring(0, lastSpaceIndex + 1);
                const newValue = beforeWord + completion + afterCursor;
                commandInput.value = newValue;
                
                // Set cursor position after completion
                const newCursorPos = beforeWord.length + completion.length;
                commandInput.setSelectionRange(newCursorPos, newCursorPos);
                
                // If this completed to a directory, proactively cache it for faster future completions
                this.proactivelyCacheDirectory(completion);
            }
        } else {
            // Multiple completions - show in output
            const output = document.getElementById('terminal-output');
            const completionLine = document.createElement('div');
            completionLine.className = 'log-line info';
            completionLine.textContent = `📁 Completions: ${completions.map(c => c.split('/').pop()).join('  ')}`;
            output.appendChild(completionLine);
            output.scrollTop = output.scrollHeight;
            
            // Find common prefix and auto-complete that part
            const commonPrefix = this.findCommonPrefix(completions);
            if (commonPrefix.length > currentWord.length) {
                const beforeWord = beforeCursor.substring(0, lastSpaceIndex + 1);
                const newValue = beforeWord + commonPrefix + afterCursor;
                commandInput.value = newValue;
                
                const newCursorPos = beforeWord.length + commonPrefix.length;
                commandInput.setSelectionRange(newCursorPos, newCursorPos);
            }
        }
    }

    validateCacheEntry(key, data) {
        console.log(`[DEBUG] VALIDATE CACHE - Validating cache entry for ${key}`);
        if (!data || !data.files || !Array.isArray(data.files)) {
            console.error(`[DEBUG] VALIDATE CACHE - Invalid cache structure for ${key}:`, data);
            return false;
        }
        
        data.files.forEach((item, index) => {
            if (typeof item === 'string') {
                console.warn(`[DEBUG] VALIDATE CACHE - String format detected at ${key}[${index}]:`, item);
                if (item.includes('/') && !item.startsWith('./') && !item.startsWith('../')) {
                    console.error(`[DEBUG] VALIDATE CACHE - CORRUPTED: Full path in cache at ${key}[${index}]:`, item);
                }
            } else if (typeof item === 'object') {
                if (!item.name) {
                    console.error(`[DEBUG] VALIDATE CACHE - Object missing name at ${key}[${index}]:`, item);
                }
            } else {
                console.error(`[DEBUG] VALIDATE CACHE - Unknown format at ${key}[${index}]:`, typeof item, item);
            }
        });
        return true;
    }

    async proactivelyCacheDirectory(directoryPath) {
        // Only cache if it looks like a directory (ends with / or is a known directory from completion)
        let fullPath = directoryPath.startsWith('/') ? directoryPath : 
                      (this.terminalSession.currentDir === '/' ? `/${directoryPath}` : 
                       `${this.terminalSession.currentDir}/${directoryPath}`);
        
        // Normalize path: remove trailing slash for consistency
        fullPath = fullPath.replace(/\/+/g, '/').replace(/\/$/, '') || '/';
        
        // Check if we already have this cached
        if (this.terminalSession.directoryCache.has(fullPath)) {
            return;
        }
        
        
        try {
            const userSelect = document.getElementById('terminal-user');
            let runAsUser = userSelect ? userSelect.value : 'ubuntu';
            if (runAsUser === 'custom') {
                const customUserInput = document.getElementById('custom-user');
                runAsUser = customUserInput ? customUserInput.value.trim() || 'ubuntu' : 'ubuntu';
            }

            const response = await axios.post(this.addHashToUrl('/api/admin/terminal/autocomplete'), {
                path: '',
                currentDir: fullPath,
                runAsUser: runAsUser
            });

            if (response.data.success && response.data.completions) {
                console.log('[DEBUG] PROACTIVE CACHE - Raw response for', fullPath, ':', response.data.completions);
                // Validate cache format
                response.data.completions.forEach((item, index) => {
                    console.log(`[DEBUG] PROACTIVE CACHE - Item ${index}:`, typeof item, item);
                });
                
                const cacheEntry = {
                    files: response.data.completions,
                    timestamp: Date.now()
                };
                this.terminalSession.directoryCache.set(fullPath, cacheEntry);
                console.log('[DEBUG] PROACTIVE CACHE - Successfully cached', response.data.completions.length, 'items for', fullPath);
                this.validateCacheEntry(fullPath, cacheEntry);
            }
        } catch (error) {
            console.log('[DEBUG] Failed to proactively cache directory:', fullPath, error);
        }
    }

    showCachedCompletions(files) {
        const output = document.getElementById('terminal-output');
        const completionLine = document.createElement('div');
        completionLine.className = 'log-line info';
        completionLine.textContent = `📁 ${files.length} items: ${files.map(f => f.split('/').pop()).join('  ')}`;
        output.appendChild(completionLine);
        output.scrollTop = output.scrollHeight;
    }

    showCompletionsInOutput(files, title = 'Completions:') {
        const output = document.getElementById('terminal-output');
        const completionLine = document.createElement('div');
        completionLine.className = 'log-line info';
        completionLine.textContent = `📁 ${title} ${files.join('  ')}`;
        output.appendChild(completionLine);
        output.scrollTop = output.scrollHeight;
    }

    findCommonPrefix(strings) {
        if (strings.length === 0) return '';
        if (strings.length === 1) return strings[0];
        
        let prefix = '';
        const firstString = strings[0];
        
        for (let i = 0; i < firstString.length; i++) {
            const char = firstString[i];
            if (strings.every(str => str[i] === char)) {
                prefix += char;
            } else {
                break;
            }
        }
        
        return prefix;
    }

    async cacheDirectoryListing(directory, runAsUser) {
        try {
            let actualUser = runAsUser;
            const userSelect = document.getElementById('terminal-user');
            const customUserInput = document.getElementById('custom-user');
            
            if (userSelect && userSelect.value === 'custom' && customUserInput) {
                actualUser = customUserInput.value.trim() || 'user';
            }
            
            const response = await axios.post(this.addHashToUrl('/api/admin/terminal/autocomplete'), {
                path: '',
                currentDir: directory,
                runAsUser: actualUser
            });
            
            if (response.data.success) {
                // Cache the directory listing with a timestamp
                this.terminalSession.directoryCache.set(directory, {
                    files: response.data.completions,
                    timestamp: Date.now()
                });
                
                // Limit cache size to prevent memory issues
                if (this.terminalSession.directoryCache.size > 20) {
                    const oldestKey = this.terminalSession.directoryCache.keys().next().value;
                    this.terminalSession.directoryCache.delete(oldestKey);
                }
            }
        } catch (error) {
            console.log('Failed to cache directory listing:', error);
        }
    }

    async executeTerminalCommand(command, runAsUser) {
        const output = document.getElementById('terminal-output');
        const promptText = document.getElementById('terminal-prompt-text').textContent;
        
        // Add command to history (avoid duplicates of the last command)
        const trimmedCommand = command.trim();
        if (trimmedCommand && 
            (this.terminalSession.commandHistory.length === 0 || 
             this.terminalSession.commandHistory[this.terminalSession.commandHistory.length - 1] !== trimmedCommand)) {
            this.terminalSession.commandHistory.push(trimmedCommand);
        }
        
        // Reset history navigation
        this.terminalSession.historyIndex = -1;
        this.terminalSession.currentInput = '';
        this.updateHistoryButtons();
        
        // Add command line to output
        const commandLine = document.createElement('div');
        commandLine.className = 'log-line command';
        commandLine.textContent = `${promptText} ${command}`;
        output.appendChild(commandLine);
        
        // Show executing message
        const executingLine = document.createElement('div');
        executingLine.className = 'log-line info';
        executingLine.textContent = '⏳ Executing...';
        output.appendChild(executingLine);
        
        output.scrollTop = output.scrollHeight;

        try {
            const response = await axios.post(this.addHashToUrl('/api/admin/terminal/execute'), {
                command: command,
                runAsUser: runAsUser,
                currentDir: this.terminalSession.currentDir,
                envVars: this.terminalSession.envVars
            });

            // Remove executing message
            executingLine.remove();

            if (response.data.success) {
                if (response.data.stdout) {
                    const outputLine = document.createElement('div');
                    outputLine.className = 'log-line output';
                    outputLine.textContent = response.data.stdout;
                    output.appendChild(outputLine);
                }
                
                if (response.data.stderr) {
                    const errorLine = document.createElement('div');
                    errorLine.className = 'log-line warning';
                    errorLine.textContent = response.data.stderr;
                    output.appendChild(errorLine);
                }
                
                // Update session state from backend response
                if (response.data.newDir) {
                    const oldDir = this.terminalSession.currentDir;
                    this.terminalSession.currentDir = response.data.newDir;
                    this.updateTerminalPrompt();
                    
                    // If this was a cd command and directory changed, cache the new directory listing
                    if (trimmedCommand.startsWith('cd ') && oldDir !== response.data.newDir) {
                        // Wait for caching to complete before updating sidebar
                        this.cacheDirectoryListing(response.data.newDir, runAsUser).then(() => {
                            this.updateSidebar();
                        });
                    }
                }
                if (response.data.envVars) {
                    this.terminalSession.envVars = response.data.envVars;
                }
            } else {
                const errorLine = document.createElement('div');
                errorLine.className = 'log-line error';
                errorLine.textContent = `❌ ${response.data.message}`;
                output.appendChild(errorLine);
            }
        } catch (error) {
            // Remove executing message
            executingLine.remove();
            
            const errorLine = document.createElement('div');
            errorLine.className = 'log-line error';
            errorLine.textContent = `❌ Command failed: ${error.response?.data?.message || error.message}`;
            output.appendChild(errorLine);
        }

        output.scrollTop = output.scrollHeight;
    }

    addToTerminalHistory(command, result) {
        const output = document.getElementById('terminal-output');
        if (!output) return;
        
        const promptText = document.getElementById('terminal-prompt-text')?.textContent || '$';
        
        // Add command line to output
        const commandLine = document.createElement('div');
        commandLine.className = 'log-line command';
        commandLine.textContent = `${promptText} ${command}`;
        output.appendChild(commandLine);
        
        // Add result line to output
        const resultLine = document.createElement('div');
        resultLine.className = result.startsWith('❌') ? 'log-line error' : 'log-line success';
        resultLine.textContent = result;
        output.appendChild(resultLine);
        
        // Scroll to bottom
        output.scrollTop = output.scrollHeight;
    }

    showNotification(message, type = 'info') {
        let container = document.getElementById('notification-container');
        if (!container) {
            container = document.createElement('div');
            container.id = 'notification-container';
            container.style.cssText = `position: fixed; top: 20px; right: 20px; z-index: 10000; display: flex; flex-direction: column; gap: 10px; pointer-events: none;`;
            document.body.appendChild(container);
        }
        
        const notification = document.createElement('div');
        notification.className = `notification notification-${type}`;
        notification.style.cssText = `padding: 15px 20px; border-radius: 8px; color: white; font-weight: 500; max-width: 400px; opacity: 0; transform: translateX(100%); transition: all 0.3s ease; pointer-events: auto; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);`;

        const colors = { success: '#059669', error: '#dc2626', warning: '#d97706', info: '#2563eb' };
        notification.style.backgroundColor = colors[type] || colors.info;
        notification.textContent = message;
        container.appendChild(notification);
        
        setTimeout(() => {
            notification.style.opacity = '1';
            notification.style.transform = 'translateX(0)';
        }, 100);
        
        setTimeout(() => {
            notification.style.opacity = '0';
            notification.style.transform = 'translateX(100%)';
            setTimeout(() => {
                notification.remove();
                if (container.children.length === 0) container.remove();
            }, 300);
        }, 5000);
    }
}

// Global functions for modal management
function closeModal(modalId) {
    repoManager.closeModal(modalId);
}

function saveYaml() {
    repoManager.saveYaml();
}

// Initialize the repository manager when the page loads
let repoManager;

function initializeApp() {
    console.log('🚀 Initializing Yundera GitHub Compiler...');
    try {
        repoManager = new RepoManager();
        console.log('✅ RepoManager initialized successfully');
        
        // Make repoManager globally accessible for debugging
        window.repoManager = repoManager;
    } catch (error) {
        console.error('❌ Failed to initialize RepoManager:', error);
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeApp);
} else {
    initializeApp();
}