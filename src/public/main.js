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

        const action = repo.type === 'github' ? 'building' : 'installing';
        this.updateRepoStatus(repoId, action); // This will re-render and disable the button
        

        try {
            await axios.post(`/api/repos/${repoId}/compile`, this.addAuthToRequest({}));
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
        if (confirm('Are you sure you want to remove this repository? This will also uninstall the app if it is installed.')) {
            try {
                const url = this.authHash ? `/api/repos/${repoId}?hash=${this.authHash}` : `/api/repos/${repoId}`;
                await axios.delete(url);
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