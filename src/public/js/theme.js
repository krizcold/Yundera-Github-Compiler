// Theme Manager - loads in <head> before CSS to prevent FOUC
(function() {
    'use strict';

    var STORAGE_KEY = 'yundera-theme';
    var DEFAULT_THEME = 'light';
    var VALID_THEMES = ['light', 'dark', 'midnight'];

    // Apply saved theme immediately (before first paint)
    var saved = localStorage.getItem(STORAGE_KEY);
    if (saved && VALID_THEMES.indexOf(saved) !== -1) {
        document.documentElement.setAttribute('data-theme', saved);
    }

    window.ThemeManager = {
        current: function() {
            return document.documentElement.getAttribute('data-theme') || DEFAULT_THEME;
        },

        apply: function(theme) {
            if (VALID_THEMES.indexOf(theme) === -1) return;
            if (theme === DEFAULT_THEME) {
                document.documentElement.removeAttribute('data-theme');
            } else {
                document.documentElement.setAttribute('data-theme', theme);
            }
            localStorage.setItem(STORAGE_KEY, theme);
        },

        init: function() {
            // Ensure the theme attribute is set on load
            var saved = localStorage.getItem(STORAGE_KEY);
            if (saved && VALID_THEMES.indexOf(saved) !== -1 && saved !== DEFAULT_THEME) {
                document.documentElement.setAttribute('data-theme', saved);
            }
        },

        createDropdown: function() {
            var container = document.createElement('div');
            container.className = 'theme-selector';
            container.innerHTML = '<i class="fas fa-palette"></i>' +
                '<select id="theme-select">' +
                '<option value="light">Light</option>' +
                '<option value="dark">Dark</option>' +
                '<option value="midnight">Midnight</option>' +
                '</select>';

            var select = container.querySelector('select');
            var current = this.current();
            select.value = current;

            var self = this;
            select.addEventListener('change', function() {
                self.apply(this.value);
            });

            return container;
        }
    };
})();
