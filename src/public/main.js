// Repository Management System
class RepoManager {
    constructor() {
        this.repos = [];
        this.currentEditingRepo = null;
        this.globalSettings = {
            globalApiUpdatesEnabled: true,
            defaultAutoUpdateInterval: 60,
            maxConcurrentBuilds: 2
        };
        this.init();
    }

    init() {
        this.bindEvents();
        this.loadRepos();
        this.loadGlobalSettings();
    }

    bindEvents() {
        console.log('🔧 Binding events...');
        
        // Check updates button
        const checkUpdatesBtn = document.getElementById('check-updates-btn');
        console.log('checkUpdatesBtn:', checkUpdatesBtn);
        if (checkUpdatesBtn) {
            checkUpdatesBtn.addEventListener('click', () => {
                this.checkAllUpdates();
            });
        }

        // Global settings button
        const settingsBtn = document.getElementById('settings-btn');
        console.log('settingsBtn:', settingsBtn);
        if (settingsBtn) {
            settingsBtn.addEventListener('click', () => {
                this.openSettingsModal();
            });
        }
        
        // Save settings button
        const saveSettingsBtn = document.getElementById('save-settings-btn');
        console.log('saveSettingsBtn:', saveSettingsBtn);
        if (saveSettingsBtn) {
            saveSettingsBtn.addEventListener('click', () => {
                this.saveGlobalSettings();
            });
        }
        
        console.log('✅ Events bound successfully');

        // Modal close on background click
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
            const response = await axios.get('/api/repos');
            this.repos = response.data.repos || [];
            
            // Show one empty repository by default if no repositories exist
            if (this.repos.length === 0) {
                this.repos = [{
                    id: 'empty',
                    name: '',
                    url: '',
                    autoUpdate: false,
                    autoUpdateInterval: this.globalSettings.defaultAutoUpdateInterval,
                    apiUpdatesEnabled: true,
                    status: 'idle',
                    isEmpty: true
                }];
            }
            
            this.renderRepos();
        } catch (error) {
            console.error('Failed to load repositories:', error);
            // Show default empty repo on error
            this.repos = [{
                id: 'empty',
                name: '',
                url: '',
                autoUpdate: false,
                autoUpdateInterval: this.globalSettings.defaultAutoUpdateInterval,
                apiUpdatesEnabled: true,
                status: 'idle',
                isEmpty: true
            }];
            this.renderRepos();
        }
    }

    async loadGlobalSettings() {
        try {
            const response = await axios.get('/api/settings');
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
        if (!repoList) {
            console.error('repo-list element not found');
            return;
        }
        
        repoList.innerHTML = '';

        // Show repositories or default empty repository
        if (this.repos.length === 0) {
            // Create default empty repository for display
            const emptyRepo = {
                id: 'empty',
                name: '',
                url: '',
                autoUpdate: false,
                autoUpdateInterval: this.globalSettings.defaultAutoUpdateInterval,
                apiUpdatesEnabled: true,
                status: 'idle',
                isEmpty: true
            };
            repoList.appendChild(this.createRepoElement(emptyRepo, 0));
        } else {
            this.repos.forEach((repo, index) => {
                repoList.appendChild(this.createRepoElement(repo, index));
            });
        }
    }

    createRepoElement(repo, index) {
        const isEmpty = repo && repo.isEmpty;
        const repoId = isEmpty ? 'empty' : (repo.id || `repo-${index}`);
        
        const div = document.createElement('div');
        div.className = 'repo-item';
        div.setAttribute('data-repo-id', repoId);

        const repoName = repo && repo.name ? repo.name : (repo && repo.url ? this.extractRepoName(repo.url) : '');
        const repoUrl = repo ? repo.url : '';
        const status = repo ? repo.status || 'idle' : 'idle';
        const autoUpdate = repo ? repo.autoUpdate || false : false;
        const isInstalled = repo ? repo.isInstalled || false : false;

        // Full repository UI (like original but improved)
        const lastBuildTime = repo ? repo.lastBuildTime : null;
        const lastUpdated = lastBuildTime ? this.formatDate(lastBuildTime) : 'Never';
        const hasCompose = repo && (repo.hasCompose || status === 'success');

        div.innerHTML = `
            <div class="repo-icon">
                ${repo && repo.icon ? `<img src="${repo.icon}" alt="${repoName}">` : '<i class="fab fa-github"></i>'}
            </div>
            <div class="repo-info">
                <div class="repo-details">
                    <h3>${repoName || 'New Repository'}</h3>
                    <div class="repo-url">
                        <input type="text" 
                               placeholder="https://github.com/username/repository.git" 
                               value="${repoUrl}"
                               onblur="repoManager.handleUrlChange('${repoId}', this.value)">
                        <button class="btn btn-small btn-secondary" title="Expand URL" onclick="repoManager.expandUrl('${repoId}')">
                            <i class="fas fa-search"></i>
                        </button>
                    </div>
                </div>
                <div class="repo-settings">
                    <div class="setting-row">
                        <label>Auto-Update:</label>
                        <div class="switch ${autoUpdate ? 'active' : ''}" onclick="repoManager.toggleRepoAutoUpdate('${repoId}')">
                            <div class="switch-slider"></div>
                        </div>
                    </div>
                    <div class="setting-row">
                        <label>Interval (min):</label>
                        <input type="number" min="5" max="10080" value="${repo ? repo.autoUpdateInterval || 60 : 60}" 
                               onchange="repoManager.updateRepoInterval('${repoId}', this.value)" 
                               ${!autoUpdate ? 'disabled' : ''}>
                    </div>
                    <div class="setting-row">
                        <label>API Updates:</label>
                        <div class="switch ${repo && repo.apiUpdatesEnabled !== false ? 'active' : ''}" onclick="repoManager.toggleRepoApiUpdates('${repoId}')">
                            <div class="switch-slider"></div>
                        </div>
                    </div>
                </div>
                <div class="status-info">
                    <div><span class="status-indicator status-${status}"></span>Status: ${this.capitalizeFirst(status)}</div>
                    <div><span class="install-indicator ${isInstalled ? 'installed' : 'not-installed'}"></span>Installed: ${isInstalled ? 'Yes' : 'No'}</div>
                    <div>Last Build: ${lastUpdated}</div>
                </div>
            </div>
            <div class="repo-actions">
                <button class="btn btn-small ${repo && repo.isInstalled ? 'btn-warning' : 'btn-success'}" 
                        title="${repo && repo.isInstalled ? 'Update' : 'Compile/Build'}" 
                        onclick="repoManager.compileRepo('${repoId}')"
                        ${isEmpty || !repoUrl ? 'disabled' : ''}>
                    <i class="fas ${repo && repo.isInstalled ? 'fa-sync-alt' : 'fa-hammer'}"></i>
                </button>
                <button class="btn btn-small btn-secondary" 
                        title="View Docker Compose" 
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
        if (!url) return 'New Repository';
        const parts = url.replace(/\.git$/, '').split('/');
        return parts[parts.length - 1] || 'Repository';
    }

    formatDate(dateString) {
        if (!dateString) return 'Never';
        return new Date(dateString).toLocaleString();
    }

    capitalizeFirst(str) {
        return str.charAt(0).toUpperCase() + str.slice(1);
    }

    async handleUrlChange(repoId, url) {
        if (!url.trim()) return;
        
        if (repoId === 'empty') {
            // Create new repository
            await this.createNewRepo(url);
        } else {
            // Update existing repository URL
            await this.updateRepoUrl(repoId, url);
        }
    }
    
    async createNewRepo(url) {
        const repoName = this.extractRepoName(url);
        
        try {
            const response = await axios.post('/api/repos', {
                name: repoName,
                url: url,
                autoUpdate: false,
                autoUpdateInterval: this.globalSettings.defaultAutoUpdateInterval,
                apiUpdatesEnabled: true
            });
            
            if (response.data.success) {
                this.showNotification(`Repository "${repoName}" added successfully!`, 'success');
                await this.loadRepos();
            } else {
                this.showNotification('Failed to add repository: ' + response.data.message, 'error');
            }
        } catch (error) {
            console.error('Failed to add repository:', error);
            this.showNotification('Failed to add repository: ' + error.message, 'error');
        }
    }
    
    showRepoSettings(repoId) {
        const repo = this.repos.find(r => r.id === repoId);
        if (!repo) return;
        
        // For now, show settings in a simple alert (we can make this a modal later)
        const settings = [
            `Repository: ${repo.name}`,
            `URL: ${repo.url}`,
            `Auto-Update: ${repo.autoUpdate ? 'Enabled' : 'Disabled'}`,
            `Update Interval: ${repo.autoUpdateInterval} minutes`,
            `API Updates: ${repo.apiUpdatesEnabled ? 'Enabled' : 'Disabled'}`,
            `Status: ${repo.status}`,
            `Installed: ${repo.isInstalled ? 'Yes' : 'No'}`
        ];
        
        alert(settings.join('\n'));
    }
    
    // Legacy method - now simplified
    async addNewRepo() {
        // This method is no longer used but kept for compatibility
        const repoUrl = prompt('Enter repository URL:');
        
        if (!repoUrl) {
            this.showNotification('Repository URL is required', 'error');
            return;
        }
        
        await this.createNewRepo(repoUrl);
    }

    async updateRepoUrl(repoId, url) {
        try {
            const response = await axios.put(`/api/repos/${repoId}`, { url });
            
            if (response.data.success) {
                await this.loadRepos(); // Reload to get updated data
                this.showNotification('Repository URL updated successfully', 'success');
            } else {
                this.showNotification('Failed to update repository URL: ' + response.data.message, 'error');
            }
        } catch (error) {
            console.error('Failed to update repository URL:', error);
            this.showNotification('Failed to update repository URL', 'error');
        }
    }

    async compileRepo(repoId) {
        try {
            const repo = this.repos.find(r => r.id === repoId);
            if (!repo || !repo.url) return;

            this.updateRepoStatus(repoId, 'building');
            
            const response = await axios.post(`/api/repos/${repoId}/compile`);
            
            if (response.data.success) {
                this.updateRepoStatus(repoId, 'success');
                this.showNotification('Repository compiled successfully!', 'success');
                setTimeout(() => this.loadRepos(), 2000); // Reload after 2 seconds
            } else {
                this.updateRepoStatus(repoId, 'error');
                this.showNotification('Compilation failed: ' + response.data.message, 'error');
            }
        } catch (error) {
            this.updateRepoStatus(repoId, 'error');
            this.showNotification('Compilation failed: ' + error.message, 'error');
        }
    }

    async viewCompose(repoId) {
        try {
            const response = await axios.get(`/api/repos/${repoId}/compose`);
            
            this.currentEditingRepo = repoId;
            document.getElementById('yaml-textarea').value = response.data.yaml || '';
            this.openModal('yaml-modal');
        } catch (error) {
            console.error('Failed to load compose file:', error);
            this.showNotification('Failed to load Docker Compose file', 'error');
        }
    }

    async removeRepo(repoId) {
        if (confirm('Are you sure you want to remove this repository?')) {
            try {
                await axios.delete(`/api/repos/${repoId}`);
                this.repos = this.repos.filter(r => r.id !== repoId);
                this.renderRepos();
                this.showNotification('Repository removed successfully', 'success');
            } catch (error) {
                console.error('Failed to remove repository:', error);
                this.showNotification('Failed to remove repository', 'error');
            }
        }
    }

    async toggleRepoAutoUpdate(repoId) {
        try {
            const repo = this.repos.find(r => r.id === repoId);
            if (!repo) return;

            const newAutoUpdate = !repo.autoUpdate;
            const response = await axios.put(`/api/repos/${repoId}`, { autoUpdate: newAutoUpdate });
            
            if (response.data.success) {
                await this.loadRepos(); // Reload to get updated data
                this.showNotification(`Auto-update ${newAutoUpdate ? 'enabled' : 'disabled'} for ${repo.name || 'repository'}`, 'success');
            } else {
                this.showNotification('Failed to update auto-update setting: ' + response.data.message, 'error');
            }
        } catch (error) {
            console.error('Failed to toggle auto-update:', error);
            this.showNotification('Failed to update auto-update setting', 'error');
        }
    }
    
    async updateRepoInterval(repoId, interval) {
        try {
            const intervalNum = parseInt(interval);
            if (intervalNum < 5 || intervalNum > 10080) {
                this.showNotification('Interval must be between 5 minutes and 1 week', 'error');
                return;
            }
            
            const response = await axios.put(`/api/repos/${repoId}`, { autoUpdateInterval: intervalNum });
            
            if (response.data.success) {
                await this.loadRepos();
                this.showNotification(`Update interval set to ${intervalNum} minutes`, 'success');
            } else {
                this.showNotification('Failed to update interval: ' + response.data.message, 'error');
            }
        } catch (error) {
            console.error('Failed to update interval:', error);
            this.showNotification('Failed to update interval', 'error');
        }
    }
    
    async toggleRepoApiUpdates(repoId) {
        try {
            const repo = this.repos.find(r => r.id === repoId);
            if (!repo) return;

            const newApiUpdatesEnabled = !repo.apiUpdatesEnabled;
            const response = await axios.put(`/api/repos/${repoId}`, { apiUpdatesEnabled: newApiUpdatesEnabled });
            
            if (response.data.success) {
                await this.loadRepos();
                this.showNotification(`API updates ${newApiUpdatesEnabled ? 'enabled' : 'disabled'} for ${repo.name || 'repository'}`, 'success');
            } else {
                this.showNotification('Failed to update API updates setting: ' + response.data.message, 'error');
            }
        } catch (error) {
            console.error('Failed to toggle API updates:', error);
            this.showNotification('Failed to update API updates setting', 'error');
        }
    }

    openSettingsModal() {
        // Populate settings form
        document.getElementById('global-api-updates').checked = this.globalSettings.globalApiUpdatesEnabled;
        document.getElementById('default-interval').value = this.globalSettings.defaultAutoUpdateInterval;
        document.getElementById('max-builds').value = this.globalSettings.maxConcurrentBuilds;
        
        this.openModal('settings-modal');
    }
    
    async saveGlobalSettings() {
        try {
            const newSettings = {
                globalApiUpdatesEnabled: document.getElementById('global-api-updates').checked,
                defaultAutoUpdateInterval: parseInt(document.getElementById('default-interval').value),
                maxConcurrentBuilds: parseInt(document.getElementById('max-builds').value)
            };
            
            const response = await axios.put('/api/settings', newSettings);
            
            if (response.data.success) {
                this.globalSettings = newSettings;
                this.updateSettingsUI();
                this.closeModal('settings-modal');
                this.showNotification('Settings saved successfully', 'success');
            } else {
                this.showNotification('Failed to save settings: ' + response.data.message, 'error');
            }
        } catch (error) {
            console.error('Failed to save settings:', error);
            this.showNotification('Failed to save settings', 'error');
        }
    }
    
    updateSettingsUI() {
        // Update any UI elements that reflect global settings
        const apiStatus = document.getElementById('api-status');
        if (apiStatus) {
            apiStatus.textContent = this.globalSettings.globalApiUpdatesEnabled ? 'Enabled' : 'Disabled';
            apiStatus.className = this.globalSettings.globalApiUpdatesEnabled ? 'status-enabled' : 'status-disabled';
        }
    }

    async checkAllUpdates() {
        try {
            this.showNotification('Checking for updates...', 'info');
            const response = await axios.post('/api/repos/check-updates');
            
            if (response.data.success) {
                this.loadRepos(); // Reload to get updated version info
                this.showNotification('Update check completed', 'success');
            }
        } catch (error) {
            console.error('Failed to check updates:', error);
            this.showNotification('Failed to check for updates', 'error');
        }
    }

    updateRepoStatus(repoId, status) {
        const repoElement = document.querySelector(`[data-repo-id="${repoId}"]`);
        if (repoElement) {
            const statusIndicator = repoElement.querySelector('.status-indicator');
            const statusText = repoElement.querySelector('.repo-status');
            
            if (statusIndicator) {
                statusIndicator.className = `status-indicator status-${status}`;
            }
            
            if (statusText) {
                statusText.innerHTML = `<span class="status-indicator status-${status}"></span>${this.capitalizeFirst(status)}`;
            }
        }
    }

    expandUrl(repoId) {
        const repo = this.repos.find(r => r.id === repoId);
        const currentUrl = repo ? repo.url : '';
        
        this.currentEditingRepo = repoId;
        document.getElementById('url-preview').textContent = currentUrl || 'No URL set';
        document.getElementById('url-textarea').value = currentUrl;
        this.openModal('url-modal');
    }

    openModal(modalId) {
        document.getElementById(modalId).style.display = 'block';
    }

    closeModal(modalId) {
        document.getElementById(modalId).style.display = 'none';
        this.currentEditingRepo = null;
    }

    async saveUrl() {
        const newUrl = document.getElementById('url-textarea').value.trim();
        
        if (this.currentEditingRepo) {
            await this.updateRepoUrl(this.currentEditingRepo, newUrl);
        }
        
        this.closeModal('url-modal');
    }

    async saveYaml() {
        try {
            const yamlContent = document.getElementById('yaml-textarea').value;
            
            if (this.currentEditingRepo) {
                await axios.put(`/api/repos/${this.currentEditingRepo}/compose`, { yaml: yamlContent });
                this.showNotification('Docker Compose file saved successfully', 'success');
            }
        } catch (error) {
            console.error('Failed to save compose file:', error);
            this.showNotification('Failed to save Docker Compose file', 'error');
        }
        
        this.closeModal('yaml-modal');
    }

    showNotification(message, type = 'info') {
        // Create notification element
        const notification = document.createElement('div');
        notification.className = `notification notification-${type}`;
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            padding: 15px 20px;
            border-radius: 8px;
            color: white;
            font-weight: 500;
            z-index: 10000;
            max-width: 400px;
            opacity: 0;
            transform: translateX(100%);
            transition: all 0.3s ease;
        `;

        // Set background color based on type
        const colors = {
            success: '#059669',
            error: '#dc2626',
            warning: '#d97706',
            info: '#2563eb'
        };
        notification.style.backgroundColor = colors[type] || colors.info;
        
        notification.textContent = message;
        
        // Add to page
        document.body.appendChild(notification);
        
        // Animate in
        setTimeout(() => {
            notification.style.opacity = '1';
            notification.style.transform = 'translateX(0)';
        }, 100);
        
        // Remove after 5 seconds
        setTimeout(() => {
            notification.style.opacity = '0';
            notification.style.transform = 'translateX(100%)';
            setTimeout(() => {
                if (notification.parentNode) {
                    notification.parentNode.removeChild(notification);
                }
            }, 300);
        }, 5000);
    }
}

// Global functions for modal management
function closeModal(modalId) {
    repoManager.closeModal(modalId);
}

function saveUrl() {
    repoManager.saveUrl();
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

// Try multiple initialization methods
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeApp);
} else {
    initializeApp();
}