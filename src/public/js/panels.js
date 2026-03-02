// Panels - service logs, app logs, interactive terminal, file browser
'use strict';

Object.assign(RepoManager.prototype, {
    openInteractiveTerminal: function() {
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

        document.body.appendChild(terminal);

        // Set up event handlers
        this.setupInteractiveTerminalHandlers();
    },

    openServiceLogs: function() {
        console.log('📋 openServiceLogs called');

        // Initialize service logs state with persistent terminal sessions
        this.serviceLogsState = {
            selectedService: 'dev-kit',
            services: {
                'dev-kit': {
                    name: 'Dev Kit',
                    container: 'yunderadevkit',
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
                            <div class="service-item active" data-service="dev-kit">
                                <div class="service-icon"><i class="fas fa-code-branch"></i></div>
                                <div class="service-info">
                                    <div class="service-name">Dev Kit</div>
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
                                    <div class="logs-service-title">Dev Kit Logs</div>
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
                                    <div class="log-line system">📋 Loading logs for Dev Kit...</div>
                                </div>
                            </div>
                            <div class="logs-panel" id="terminal-panel">
                                <div class="terminal-content" id="service-terminal-output">
                                    <div class="log-line system">🖥️ Service Terminal Ready</div>
                                </div>
                                <div class="terminal-input-section">
                                    <div class="terminal-prompt">
                                        <span id="service-terminal-prompt">ubuntu@dev-kit:/$</span>
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

        document.body.appendChild(logsPopup);

        // Set up event handlers for service logs
        this.setupServiceLogsHandlers();
    },

    setupServiceLogsHandlers: function() {
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
    },

    setupServiceTerminalHandlers: function() {
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
    },

    selectService: function(serviceId) {
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
    },

    updateServiceSidebar: function() {
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
            } else if (serviceKey === 'dev-kit') {
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
    },

    switchLogsTab: function(tabType) {
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
    },

    loadServiceLogs: async function() {
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
    },

    restoreServiceLogHistory: function() {
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
    },

    startLogStreaming: function() {
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
    },

    saveLogToServiceHistory: function(serviceKey, logText, timestamp, type = 'log') {
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
    },

    addLogToViewer: function(logText, timestamp, type = 'log') {
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
    },

    displayLogs: function(logs) {
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
    },

    refreshServiceLogs: function() {
        this.loadServiceLogs();
    },

    clearServiceLogs: function() {
        const logsViewer = document.getElementById('logs-viewer');
        if (logsViewer) {
            logsViewer.innerHTML = '<div class="log-line system">📄 Logs cleared</div>';
        }
    },

    toggleAutoScroll: function() {
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
    },

    executeServiceCommand: async function() {
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
    },

    updateServiceStatus: async function() {
        try {
            const url = this.addHashToUrl('/api/admin/services/status');
            const response = await axios.get(url);
            if (response.data.success) {
                const services = response.data.services;

                // Update status indicators in the sidebar
                services.forEach(service => {
                    let serviceId;
                    switch (service.container) {
                        case 'yunderadevkit':
                            serviceId = 'dev-kit';
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
    },

    openAppLogs: async function(repoId) {
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
    },

    closeAppLogsPopup: function() {
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
    },

    closeServiceLogs: function() {
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
    },

    createAppLogsPopup: function() {
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

        document.body.appendChild(logsPopup);

        // Only set up handlers if not loading (will be set up later)
        if (!this.appLogsState.loading) {
            this.setupAppLogsHandlers();
            this.startAppLogStreaming();
        }
    },

    updateAppLogsPopup: function() {
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
    },

    setupAppLogsHandlers: function() {
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
    },

    selectAppContainer: function(containerName) {
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

        // Restore terminal history for the selected container
        const terminalOutput = document.getElementById('service-terminal-output');
        if (terminalOutput) {
            terminalOutput.innerHTML = '<div class="log-line system">🖥️ Container Terminal Ready</div>';
            const termHistory = container.terminalHistory || [];
            termHistory.forEach(historyItem => {
                terminalOutput.innerHTML += historyItem;
            });
            terminalOutput.scrollTop = terminalOutput.scrollHeight;
        }

        // If this container already has a running stream, restore its log history
        // Otherwise start a new stream
        if (this.appLogsState.eventSources[containerName]) {
            this.restoreAppLogHistory(containerName);
        } else {
            this.refreshAppLogs();
        }
    },

    switchAppLogsTab: function(tabType) {
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
    },

    startAppLogStreaming: function() {
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
                if (this.appLogsState && this.appLogsState.selectedContainer === containerName) {
                    console.log(`✅ Connected to ${containerName} logs`);
                    this.appendAppLogLine('📡 ' + data.message, null, 'system');
                }
            });

            // Handle actual log messages - always save to history, only display if selected
            eventSource.addEventListener('log', (event) => {
                try {
                    const data = JSON.parse(event.data);
                    // Always save log to this container's history
                    this.saveAppLogToHistory(containerName, data.log, data.timestamp);

                    // Only update viewer if this container is currently selected
                    if (this.appLogsState && this.appLogsState.selectedContainer === containerName) {
                        this.appendAppLogLine(data.log, data.timestamp);
                    }
                } catch (parseError) {
                    console.error('Failed to parse log message:', parseError);
                }
            });

            // Handle connection errors with retry logic
            eventSource.addEventListener('error', (event) => {
                console.error(`App log stream error for ${containerName}`);

                // Only show error if connection is permanently closed
                if (eventSource.readyState === EventSource.CLOSED) {
                    // Connection is closed, remove from eventSources
                    if (this.appLogsState) {
                        delete this.appLogsState.eventSources[containerName];
                    }

                    // Save error to history
                    this.saveAppLogToHistory(containerName, '❌ Log stream disconnected. Attempting to reconnect...', new Date().toISOString(), 'error');

                    // Only show error in viewer if this container is still selected
                    if (this.appLogsState && this.appLogsState.selectedContainer === containerName) {
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
    },

    appendAppLogLine: function(message, timestamp, type = 'log') {
        const viewer = document.getElementById('logs-viewer');
        if (!viewer) return;

        const line = document.createElement('div');
        line.className = `log-line ${type}`;

        const time = timestamp ? new Date(timestamp).toLocaleTimeString() : new Date().toLocaleTimeString();
        const prefix = type === 'system' ? '🖥️' : type === 'error' ? '❌' : '📋';

        line.innerHTML = `<span class="log-timestamp">[${time}]</span> ${prefix} ${message}`;
        viewer.appendChild(line);

        // Auto-scroll to bottom only if follow mode is active
        const followBtn = document.getElementById('logs-follow-btn');
        if (followBtn && followBtn.classList.contains('active')) {
            viewer.scrollTop = viewer.scrollHeight;
        }

        // Limit lines
        if (viewer.children.length > 1000) {
            viewer.removeChild(viewer.firstChild);
        }
    },

    saveAppLogToHistory: function(containerName, logText, timestamp, type = 'log') {
        if (!this.appLogsState || !this.appLogsState.containers[containerName]) return;

        const container = this.appLogsState.containers[containerName];
        const time = timestamp ? new Date(timestamp).toLocaleTimeString() : new Date().toLocaleTimeString();
        const prefix = type === 'system' ? '🖥️' : type === 'error' ? '❌' : '📋';
        const logHtml = `<div class="log-line ${type}"><span class="log-timestamp">[${time}]</span> ${prefix} ${logText}</div>`;

        container.logHistory.push(logHtml);

        // Limit history to prevent memory issues (keep last 500 logs per container)
        if (container.logHistory.length > 500) {
            container.logHistory.shift();
        }
    },

    restoreAppLogHistory: function(containerName) {
        if (!this.appLogsState || !this.appLogsState.containers[containerName]) return;

        const container = this.appLogsState.containers[containerName];
        const viewer = document.getElementById('logs-viewer');
        if (!viewer) return;

        if (container.logHistory && container.logHistory.length > 0) {
            viewer.innerHTML = container.logHistory.join('');
            const followBtn = document.getElementById('logs-follow-btn');
            if (followBtn && followBtn.classList.contains('active')) {
                viewer.scrollTop = viewer.scrollHeight;
            }
        } else {
            viewer.innerHTML = '<div class="log-line system">📡 Log stream active (no previous logs)</div>';
        }
    },

    refreshAppLogs: function() {
        const viewer = document.getElementById('logs-viewer');
        if (viewer) {
            viewer.innerHTML = '<div class="log-line system">📋 Refreshing logs...</div>';
        }
        // Clear the log history for the selected container on manual refresh
        if (this.appLogsState && this.appLogsState.selectedContainer) {
            const container = this.appLogsState.containers[this.appLogsState.selectedContainer];
            if (container) {
                container.logHistory = [];
            }
        }
        this.startAppLogStreaming();
    },

    clearAppLogs: function() {
        const viewer = document.getElementById('logs-viewer');
        if (viewer) {
            viewer.innerHTML = '<div class="log-line system">📋 Logs cleared</div>';
        }
        // Also clear the history for the selected container
        if (this.appLogsState && this.appLogsState.selectedContainer) {
            const container = this.appLogsState.containers[this.appLogsState.selectedContainer];
            if (container) {
                container.logHistory = [];
            }
        }
    },

    toggleAppAutoScroll: function() {
        const btn = document.getElementById('logs-follow-btn');
        const viewer = document.getElementById('logs-viewer');
        if (btn) {
            btn.classList.toggle('active');
            if (btn.classList.contains('active')) {
                btn.title = 'Auto-scroll: ON';
                // Scroll to bottom immediately when re-enabling
                if (viewer) {
                    viewer.scrollTop = viewer.scrollHeight;
                }
            } else {
                btn.title = 'Auto-scroll: OFF';
            }
        }
    },

    executeAppCommand: async function() {
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
    },

    appendAppTerminalLine: function(message, type = 'output') {
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
    },

    navigateAppCommandHistory: function(direction) {
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
    },

    uninstallApp: async function(repoId) {
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
    },

    showAppUninstallConfirmation: function(repo) {
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
    },

    setupInteractiveTerminalHandlers: function() {
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
    },

    updateTerminalPrompt: function() {
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
    },

    setupSidebarHandlers: function() {
        const refreshBtn = document.getElementById('refresh-files-btn');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', () => {
                this.updateSidebar();
            });
        }
    },

    initializeSidebar: async function() {
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
    },

    updateSidebar: async function() {
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
    },

    renderFileList: function(files) {
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
    },

    handleFileItemClick: function(fileItem, event) {
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
    },

    createContextMenu: function() {
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
    },

    showContextMenu: function(event, fileItem) {
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
    },

    hideContextMenu: function() {
        const contextMenu = document.getElementById('file-context-menu');
        if (contextMenu) {
            contextMenu.style.display = 'none';
        }
    },

    handleContextMenuAction: function(action) {
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
    },

    showDeleteConfirmation: function(selectedItems) {
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
    },

    confirmDelete: async function(fileNames) {
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
    },

    renameFile: async function(fileName) {
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
    },

    navigateToDirectory: async function(dirName) {
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
    },

    navigateHistory: function(direction) {
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
    },

    updateHistoryButtons: function() {
        const historyPrevBtn = document.getElementById('history-prev-btn');
        const historyNextBtn = document.getElementById('history-next-btn');
        const history = this.terminalSession.commandHistory;

        if (historyPrevBtn && historyNextBtn) {
            // Disable prev button if no history or at oldest command
            historyPrevBtn.disabled = history.length === 0 || this.terminalSession.historyIndex === 0;

            // Disable next button if no history or at current input
            historyNextBtn.disabled = history.length === 0 || this.terminalSession.historyIndex === -1;
        }
    },

    handleTabCompletion: async function() {
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
    },

    processCompletions: function(completions, beforeCursor, afterCursor, lastSpaceIndex, currentWord, commandInput) {
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
    },

    validateCacheEntry: function(key, data) {
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
    },

    proactivelyCacheDirectory: async function(directoryPath) {
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
    },

    showCachedCompletions: function(files) {
        const output = document.getElementById('terminal-output');
        const completionLine = document.createElement('div');
        completionLine.className = 'log-line info';
        completionLine.textContent = `📁 ${files.length} items: ${files.map(f => f.split('/').pop()).join('  ')}`;
        output.appendChild(completionLine);
        output.scrollTop = output.scrollHeight;
    },

    showCompletionsInOutput: function(files, title = 'Completions:') {
        const output = document.getElementById('terminal-output');
        const completionLine = document.createElement('div');
        completionLine.className = 'log-line info';
        completionLine.textContent = `📁 ${title} ${files.join('  ')}`;
        output.appendChild(completionLine);
        output.scrollTop = output.scrollHeight;
    },

    findCommonPrefix: function(strings) {
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
    },

    cacheDirectoryListing: async function(directory, runAsUser) {
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
    },

    executeTerminalCommand: async function(command, runAsUser) {
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
    },

    addToTerminalHistory: function(command, result) {
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
});
