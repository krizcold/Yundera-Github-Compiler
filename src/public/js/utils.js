// Shared Utilities for Yundera Dev Kit
'use strict';

/**
 * LogStreamer - Unified EventSource streaming
 * Replaces 3 duplicate implementations across the codebase
 */
window.LogStreamer = {
    /**
     * Create a new log stream connection
     * @param {Object} options
     * @param {string} options.url - The EventSource URL to connect to
     * @param {Function} options.onMessage - Callback for messages: (data, rawEvent) => void
     * @param {Function} [options.onError] - Callback for errors: (event) => void
     * @param {Function} [options.onOpen] - Callback when connection opens
     * @param {boolean} [options.useNamedEvents=false] - Whether to listen for named events (log, error, complete) vs generic onmessage
     * @returns {{ eventSource: EventSource, close: Function }}
     */
    create: function(options) {
        var url = options.url;
        var onMessage = options.onMessage;
        var onError = options.onError;
        var onOpen = options.onOpen;
        var useNamedEvents = options.useNamedEvents || false;

        var es = new EventSource(url);

        if (useNamedEvents) {
            // Named events: 'log', 'error', 'complete' (used by service logs, app logs)
            es.addEventListener('log', function(e) {
                try {
                    var data = JSON.parse(e.data);
                    onMessage(data, e);
                } catch (err) {
                    onMessage({ message: e.data, type: 'info' }, e);
                }
            });
            es.addEventListener('error', function(e) {
                try {
                    var data = JSON.parse(e.data);
                    onMessage(data, e);
                } catch (err) {
                    if (e.data) onMessage({ message: e.data, type: 'error' }, e);
                }
            });
            es.addEventListener('complete', function(e) {
                try {
                    var data = JSON.parse(e.data);
                    onMessage(data, e);
                } catch (err) {
                    if (e.data) onMessage({ message: e.data, type: 'success' }, e);
                }
            });
        } else {
            // Generic onmessage (used by build terminal)
            es.onmessage = function(event) {
                try {
                    var data = JSON.parse(event.data);
                    if (data.type === 'ping' || !data.message || data.message.trim() === '') {
                        return;
                    }
                    onMessage(data, event);
                } catch (err) {
                    if (event.data && event.data.trim() !== '') {
                        onMessage({ message: event.data, type: 'info' }, event);
                    }
                }
            };
        }

        es.onerror = function(event) {
            if (onError) onError(event);
        };

        if (onOpen) {
            es.onopen = onOpen;
        }

        return {
            eventSource: es,
            close: function() {
                es.close();
            }
        };
    }
};

/**
 * TabSwitcher - Unified tab switching logic
 * Replaces 2 duplicate implementations
 */
window.TabSwitcher = {
    /**
     * Switch between tabs in a tabbed panel
     * @param {string} activeTabClass - CSS class to mark active tab button
     * @param {string} tabButtonSelector - Selector for all tab buttons in the group
     * @param {HTMLElement} clickedTab - The tab button that was clicked
     * @param {Object} panels - Map of tab name to panel element ID
     * @param {string} activeTab - The tab name to activate
     */
    switchTab: function(activeTabClass, tabButtonSelector, clickedTab, panels, activeTab) {
        // Deactivate all tabs
        document.querySelectorAll(tabButtonSelector).forEach(function(btn) {
            btn.classList.remove(activeTabClass);
        });
        // Activate clicked tab
        if (clickedTab) {
            clickedTab.classList.add(activeTabClass);
        }
        // Show/hide panels
        Object.keys(panels).forEach(function(tabName) {
            var panelEl = document.getElementById(panels[tabName]);
            if (panelEl) {
                panelEl.style.display = (tabName === activeTab) ? 'block' : 'none';
            }
        });
    }
};

/**
 * AutoScroll - Unified auto-scroll toggle
 * Replaces 2 duplicate implementations
 */
window.AutoScroll = {
    /**
     * Toggle auto-scroll for a log viewer
     * @param {string} buttonId - ID of the toggle button
     * @param {string} viewerId - ID of the scrollable viewer element
     * @param {Object} state - State object with autoScroll boolean property
     * @param {string} stateKey - Key in state object (default: 'autoScroll')
     */
    toggle: function(buttonId, viewerId, state, stateKey) {
        stateKey = stateKey || 'autoScroll';
        state[stateKey] = !state[stateKey];
        var btn = document.getElementById(buttonId);
        if (btn) {
            btn.textContent = state[stateKey] ? '⏸ Pause Scroll' : '▶ Resume Scroll';
            btn.classList.toggle('paused', !state[stateKey]);
        }
        if (state[stateKey]) {
            var viewer = document.getElementById(viewerId);
            if (viewer) {
                viewer.scrollTop = viewer.scrollHeight;
            }
        }
    }
};

/**
 * Notify - Standalone notification toast
 * Can be used before RepoManager is initialized
 */
window.Notify = {
    show: function(message, type) {
        type = type || 'info';
        var container = document.getElementById('notification-container');
        if (!container) {
            container = document.createElement('div');
            container.id = 'notification-container';
            container.style.cssText = 'position: fixed; top: 20px; right: 20px; z-index: 10000; display: flex; flex-direction: column; gap: 10px; pointer-events: none;';
            document.body.appendChild(container);
        }

        var notification = document.createElement('div');
        notification.className = 'notification notification-' + type;
        notification.style.cssText = 'padding: 15px 20px; border-radius: 8px; color: white; font-weight: 500; max-width: 400px; opacity: 0; transform: translateX(100%); transition: all 0.3s ease; pointer-events: auto; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);';

        var colors = { success: '#059669', error: '#dc2626', warning: '#d97706', info: '#2563eb' };
        notification.style.backgroundColor = colors[type] || colors.info;
        notification.textContent = message;
        container.appendChild(notification);

        setTimeout(function() {
            notification.style.opacity = '1';
            notification.style.transform = 'translateX(0)';
        }, 100);

        setTimeout(function() {
            notification.style.opacity = '0';
            notification.style.transform = 'translateX(100%)';
            setTimeout(function() {
                notification.remove();
                if (container.children.length === 0) container.remove();
            }, 300);
        }, 5000);
    }
};
