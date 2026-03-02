// RepoManager - Core class for Yundera Dev Kit
'use strict';

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
            type: 'compose',
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

        const storeTrackerBtn = document.getElementById('store-tracker-btn');
        if (storeTrackerBtn) {
            storeTrackerBtn.addEventListener('click', () => this.openStoreTracker());
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
                <option value="compose" ${repoType === 'compose' ? 'selected' : ''}>Docker Compose</option>
                <option value="github" ${repoType === 'github' ? 'selected' : ''}>GitHub Repository</option>
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
                        // Split button for Update (left) and Clean Update (right)
                        return `
                            <div class="split-button-group">
                                <button class="btn btn-small btn-primary split-button-left" title="Update Application" onclick="repoManager.buildRepo('${repoId}')">
                                    <i class="fas fa-arrow-up"></i>
                                </button>
                                <button class="btn btn-small btn-primary split-button-right" title="Clean Update (with options)" onclick="repoManager.cleanUpdateRepo('${repoId}')">
                                    <i class="fas fa-sync-alt"></i>
                                </button>
                            </div>
                        `;
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

    async cleanUpdateRepo(repoId) {
        const repo = this.repos.find(r => r.id === repoId);
        if (!repo) return;

        const result = await this.showReinstallConfirmation(repo, true); // true = isUpdate
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
        // Close any existing streams and popup
        this.closeLogStreams();
        let terminal = document.getElementById('terminal-popup');
        if (terminal) {
            terminal.remove();
        }

        terminal = document.createElement('div');
        terminal.id = 'terminal-popup';
        terminal.innerHTML = `
            <div class="terminal-backdrop" onclick="repoManager.closeTerminalPopup()"></div>
            <div class="terminal-container">
                <div class="terminal-header">
                    <div class="terminal-title">
                        <i class="fas fa-terminal"></i>
                        ${appName} - ${action.charAt(0).toUpperCase() + action.slice(1)} Logs
                    </div>
                    <div class="terminal-controls">
                        <button class="terminal-btn" onclick="repoManager.closeTerminalPopup()">
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

        document.body.appendChild(terminal);

        // Start streaming logs
        this.streamLogs(repoId);

        // Auto-scroll to bottom
        const content = document.getElementById('terminal-content');
        content.scrollTop = content.scrollHeight;
    }

    closeLogStreams() {
        if (this.activeLogStreams) {
            this.activeLogStreams.forEach(es => es.close());
            this.activeLogStreams.clear();
        }
    }

    closeTerminalPopup() {
        this.closeLogStreams();
        const terminal = document.getElementById('terminal-popup');
        if (terminal) terminal.remove();
    }

    async streamLogs(repoId) {
        const content = document.getElementById('terminal-content');
        if (!content) return;

        // Close any existing streams before opening a new one
        this.closeLogStreams();

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
                if (this.activeLogStreams) this.activeLogStreams.delete(eventSource);

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

    // Helper function to escape HTML characters
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
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