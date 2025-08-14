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
        this.init();
    }

    // Extract authentication hash from URL parameters
    getAuthHashFromUrl() {
        const urlParams = new URLSearchParams(window.location.search);
        const hash = urlParams.get('hash');
        if (!hash) {
            console.warn('⚠️ No authentication hash found in URL parameters');
        }
        return hash;
    }

    // Add authentication hash to request data
    addAuthToRequest(data = {}) {
        if (this.authHash) {
            data.hash = this.authHash;
        }
        return data;
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
            const url = this.authHash ? `/api/repos?hash=${this.authHash}` : '/api/repos';
            const response = await axios.get(url);
            this.repos = response.data.repos || [];
            this.renderRepos();
        } catch (error) {
            console.error('Failed to load repositories:', error);
            this.repos = [];
            this.renderRepos();
        }
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
            const url = this.authHash ? `/api/settings?hash=${this.authHash}` : '/api/settings';
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

        let displayName = repo.name || (repoType === 'github' ? 'New GitHub App' : 'New Compose App');
        if (isEmpty && repoType === 'github' && repoUrl) {
            displayName = this.extractRepoName(repoUrl) || 'New GitHub App';
        }

        const nameHTML = `<h3 class="repo-name">${displayName}</h3>`;

        const typeDropdownHTML = `
            <select onchange="repoManager.handleTypeChange('empty', this.value)" ${!isEmpty ? 'disabled' : ''}>
                <option value="github" ${repoType === 'github' ? 'selected' : ''}>GitHub Repository</option>
                <option value="compose" ${repoType === 'compose' ? 'selected' : ''}>Docker Compose</option>
            </select>`;

        const statusInfoHTML = `
            <div class="status-info">
                <div style="display: flex; align-items: center; gap: 8px;">
                    <span class="installation-badge installation-${installationStatus.status.split('-')[0]}">
                        ${installationStatus.label}
                    </span>
                    ${repo.installMismatch ? '<span class="warning-triangle" title="App is listed as installed but not found in CasaOS. It may have been removed manually."><i class="fas fa-exclamation-triangle"></i></span>' : ''}
                </div>
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
                               placeholder="https://github.com/username/repository.git" 
                               value="${repoUrl}"
                               oninput="repoManager.handleUrlChange('empty', this.value)"
                               ${!isEmpty ? 'disabled' : ''}>
                    </div>
                </div>
                <div class="repo-settings">
                    <div class="setting-row">
                        <label>Auto-Update:</label>
                        <div class="switch ${autoUpdate ? 'active' : ''}" onclick="repoManager.toggleRepoAutoUpdate('${repoId}')" ${isEmpty ? 'disabled' : ''}>
                            <div class="switch-slider"></div>
                        </div>
                    </div>
                    <div class="setting-row">
                        <label>Interval (min):</label>
                        <input type="number" min="5" max="10080" value="${repo.autoUpdateInterval || 60}" 
                               onchange="repoManager.updateRepoSettings('${repoId}', { autoUpdateInterval: this.value })" 
                               ${!autoUpdate || isEmpty ? 'disabled' : ''}>
                    </div>
                    <div class="setting-row">
                        <label>API Updates:</label>
                        <div class="switch ${repo.apiUpdatesEnabled !== false ? 'active' : ''}" onclick="repoManager.toggleRepoApiUpdates('${repoId}')" ${isEmpty ? 'disabled' : ''}>
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
                const actionText = repo.type === 'github' ? 'Update' : 'Re-install';
                return `<button class="btn btn-small btn-warning" title="${actionText}" onclick="repoManager.buildRepo('${repoId}')"><i class="fas fa-sync-alt"></i></button>`;
            case 'error':
                const retryText = repo.type === 'github' ? 'Retry Build' : 'Retry Install';
                return `<button class="btn btn-small btn-danger" title="${retryText}" onclick="repoManager.buildRepo('${repoId}')"><i class="fas fa-redo"></i></button>`;
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
            this.renderRepos();
        }
    }
    
    handleTypeChange(repoId, type) {
        if (repoId === 'empty') {
            this.emptyRepoState.type = type;
            this.renderRepos();
        }
    }
    
    createComposeRepo() {
        this.currentEditingRepo = 'new-compose';
        document.getElementById('yaml-textarea').value = '';
        this.openModal('yaml-modal');
    }

    async importRepo(repoId) {
        if (repoId !== 'empty') return;
        
        this.disableActionButton('empty');
        const { url } = this.emptyRepoState;
        const name = this.extractRepoName(url);

        if (!name) {
            this.showNotification('Could not determine repository name from URL.', 'error');
            this.enableActionButton('empty');
            return;
        }

        try {
            const repo = await this.createNewRepo(name, url, 'github');
            this.emptyRepoState = { name: '', type: 'github', url: '' };
            await this.loadRepos();
            
            // Now trigger the actual import process for the newly created repo
            this.updateRepoStatus(repo.id, 'importing');
            this.showNotification(`Importing ${repo.name}...`, 'info');
            const response = await axios.post(`/api/repos/${repo.id}/import`, this.addAuthToRequest({}));
            if (response.data.success) {
                this.showNotification(`${repo.name} imported successfully! Ready to build.`, 'success');
                await this.loadRepos();
            } else {
                throw new Error(response.data.message);
            }
        } catch (error) {
            this.showNotification(`Failed to import: ${error.message}`, 'error');
            this.enableActionButton('empty');
        }
    }

    async createNewRepo(name, url, type) {
        try {
            const response = await axios.post('/api/repos', this.addAuthToRequest({
                name, url, type,
                autoUpdate: false,
                autoUpdateInterval: 60,
                apiUpdatesEnabled: true,
                status: 'empty'
            }));
            if (response.data.success) return response.data.repo;
            throw new Error(response.data.message);
        } catch (error) {
            const message = error.response?.data?.message || error.message || 'Unknown error';
            throw new Error(message);
        }
    }

    async buildRepo(repoId) {
        const repo = this.repos.find(r => r.id === repoId);
        if (!repo) return;

        // Check if this repo has pre-install commands and show warning (only for first installation)
        const hasPreInstall = await this.checkForPreInstallCommand(repoId);
        let selectedUser = 'ubuntu'; // Default user
        if (hasPreInstall && !repo.isInstalled) {
            // Only show warning for first installation, not updates
            const warningResult = await this.showPreInstallWarning(repo, hasPreInstall);
            if (!warningResult || !warningResult.proceed) {
                return; // User cancelled
            }
            selectedUser = warningResult.runAsUser;
        }

        const action = repo.type === 'github' ? 'building' : 'installing';
        this.updateRepoStatus(repoId, action); // This will re-render and disable the button
        
        // Open terminal log popup
        this.openTerminalPopup(repo.name, repoId, action);

        try {
            const requestData = this.addAuthToRequest({ runAsUser: selectedUser });
            await axios.post(`/api/repos/${repoId}/compile`, requestData);
            console.log(`[${repo.name}] ${action} process initiated via API.`);
            
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
            this.renderRepos();
        }
    }

    async viewCompose(repoId) {
        try {
            const url = this.authHash ? `/api/repos/${repoId}/compose?hash=${this.authHash}` : `/api/repos/${repoId}/compose`;
            const response = await axios.get(url);
            this.currentEditingRepo = repoId;
            document.getElementById('yaml-textarea').value = response.data.yaml || '';
            this.openModal('yaml-modal');
        } catch (error) {
            this.showNotification('Failed to load Docker Compose file', 'error');
        }
    }

    async toggleApp(repoId) {
        const repo = this.repos.find(r => r.id === repoId);
        if (!repo || !repo.isInstalled || repo.status === 'starting' || repo.status === 'stopping') return;

        const action = repo.isRunning ? 'stop' : 'start';
        try {
            const response = await axios.post(`/api/repos/${repoId}/toggle`, this.addAuthToRequest({ start: !repo.isRunning }));
            if (response.data.success) {
                this.showNotification(`Application ${action}ed successfully`, 'success');
                await this.loadRepos();
            } else {
                throw new Error(response.data.message);
            }
        } catch (error) {
            this.showNotification(`Error ${action}ing application: ${error.response?.data?.message || error.message}`, 'error');
        }
    }

    async removeRepo(repoId) {
        const repo = this.repos.find(r => r.id === repoId);
        if (!repo) return;
        
        const result = await this.showUninstallConfirmation(repo);
        if (result.proceed) {
            try {
                const url = this.authHash ? `/api/repos/${repoId}?hash=${this.authHash}` : `/api/repos/${repoId}`;
                const requestData = this.addAuthToRequest({ preserveData: result.preserveData });
                await axios.delete(url, { data: requestData });
                await this.loadRepos();
                this.showNotification('Repository removed successfully', 'success');
            } catch (error) {
                this.showNotification('Failed to remove repository', 'error');
            }
        }
    }

    async updateRepoSettings(repoId, settings) {
        if (repoId === 'empty') return;
        if (Object.keys(settings).length === 0) return;

        try {
            const response = await axios.put(`/api/repos/${repoId}`, this.addAuthToRequest(settings));
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
            
            const response = await axios.put('/api/settings', this.addAuthToRequest(newSettings));
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
            const response = await axios.post('/api/repos/check-updates', this.addAuthToRequest({}));
            if (response.data.success) {
                await this.loadRepos();
                this.showNotification('Update check completed', 'success');
            }
        } catch (error) {
            this.showNotification('Failed to check for updates', 'error');
        }
    }

    updateRepoStatus(repoId, status) {
        const repo = this.repos.find(r => r.id === repoId);
        if (repo) {
            repo.status = status;
            this.renderRepos();
        }
    }
    
    disableActionButton(repoId) {
        const repo = this.repos.find(r => r.id === repoId);
        if (repo) {
            repo.status = 'loading';
        }
        this.renderRepos();
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
                const response = await axios.post('/api/repos/create-from-compose', this.addAuthToRequest({ yaml: yamlContent }));
                if (response.data.success) {
                    this.showNotification(`Application '${response.data.repo.name}' created successfully.`, 'success');
                    await this.loadRepos();
                } else {
                    throw new Error(response.data.message);
                }
            } else if (this.currentEditingRepo) {
                // This is an existing repo
                await axios.put(`/api/repos/${this.currentEditingRepo}/compose`, this.addAuthToRequest({ yaml: yamlContent }));
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
            const eventSource = new EventSource(`/api/repos/${repoId}/logs?hash=${this.authHash}`);
            
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
            const response = await axios.get(`/api/repos/${repoId}/compose`, this.addAuthToRequest({}));
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

                        <div class="consent-section">
                            <label class="consent-checkbox">
                                <input type="checkbox" id="understand-risks">
                                <span class="checkmark"></span>
                                I understand the risks and have reviewed the command above. I trust the developer of this application.
                            </label>
                        </div>
                    </div>
                    <div class="warning-actions">
                        <button class="btn btn-secondary" id="cancel-install">Cancel</button>
                        <button class="btn btn-danger" id="proceed-install" disabled>Install Anyway</button>
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
                    height: 120px;
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
                    margin: 20px 0;
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
                    gap: 12px;
                    justify-content: flex-end;
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
                        <p><strong>Are you sure you want to remove "${repo.name}"?</strong></p>
                        
                        ${repo.isInstalled ? 
                            `<div class="uninstall-notice">
                                <p><i class="fas fa-info-circle"></i> This will uninstall the app from CasaOS and remove the repository.</p>
                            </div>` : 
                            `<div class="uninstall-notice">
                                <p><i class="fas fa-info-circle"></i> This will remove the repository and associated configuration files.</p>
                            </div>`
                        }

                        <div class="data-preservation">
                            <h3>Application Data</h3>
                            <div class="data-option">
                                <label class="data-checkbox">
                                    <input type="checkbox" id="preserve-app-data" ${!repo.isInstalled ? 'disabled' : ''}>
                                    <span class="data-checkmark"></span>
                                    <div class="data-content">
                                        <strong>Delete application data and configuration files</strong>
                                        <div class="data-description">
                                            ${repo.isInstalled ? 
                                                'Remove all files in /DATA/AppData/' + repo.name + '/ permanently. Leave unchecked to keep your data.' : 
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

            // Add styles
            const style = document.createElement('style');
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
                // Invert logic: unchecked = preserve (safer default), checked = delete
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
            user: 'ubuntu'
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
                    <div class="terminal-content" id="terminal-output">
                        <div class="log-line system">🖥️ Interactive Terminal Ready</div>
                    </div>
                </div>
                <div class="terminal-input-section">
                    <div class="terminal-prompt">
                        <span id="terminal-prompt-text">ubuntu@casaos:/$</span>
                        <input type="text" id="terminal-command-input" placeholder="Enter command..." autocomplete="off">
                        <button id="terminal-execute-btn" class="terminal-btn">
                            <i class="fas fa-play"></i>
                        </button>
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
                flex-direction: column;
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
        `;

        if (!document.getElementById('interactive-terminal-styles')) {
            style.id = 'interactive-terminal-styles';
            document.head.appendChild(style);
        }

        document.body.appendChild(terminal);

        // Set up event handlers
        this.setupInteractiveTerminalHandlers();
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
        commandInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                executeCommand();
            }
        });

        // Focus command input
        commandInput.focus();
        
        // Initialize prompt
        this.updateTerminalPrompt();
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
    }

    async executeTerminalCommand(command, runAsUser) {
        const output = document.getElementById('terminal-output');
        const promptText = document.getElementById('terminal-prompt-text').textContent;
        
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
            const response = await axios.post('/api/terminal/execute', this.addAuthToRequest({
                command: command,
                runAsUser: runAsUser,
                currentDir: this.terminalSession.currentDir,
                envVars: this.terminalSession.envVars
            }));

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
                    this.terminalSession.currentDir = response.data.newDir;
                    this.updateTerminalPrompt();
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
    } catch (error) {
        console.error('❌ Failed to initialize RepoManager:', error);
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeApp);
} else {
    initializeApp();
}