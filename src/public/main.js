// Repository Management System
class RepoManager {
    constructor() {
        this.repos = [];
        this.currentEditingRepo = null;
        this.pendingRepoUrl = ''; // Store URL for empty repositories before import
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
    
    async syncAndReload() {
        try {
            // The backend /api/repos endpoint automatically syncs with CasaOS before returning
            // But we can add a small delay to ensure CasaOS has processed the installation
            await new Promise(resolve => setTimeout(resolve, 2000)); // 2 second delay
            await this.loadRepos();
        } catch (error) {
            console.error('Failed to sync and reload:', error);
            await this.loadRepos(); // Try loading anyway
        }
    }

    async waitForInstallationConfirmation(repoId, maxAttempts = 15) {
        let attempts = 0;
        while (attempts < maxAttempts) {
            attempts++;
            
            // Wait 2 seconds between checks
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            // Reload repositories
            await this.loadRepos();
            
            // Check if installation is confirmed
            const updatedRepo = this.repos.find(r => r.id === repoId);
            if (updatedRepo && updatedRepo.isInstalled) {
                this.showNotification(`${updatedRepo.name} installed successfully!`, 'success');
                return;
            }
            
            console.log(`Waiting for installation confirmation... (${attempts}/${maxAttempts})`);
        }
        
        // If we reach here, installation confirmation timed out
        this.showNotification('Installation completed but confirmation timed out. Check CasaOS dashboard.', 'warning');
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
        // For empty repo, use pendingRepoUrl instead of repo.url to preserve user input
        const repoUrl = (repoId === 'empty' && this.pendingRepoUrl) ? this.pendingRepoUrl : (repo ? repo.url : '');
        const status = repo ? repo.status || 'idle' : 'idle';
        const autoUpdate = repo ? repo.autoUpdate || false : false;
        const isInstalled = repo ? repo.isInstalled || false : false;
        const installationStatus = this.getInstallationStatus(repo);

        // Full repository UI (like original but improved)
        const lastBuildTime = repo ? repo.lastBuildTime : null;
        const lastUpdated = lastBuildTime ? this.formatDate(lastBuildTime) : 'Never';
        // Docker compose button should be enabled after importing (when we have the compose file)
        const hasCompose = repo && (status === 'imported' || status === 'building' || status === 'success' || status === 'error');

        div.innerHTML = `
            <div class="repo-icon-section">
                <div class="repo-icon">
                    ${this.getRepoIcon(repo)}
                </div>
                ${this.renderAppToggle(repo, repoId, isInstalled)}
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
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <span class="installation-badge installation-${installationStatus.status}">
                            ${installationStatus.label}
                        </span>
                        ${repo && repo.installMismatch ? '<span class="warning-triangle" title="App is listed as installed but not found in CasaOS. It may have been removed manually."><i class="fas fa-exclamation-triangle"></i></span>' : ''}
                    </div>
                    <div>Last Build: ${lastUpdated}</div>
                </div>
            </div>
            <div class="repo-actions">
                ${this.renderActionButton(repo, repoId, isEmpty, repoUrl)}
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
    
    normalizeGitUrl(url) {
        if (!url || !url.trim()) return null;
        
        url = url.trim();
        console.log(`🔍 Normalizing URL: "${url}"`);
        
        // Handle different GitHub URL formats
        if (url.includes('github.com')) {
            // Convert ZIP download URLs to git URLs
            if (url.includes('/archive/')) {
                // https://github.com/user/repo/archive/refs/heads/main.zip -> https://github.com/user/repo.git
                const match = url.match(/github\.com\/([^\/]+)\/([^\/]+)\/archive/);
                if (match) {
                    const normalized = `https://github.com/${match[1]}/${match[2]}.git`;
                    console.log(`🔄 Converted ZIP URL to: ${normalized}`);
                    return normalized;
                }
            }
            
            // Convert regular GitHub URLs to git URLs (only if not already .git)
            if (url.match(/github\.com\/[^\/]+\/[^\/]+\/?$/) && !url.endsWith('.git')) {
                const normalized = url.replace(/\/$/, '') + '.git';
                console.log(`🔄 Added .git to GitHub URL: ${normalized}`);
                return normalized;
            }
            
            // If it's already a .git URL, return as-is
            if (url.endsWith('.git')) {
                console.log(`✅ GitHub .git URL is valid: ${url}`);
                return url;
            }
        }
        
        // For any HTTPS git URLs, return as-is (be more permissive)
        if (url.startsWith('https://') && url.endsWith('.git')) {
            console.log(`✅ HTTPS .git URL is valid: ${url}`);
            return url;
        }
        
        // For any git URLs, return as-is (be more permissive)
        if (url.startsWith('git@') || url.startsWith('ssh://')) {
            console.log(`✅ SSH git URL is valid: ${url}`);
            return url;
        }
        
        console.log(`❌ URL format not recognized: ${url}`);
        return null; // Invalid URL
    }

    formatDate(dateString) {
        if (!dateString) return 'Never';
        return new Date(dateString).toLocaleString();
    }

    capitalizeFirst(str) {
        return str.charAt(0).toUpperCase() + str.slice(1);
    }

    getInstallationStatus(repo) {
        if (!repo) {
            return { status: 'uninstalled', label: 'Uninstalled' };
        }

        const status = repo.status;
        const isInstalled = repo.isInstalled;

        // Determine installation status based on repository state
        if (status === 'idle' || status === 'empty') {
            return { status: 'uninstalled', label: 'Uninstalled' };
        } else if (status === 'importing' || status === 'imported') {
            return { status: 'imported', label: 'Imported' };
        } else if (status === 'success' && isInstalled) {
            return { status: 'installed', label: 'Installed' };
        } else if (status === 'building') {
            return { status: 'imported', label: 'Building...' };
        } else if (status === 'error') {
            return { status: 'imported', label: 'Build Error' };
        } else if (status === 'uninstalling') {
            return { status: 'imported', label: 'Uninstalling...' };
        } else if (status === 'starting') {
            return { status: 'installed', label: 'Starting...' };
        } else if (status === 'stopping') {
            return { status: 'installed', label: 'Stopping...' };
        } else {
            return { status: 'uninstalled', label: 'Uninstalled' };
        }
    }

    getRepoIcon(repo) {
        if (repo && repo.icon) {
            return `<img src="${repo.icon}" alt="${repo.name}">`;
        }
        return '<i class="fab fa-github"></i>';
    }

    renderAppToggle(repo, repoId, isInstalled) {
        const isRunning = repo && repo.isRunning ? true : false;
        const isInTransition = repo && (repo.status === 'starting' || repo.status === 'stopping');
        const isDisabled = !isInstalled || !repo || repoId === 'empty' || isInTransition;
        
        let toggleClass = 'app-toggle';
        let label = 'OFF';
        
        if (isInTransition) {
            toggleClass += ' disabled';
            label = repo.status === 'starting' ? 'STARTING' : 'STOPPING';
        } else if (isDisabled) {
            toggleClass += ' disabled';
            label = 'OFF';
        } else if (isRunning) {
            toggleClass += ' running';
            label = 'ON';
        }
        
        const clickHandler = isDisabled ? '' : `onclick="repoManager.toggleApp('${repoId}')"`;
        let title = 'App must be installed first';
        if (isInTransition) {
            title = `App is ${repo.status}...`;
        } else if (!isDisabled) {
            title = isRunning ? 'Click to stop app' : 'Click to start app';
        }

        return `
            <div style="display: flex; flex-direction: column; align-items: center;">
                <div class="${toggleClass}" 
                     ${clickHandler}
                     title="${title}"
                     id="app-toggle-${repoId}">
                    <div class="app-toggle-slider"></div>
                </div>
                <div class="app-toggle-label">${label}</div>
            </div>
        `;
    }

    renderActionButton(repo, repoId, isEmpty, repoUrl) {
        // For empty repositories, check pending URL
        if (repoId === 'empty') {
            const hasPendingUrl = this.pendingRepoUrl && this.pendingRepoUrl.trim();
            if (hasPendingUrl) {
                // Empty repository with pending URL - Import button (enabled)
                return `<button class="btn btn-small btn-primary" 
                                title="Import Repository" 
                                onclick="repoManager.importRepo('${repoId}')">
                            <i class="fas fa-download"></i>
                        </button>`;
            } else {
                // Empty repository without URL - Import button (disabled)
                return `<button class="btn btn-small btn-primary" 
                                title="Import Repository (Enter URL first)" 
                                disabled>
                            <i class="fas fa-download"></i>
                        </button>`;
            }
        }

        // Determine the current state and render appropriate button
        if (isEmpty || !repoUrl) {
            // Empty repository - Import button (disabled)
            return `<button class="btn btn-small btn-primary" 
                            title="Import Repository (Enter URL first)" 
                            disabled>
                        <i class="fas fa-download"></i>
                    </button>`;
        }

        if (!repo) {
            // New repository with URL - Import button (enabled)
            return `<button class="btn btn-small btn-primary" 
                            title="Import Repository" 
                            onclick="repoManager.importRepo('${repoId}')">
                        <i class="fas fa-download"></i>
                    </button>`;
        }

        // Existing repository - determine state
        switch (repo.status) {
            case 'empty':
                return `<button class="btn btn-small btn-primary" 
                                title="Import Repository" 
                                onclick="repoManager.importRepo('${repoId}')">
                            <i class="fas fa-download"></i>
                        </button>`;
                        
            case 'importing':
                return `<button class="btn btn-small btn-primary" 
                                title="Importing..." 
                                disabled>
                            <i class="fas fa-spinner fa-spin"></i>
                        </button>`;
                        
            case 'imported':
                return `<button class="btn btn-small btn-success" 
                                title="Build Application" 
                                onclick="repoManager.buildRepo('${repoId}')">
                            <i class="fas fa-hammer"></i>
                        </button>`;
                        
            case 'building':
                return `<button class="btn btn-small btn-success" 
                                title="Building..." 
                                disabled>
                            <i class="fas fa-spinner fa-spin"></i>
                        </button>`;
                        
            case 'success':
                if (repo.isInstalled) {
                    return `<button class="btn btn-small btn-warning" 
                                    title="Update Application" 
                                    onclick="repoManager.updateRepo('${repoId}')">
                                <i class="fas fa-sync-alt"></i>
                            </button>`;
                } else {
                    // Build completed but installation not yet confirmed - keep loading
                    return `<button class="btn btn-small btn-success" 
                                    title="Confirming installation..." 
                                    disabled>
                                <i class="fas fa-spinner fa-spin"></i>
                            </button>`;
                }
                
            case 'error':
                return `<button class="btn btn-small btn-danger" 
                                title="Retry Build" 
                                onclick="repoManager.buildRepo('${repoId}')">
                            <i class="fas fa-redo"></i>
                        </button>`;
                        
            default:
                return `<button class="btn btn-small btn-primary" 
                                title="Import Repository" 
                                onclick="repoManager.importRepo('${repoId}')">
                            <i class="fas fa-download"></i>
                        </button>`;
        }
    }

    async handleUrlChange(repoId, url) {
        if (repoId === 'empty') {
            // For empty repositories, just store the URL as-is (normalize later during import)
            this.pendingRepoUrl = url;
            // Refresh UI to enable/disable Import button based on URL presence
            this.renderRepos();
        } else {
            // Only update existing repository URL if the user explicitly wants to change it
            // Don't update automatically during normal text input
            console.log(`URL change for existing repo ${repoId}: ${url}`);
            // For now, don't auto-update existing repos to avoid unwanted notifications
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
                apiUpdatesEnabled: true,
                status: 'empty' // Set initial status to empty (ready for import)
            });
            
            if (response.data.success) {
                console.log(`✅ Repository "${repoName}" created successfully`);
                return response.data.repo;
            } else {
                console.error('Backend rejected repository creation:', response.data.message);
                throw new Error(response.data.message);
            }
        } catch (error) {
            console.error('Failed to add repository:', error);
            console.error('Error response:', error.response?.data);
            const errorMessage = error.response?.data?.message || error.message || 'Unknown error';
            throw new Error(errorMessage);
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

    async importRepo(repoId) {
        // Immediately disable button to prevent double-clicks
        this.disableActionButton(repoId);
        
        try {
            let repo = this.repos.find(r => r.id === repoId);
            let repoUrl = '';
            
            // Handle empty repository case
            if (repoId === 'empty') {
                if (!this.pendingRepoUrl || !this.pendingRepoUrl.trim()) {
                    this.showNotification('Please enter a repository URL first', 'error');
                    this.enableActionButton(repoId); // Re-enable on error
                    return;
                }
                
                repoUrl = this.pendingRepoUrl;
                
                try {
                    // Create the repository first
                    repo = await this.createNewRepo(repoUrl);
                    
                    // Clear pending URL
                    this.pendingRepoUrl = '';
                    
                    // Reload repos to get updated list
                    await this.loadRepos();
                    
                } catch (error) {
                    this.showNotification('Failed to create repository: ' + error.message, 'error');
                    this.enableActionButton(repoId); // Re-enable on error
                    return;
                }
            } else if (!repo || !repo.url) {
                this.showNotification('Repository not found or URL missing', 'error');
                this.enableActionButton(repoId); // Re-enable on error
                return;
            }

            this.updateRepoStatus(repo.id, 'importing');
            this.showNotification(`Importing ${repo.name}...`, 'info');

            // Call the real import API
            const response = await axios.post(`/api/repos/${repo.id}/import`);
            
            if (response.data.success) {
                const message = response.data.icon ? 
                    `${repo.name} imported successfully! Found icon and ready to build.` :
                    `${repo.name} imported successfully! Ready to build.`;
                this.showNotification(message, 'success');
                await this.loadRepos(); // Reload to get updated status
            } else {
                this.updateRepoStatus(repo.id, 'error');
                this.showNotification(`Import failed: ${response.data.message}`, 'error');
            }
            
        } catch (error) {
            console.error('Import failed:', error);
            this.enableActionButton(repoId); // Re-enable on error
            this.showNotification('Import failed: ' + error.message, 'error');
        }
    }

    async buildRepo(repoId) {
        // Immediately disable button to prevent double-clicks
        this.disableActionButton(repoId);
        
        try {
            const repo = this.repos.find(r => r.id === repoId);
            if (!repo || !repo.url) {
                this.enableActionButton(repoId); // Re-enable on error
                return;
            }

            this.updateRepoStatus(repoId, 'building');
            this.showNotification(`Building ${repo.name}...`, 'info');

            const response = await axios.post(`/api/repos/${repoId}/compile`);
            
            if (response.data.success) {
                this.showNotification(`${repo.name} built successfully! Confirming installation...`, 'success');
                // Keep checking until installation is confirmed
                await this.waitForInstallationConfirmation(repoId);
            } else {
                this.updateRepoStatus(repoId, 'error');
                this.enableActionButton(repoId); // Re-enable on error
                this.showNotification(`Build failed: ${response.data.message}`, 'error');
            }
        } catch (error) {
            console.error('Build failed:', error);
            this.updateRepoStatus(repoId, 'error');
            this.enableActionButton(repoId); // Re-enable on error
            this.showNotification('Build failed: ' + (error.response?.data?.message || error.message), 'error');
        }
    }

    async updateRepo(repoId) {
        // Immediately disable button to prevent double-clicks
        this.disableActionButton(repoId);
        
        try {
            const repo = this.repos.find(r => r.id === repoId);
            if (!repo || !repo.url) {
                this.enableActionButton(repoId); // Re-enable on error
                return;
            }

            this.updateRepoStatus(repoId, 'building');
            this.showNotification(`Updating ${repo.name}...`, 'info');

            const response = await axios.post(`/api/repos/${repoId}/compile`);
            
            if (response.data.success) {
                this.showNotification(`${repo.name} updated successfully!`, 'success');
                // Force sync with CasaOS and reload to get updated status
                await this.syncAndReload();
            } else {
                this.updateRepoStatus(repoId, 'error');
                this.enableActionButton(repoId); // Re-enable on error
                this.showNotification(`Update failed: ${response.data.message}`, 'error');
            }
        } catch (error) {
            console.error('Update failed:', error);
            this.updateRepoStatus(repoId, 'error');
            this.enableActionButton(repoId); // Re-enable on error
            this.showNotification('Update failed: ' + (error.response?.data?.message || error.message), 'error');
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

    async toggleApp(repoId) {
        const repo = this.repos.find(r => r.id === repoId);
        if (!repo || !repo.isInstalled) {
            this.showNotification('App must be installed first', 'error');
            return;
        }

        // Check if app is in transition state
        if (repo.status === 'starting' || repo.status === 'stopping') {
            this.showNotification(`App is already ${repo.status}, please wait...`, 'warning');
            return;
        }

        const isCurrentlyRunning = repo.isRunning || false;
        const action = isCurrentlyRunning ? 'stop' : 'start';
        
        // Additional validation: Check if the desired action matches current state
        // This prevents race conditions where UI might be out of sync
        if ((action === 'start' && isCurrentlyRunning) || (action === 'stop' && !isCurrentlyRunning)) {
            const currentState = isCurrentlyRunning ? 'already running' : 'already stopped';
            this.showNotification(`App is ${currentState}`, 'info');
            // Refresh to sync UI with actual state
            await this.loadRepos();
            return;
        }

        try {
            // Update toggle to show loading state
            const toggle = document.getElementById(`app-toggle-${repoId}`);
            if (toggle) {
                toggle.classList.add('disabled');
                toggle.style.pointerEvents = 'none';
            }

            const response = await axios.post(`/api/repos/${repoId}/toggle`, {
                start: !isCurrentlyRunning
            });
            
            if (response.data.success) {
                this.showNotification(`Application ${action}ed successfully`, 'success');
                // Reload repositories to get updated status
                await this.loadRepos();
            } else {
                this.showNotification(`Failed to ${action} application: ${response.data.message}`, 'error');
                // Re-enable toggle on error
                if (toggle) {
                    toggle.classList.remove('disabled');
                    toggle.style.pointerEvents = '';
                }
            }
        } catch (error) {
            console.error(`Error ${action}ing app:`, error);
            const errorMessage = error.response?.data?.message || error.message || 'Unknown error';
            this.showNotification(`Error ${action}ing application: ${errorMessage}`, 'error');
            
            // Re-enable toggle on error
            const toggle = document.getElementById(`app-toggle-${repoId}`);
            if (toggle) {
                toggle.classList.remove('disabled');
                toggle.style.pointerEvents = '';
            }
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
            
            // Update the action button to show loading state
            this.updateActionButton(repoId, status);
        }
    }
    
    updateActionButton(repoId, status) {
        const repoElement = document.querySelector(`[data-repo-id="${repoId}"]`);
        if (repoElement) {
            const actionButton = repoElement.querySelector('.repo-actions button');
            if (actionButton) {
                // Update button based on status
                switch (status) {
                    case 'importing':
                        actionButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
                        actionButton.disabled = true;
                        actionButton.title = 'Importing...';
                        break;
                    case 'building':
                        actionButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
                        actionButton.disabled = true;
                        actionButton.title = 'Building...';
                        break;
                    case 'imported':
                        actionButton.innerHTML = '<i class="fas fa-hammer"></i>';
                        actionButton.disabled = false;
                        actionButton.title = 'Build Application';
                        actionButton.className = 'btn btn-small btn-success';
                        actionButton.onclick = () => repoManager.buildRepo(repoId);
                        break;
                    case 'success':
                        // Need to check if installed to determine if it should be Update or Build
                        const repo = this.repos.find(r => r.id === repoId);
                        if (repo && repo.isInstalled) {
                            actionButton.innerHTML = '<i class="fas fa-sync-alt"></i>';
                            actionButton.title = 'Update Application';
                            actionButton.className = 'btn btn-small btn-warning';
                            actionButton.onclick = () => repoManager.updateRepo(repoId);
                        } else {
                            actionButton.innerHTML = '<i class="fas fa-hammer"></i>';
                            actionButton.title = 'Build Application';
                            actionButton.className = 'btn btn-small btn-success';
                            actionButton.onclick = () => repoManager.buildRepo(repoId);
                        }
                        actionButton.disabled = false;
                        break;
                    case 'error':
                        actionButton.innerHTML = '<i class="fas fa-redo"></i>';
                        actionButton.disabled = false;
                        actionButton.title = 'Retry Build';
                        actionButton.className = 'btn btn-small btn-danger';
                        actionButton.onclick = () => repoManager.buildRepo(repoId);
                        break;
                }
            }
        }
    }
    
    disableActionButton(repoId) {
        const repoElement = document.querySelector(`[data-repo-id="${repoId}"]`);
        if (repoElement) {
            const actionButton = repoElement.querySelector('.repo-actions button:first-child');
            if (actionButton) {
                console.log(`🔒 Disabling button for ${repoId}:`, actionButton);
                actionButton.disabled = true;
                actionButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
                actionButton.style.pointerEvents = 'none'; // Extra protection
            } else {
                console.error(`❌ Could not find action button for ${repoId}`);
            }
        } else {
            console.error(`❌ Could not find repo element for ${repoId}`);
        }
    }
    
    enableActionButton(repoId) {
        const repoElement = document.querySelector(`[data-repo-id="${repoId}"]`);
        if (repoElement) {
            const actionButton = repoElement.querySelector('.repo-actions button:first-child');
            if (actionButton) {
                console.log(`🔓 Re-enabling button for ${repoId}`);
                actionButton.disabled = false;
                actionButton.style.pointerEvents = 'auto'; // Remove extra protection
                // Restore proper button content based on current state
                const repo = this.repos.find(r => r.id === repoId);
                if (repo) {
                    this.updateActionButton(repoId, repo.status || 'idle');
                }
            }
        }
    }

    expandUrl(repoId) {
        let currentUrl = '';
        
        if (repoId === 'empty') {
            // For empty repositories, use the pending URL from the text input
            currentUrl = this.pendingRepoUrl || '';
        } else {
            // For existing repositories, use the stored URL
            const repo = this.repos.find(r => r.id === repoId);
            currentUrl = repo ? repo.url : '';
        }
        
        this.currentEditingRepo = repoId;
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
        // Create notification container if it doesn't exist
        let container = document.getElementById('notification-container');
        if (!container) {
            container = document.createElement('div');
            container.id = 'notification-container';
            container.style.cssText = `
                position: fixed;
                top: 20px;
                right: 20px;
                z-index: 10000;
                display: flex;
                flex-direction: column;
                gap: 10px;
                pointer-events: none;
            `;
            document.body.appendChild(container);
        }
        
        // Create notification element
        const notification = document.createElement('div');
        notification.className = `notification notification-${type}`;
        notification.style.cssText = `
            padding: 15px 20px;
            border-radius: 8px;
            color: white;
            font-weight: 500;
            max-width: 400px;
            opacity: 0;
            transform: translateX(100%);
            transition: all 0.3s ease;
            pointer-events: auto;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
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
        
        // Add to container (will automatically stack due to flexbox)
        container.appendChild(notification);
        
        // Animate in from right
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
                // Clean up container if empty
                if (container.children.length === 0) {
                    container.remove();
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