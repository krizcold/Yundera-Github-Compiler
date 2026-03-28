// Build System - build operations, compose diff, env transfer, dialogs
'use strict';

Object.assign(RepoManager.prototype, {
    buildRepo: async function(repoId, runPreInstall = false) {
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
    },

    // Smart docker-compose comparison that ignores environment variable values
    compareDockerComposeStructure: function(currentCompose, newCompose) {
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
    },

    // Normalize docker-compose for comparison by replacing env values with placeholders
    normalizeDockerComposeForComparison: function(config) {
        if (!config || typeof config !== 'object') {
            return config;
        }

        // Deep clone the config to avoid modifying the original
        const normalized = JSON.parse(JSON.stringify(config));

        // Recursively normalize the structure
        this.normalizeEnvironmentValues(normalized);

        return normalized;
    },

    // Recursively find and normalize environment variable values
    normalizeEnvironmentValues: function(obj) {
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
    },

    showDockerComposeChangePopup: async function(composeChangeInfo, repo) {
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
                        // Check if this is part of a split button group
                        const isSplitButton = button.classList.contains('split-button-left') || button.classList.contains('split-button-right');
                        if (!isSplitButton) {
                            // Single button - restore icon directly
                            const hasUpdates = repo.hasUpdates || button.getAttribute('title')?.includes('Update');
                            button.innerHTML = hasUpdates ? '<i class="fas fa-arrow-up"></i>' : '<i class="fas fa-sync-alt"></i>';
                        }
                        // For split buttons, let the repo manager re-render handle it via Method 2
                    });

                    // Method 2: Try the repo manager approach as fallback (this properly handles split buttons)
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
                        // Check if this is part of a split button group
                        const isSplitButton = button.classList.contains('split-button-left') || button.classList.contains('split-button-right');
                        if (!isSplitButton) {
                            // Single button - restore icon directly
                            const hasUpdates = repo.hasUpdates || button.getAttribute('title')?.includes('Update');
                            button.innerHTML = hasUpdates ? '<i class="fas fa-arrow-up"></i>' : '<i class="fas fa-sync-alt"></i>';
                        }
                        // For split buttons, let the repo manager re-render handle it via Method 2
                    });

                    // Method 2: Try the repo manager approach as fallback (this properly handles split buttons)
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
    },

    // Helper function to load JSDiff library
    loadJSDiffLibrary: async function() {
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
    },

    // Helper function to generate diff highlighting with optional environment transfer awareness
    generateDiffHighlight: function(oldText, newText, side, envTransfers = null) {
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
    },

    // Generate diff highlighting WITH environment transfer (shows yellow highlights on transferred env values)
    generateDiffWithTransfer: function(oldText, newText, side) {
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
    },

    // Generate diff highlighting WITHOUT environment transfer (no env highlights)
    generateDiffWithoutTransfer: function(oldText, newText, side) {
        try {
            // Use structural diff approach - this will show red/green for structural changes
            // but won't highlight environment values at all
            return this.generateStructuralDiff(oldText, newText, side);

        } catch (error) {
            console.warn('Error generating diff without transfer:', error);
            return this.escapeHtml(side === 'old' ? oldText : newText);
        }
    },

    // Helper function to normalize environment variables to object format
    normalizeEnvironment: function(env) {
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
    },

    // Helper function to update diff highlighting - NEVER calls transferEnvironmentVariables for display
    updateDiffHighlighting: function(currentCompose, newCompose, showEnvTransfer, updateComposeEnabled = true) {
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
    },

    // Helper function to show environment preview for current side (left panel)
    showEnvironmentPreviewForCurrentSide: function(currentCompose, newCompose) {
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
    },

    // Helper function to add yellow highlighting to current side environment values
    addCurrentSideEnvironmentHighlighting: function(htmlContent, envTransfers, currentCompose) {
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
    },

    // Helper function to show environment preview using two-phase smart diff system
    showEnvironmentPreview: function(currentCompose, newCompose) {
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
    },

    // Helper function to add yellow highlighting to transferred environment values
    addEnvironmentHighlighting: function(htmlContent, envTransfers, currentCompose, newCompose) {
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
    },

    // Helper function to create placeholder version of docker-compose for structural diff
    createPlaceholderVersion: function(composeText) {
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
    },

    // Helper function to extract environment values with their original formatting
    extractEnvironmentValues: function(composeText) {
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
    },

    // Helper function to generate structural diff (red/green) using placeholder versions
    generateStructuralDiff: function(currentCompose, newCompose, side) {
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
    },

    // Helper function to build environment transfer map
    buildEnvironmentTransferMap: function(currentCompose, newCompose) {
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
    },

    // Helper function to transfer environment variables between docker compose configurations
    transferEnvironmentVariables: function(oldCompose, newCompose) {
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
    },

    showUpdateAvailablePopup: async function(repo) {
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
            `;

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
    },

    performDockerComposeAnalysis: async function(repo) {
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
    },

    showReinstallConfirmation: async function(repo, isUpdate = false) {
        return new Promise((resolve) => {
            // Create reinstall/update confirmation popup
            const popup = document.createElement('div');
            popup.id = 'reinstall-confirmation';
            const actionType = isUpdate ? 'Update' : 'Re-install';
            const actionVerb = isUpdate ? 'update' : 're-install';
            const processType = isUpdate ? 'update' : 're-installation';
            popup.innerHTML = `
                <div class="uninstall-backdrop"></div>
                <div class="uninstall-container">
                    <div class="uninstall-header">
                        <div class="uninstall-icon">🔄</div>
                        <h2>${isUpdate ? 'Clean Update Application' : 'Re-install Application'}</h2>
                    </div>
                    <div class="uninstall-content">
                        <p><strong>Are you sure you want to ${actionVerb} "${repo.displayName || repo.name}"?</strong></p>

                        <div class="uninstall-notice">
                            <p><i class="fas fa-info-circle"></i> ${isUpdate ? 'This will update to the latest version and redeploy the application with the selected options.' : 'This will rebuild and redeploy the application with the latest configuration.'}</p>
                        </div>

                        <div class="data-preservation">
                            <div class="data-option">
                                <label class="data-checkbox">
                                    <input type="checkbox" id="reinstall-delete-data">
                                    <span class="data-checkmark"></span>
                                    <span class="data-label">Delete application data before ${actionVerb}</span>
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
                                <li>The application will be temporarily stopped during ${processType}</li>
                                <li>Any unsaved data in the containers will be lost</li>
                                <li>The process may take several minutes to complete</li>
                            </ul>
                        </div>
                    </div>
                    <div class="uninstall-actions">
                        <button class="btn btn-secondary" id="cancel-reinstall">Cancel</button>
                        <button class="btn btn-warning" id="confirm-reinstall">${actionType} Application</button>
                    </div>
                </div>
            `;

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
    },

    checkForPreInstallCommand: async function(repoId) {
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
                    // Check if we've left the x-casaos section (another top-level key)
                    const currentIndentation = line.length - line.trimStart().length;
                    if (currentIndentation === 0 && trimmed.endsWith(':')) {
                        inXCasaOS = false;
                    }
                }
            }
            return null;
        } catch (error) {
            console.error('Failed to check for pre-install command:', error);
            return null;
        }
    },

    showPreInstallWarning: async function(repo, preInstallCommand) {
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
    },

    showUninstallConfirmation: async function(repo) {
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
    },

    checkFirstTimeUser: function() {
        const hasAcceptedRisks = localStorage.getItem('yundera-risks-accepted');
        if (!hasAcceptedRisks) {
            this.showFirstTimeRiskWarning();
        }
    },

    showFirstTimeRiskWarning: function() {
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
});
