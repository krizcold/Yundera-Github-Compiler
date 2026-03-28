// Shared Utilities for Yundera Dev Kit
'use strict';

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

/**
 * PanelWindow - Reusable full-screen panel window factory
 * Creates modal-like panels with backdrop, header, and body.
 */
window.PanelWindow = {
    /**
     * Create and display a panel window
     * @param {Object} options
     * @param {string} options.id - Unique ID for the panel element
     * @param {string} options.title - Panel title text
     * @param {string} [options.icon] - FontAwesome icon class (e.g. "fas fa-store")
     * @param {string} options.bodyHTML - Inner HTML for the panel body
     * @param {Function} [options.onClose] - Callback when panel is closed
     * @param {Array} [options.headerButtons] - Array of {html, onClick} for header buttons
     * @returns {HTMLElement} The panel element
     */
    create: function(options) {
        // Remove existing panel with same ID
        var existing = document.getElementById(options.id);
        if (existing) existing.remove();

        var panel = document.createElement('div');
        panel.id = options.id;
        panel.className = 'panel-window';

        var headerBtns = '';
        if (options.headerButtons) {
            options.headerButtons.forEach(function(btn, idx) {
                headerBtns += '<button class="panel-btn" data-header-btn="' + idx + '">' + btn.html + '</button>';
            });
        }

        panel.innerHTML =
            '<div class="panel-backdrop"></div>' +
            '<div class="panel-container">' +
                '<div class="panel-header">' +
                    '<div class="panel-title">' +
                        (options.icon ? '<i class="' + options.icon + '"></i> ' : '') +
                        options.title +
                    '</div>' +
                    '<div class="panel-controls">' +
                        headerBtns +
                        '<button class="panel-btn panel-close-btn"><i class="fas fa-times"></i></button>' +
                    '</div>' +
                '</div>' +
                '<div class="panel-body">' +
                    options.bodyHTML +
                '</div>' +
            '</div>';

        document.body.appendChild(panel);

        // Bind close handlers
        var closeBtn = panel.querySelector('.panel-close-btn');
        if (closeBtn) {
            closeBtn.addEventListener('click', function() {
                PanelWindow.close(options.id);
                if (options.onClose) options.onClose();
            });
        }
        var backdrop = panel.querySelector('.panel-backdrop');
        if (backdrop) {
            backdrop.addEventListener('click', function() {
                PanelWindow.close(options.id);
                if (options.onClose) options.onClose();
            });
        }

        // Bind header button callbacks
        if (options.headerButtons) {
            options.headerButtons.forEach(function(btn, idx) {
                var el = panel.querySelector('[data-header-btn="' + idx + '"]');
                if (el && btn.onClick) {
                    el.addEventListener('click', btn.onClick);
                }
            });
        }

        return panel;
    },

    close: function(id) {
        var panel = document.getElementById(id);
        if (panel) panel.remove();
    }
};
