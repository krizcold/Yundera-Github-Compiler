// Repository Management System
class RepoManager {
    constructor() {
        this.repos = [];
        this.currentEditingRepo = null;
        this.globalAutoUpdate = true;
        this.init();
    }

    init() {
        this.bindEvents();
        this.loadRepos();
        this.loadGlobalSettings();
    }

    bindEvents() {
        // Add repository button
        document.getElementById('add-repo-btn').addEventListener('click', () => {
            this.addNewRepo();
        });

        // Check updates button
        document.getElementById('check-updates-btn').addEventListener('click', () => {
            this.checkAllUpdates();
        });

        // Global auto-update toggle
        document.getElementById('global-auto-update').addEventListener('click', (e) => {
            this.toggleGlobalAutoUpdate();
        });

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
            this.renderRepos();
        } catch (error) {
            console.error('Failed to load repositories:', error);
            // Show default empty repo on error
            this.renderRepos();
        }
    }

    async loadGlobalSettings() {
        try {
            const response = await axios.get('/api/settings');
            this.globalAutoUpdate = response.data.globalAutoUpdate || false;
            this.updateGlobalAutoUpdateUI();
        } catch (error) {
            console.error('Failed to load global settings:', error);
        }
    }

    renderRepos() {
        const repoList = document.getElementById('repo-list');
        repoList.innerHTML = '';

        // Always show at least one repo row (empty or first repo)
        if (this.repos.length === 0) {
            repoList.appendChild(this.createRepoElement(null, 0));
        } else {
            this.repos.forEach((repo, index) => {
                repoList.appendChild(this.createRepoElement(repo, index));
            });
        }
    }

    createRepoElement(repo, index) {
        const isDefault = repo === null;
        const repoId = isDefault ? 'default' : repo.id || `repo-${index}`;
        
        const div = document.createElement('div');
        div.className = 'repo-item';
        div.setAttribute('data-repo-id', repoId);

        const repoName = repo ? this.extractRepoName(repo.url) : 'New Repository';
        const repoUrl = repo ? repo.url : '';
        const status = repo ? repo.status || 'idle' : 'idle';
        const currentVersion = repo ? repo.currentVersion || '--' : '--';
        const latestVersion = repo ? repo.latestVersion || '--' : '--';
        const lastUpdated = repo ? this.formatDate(repo.lastUpdated) : 'Never';
        const autoUpdate = repo ? repo.autoUpdate : true;
        const hasCompose = repo && repo.hasCompose;

        div.innerHTML = `
            <div class="repo-icon">
                ${repo && repo.icon ? `<img src="${repo.icon}" alt="${repoName}">` : '<i class="fab fa-github"></i>'}
            </div>
            <div class="repo-info">
                <div class="repo-details">
                    <h3>${repoName}</h3>
                    <div class="repo-url">
                        <input type="text" placeholder="https://github.com/username/repository.git" value="${repoUrl}">
                        <button class="btn btn-small btn-secondary" title="Expand URL" onclick="repoManager.expandUrl('${repoId}')">
                            <i class="fas fa-search"></i>
                        </button>
                    </div>
                </div>
                <div class="version-info">
                    <div class="version-badge version-current">Current: ${currentVersion}</div>
                    <div class="version-badge version-latest">Latest: ${latestVersion}</div>
                </div>
                <div class="status-info">
                    <div><span class="status-indicator status-${status}"></span>Status: ${this.capitalizeFirst(status)}</div>
                    <div>Last Updated: ${lastUpdated}</div>
                </div>
                <div class="toggle-switch">
                    <span style="font-size: 12px;">Auto:</span>
                    <div class="switch ${autoUpdate ? 'active' : ''}" onclick="repoManager.toggleRepoAutoUpdate('${repoId}')">
                        <div class="switch-slider"></div>
                    </div>
                </div>
            </div>
            <div class="repo-actions">
                <button class="btn btn-small ${repo && repo.isInstalled ? 'btn-warning' : 'btn-success'}" 
                        title="${repo && repo.isInstalled ? 'Update' : 'Compile/Build'}" 
                        onclick="repoManager.compileRepo('${repoId}')"
                        ${isDefault || !repoUrl ? 'disabled' : ''}>
                    <i class="fas ${repo && repo.isInstalled ? 'fa-sync-alt' : 'fa-hammer'}"></i>
                </button>
                <button class="btn btn-small btn-secondary" 
                        title="View Docker Compose" 
                        onclick="repoManager.viewCompose('${repoId}')"
                        ${isDefault || !hasCompose ? 'disabled' : ''}>
                    <i class="fas fa-file-code"></i>
                </button>
                <button class="btn btn-small btn-warning" 
                        title="Remove Repository" 
                        onclick="repoManager.removeRepo('${repoId}')"
                        style="${isDefault ? 'display: none;' : ''}">
                    <i class="fas fa-trash"></i>
                </button>
            </div>
        `;

        // Bind URL input change event
        const urlInput = div.querySelector('.repo-url input');
        urlInput.addEventListener('change', (e) => {
            this.updateRepoUrl(repoId, e.target.value);
        });

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

    addNewRepo() {
        const newRepo = {
            id: `repo-${Date.now()}`,
            url: '',
            autoUpdate: true,
            status: 'idle',
            currentVersion: '--',
            latestVersion: '--',
            lastUpdated: null,
            hasCompose: false,
            isInstalled: false
        };
        
        this.repos.push(newRepo);
        this.renderRepos();
    }

    async updateRepoUrl(repoId, url) {
        try {
            const response = await axios.put(`/api/repos/${repoId}`, { url });
            
            // Update local repo data
            const repo = this.repos.find(r => r.id === repoId);
            if (repo) {
                repo.url = url;
                repo.status = 'idle';
                this.renderRepos();
            }
            
            // If this is the default repo and now has a URL, convert it to a real repo
            if (repoId === 'default' && url) {
                await this.loadRepos(); // Reload to get the new repo with proper ID
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
            await axios.put(`/api/repos/${repoId}`, { autoUpdate: newAutoUpdate });
            
            repo.autoUpdate = newAutoUpdate;
            this.renderRepos();
        } catch (error) {
            console.error('Failed to toggle auto-update:', error);
            this.showNotification('Failed to update auto-update setting', 'error');
        }
    }

    async toggleGlobalAutoUpdate() {
        try {
            this.globalAutoUpdate = !this.globalAutoUpdate;
            await axios.put('/api/settings', { globalAutoUpdate: this.globalAutoUpdate });
            this.updateGlobalAutoUpdateUI();
            this.showNotification(`Global auto-update ${this.globalAutoUpdate ? 'enabled' : 'disabled'}`, 'success');
        } catch (error) {
            console.error('Failed to toggle global auto-update:', error);
            this.showNotification('Failed to update global auto-update setting', 'error');
        }
    }

    updateGlobalAutoUpdateUI() {
        const toggle = document.getElementById('global-auto-update');
        if (this.globalAutoUpdate) {
            toggle.classList.add('active');
        } else {
            toggle.classList.remove('active');
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
            const statusText = repoElement.querySelector('.status-info div:first-child');
            
            statusIndicator.className = `status-indicator status-${status}`;
            statusText.innerHTML = `<span class="status-indicator status-${status}"></span>Status: ${this.capitalizeFirst(status)}`;
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
document.addEventListener('DOMContentLoaded', () => {
    repoManager = new RepoManager();
});