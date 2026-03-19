// Main initialization for Yundera Dev Kit
'use strict';

// Global functions for modal management (referenced by inline onclick handlers in HTML)
function closeModal(modalId) {
    repoManager.closeModal(modalId);
}

function saveYaml() {
    repoManager.saveYaml();
}

// Load and display build information
async function loadBuildInfo() {
    try {
        var response = await axios.get('/build-info');
        var buildInfo = response.data;

        document.getElementById('build-version').textContent = buildInfo.version;
        document.getElementById('build-sha').textContent = buildInfo.commitSha;

        var buildDate = new Date(buildInfo.buildDate);
        var formattedDate = buildDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        document.getElementById('build-date').textContent = formattedDate;

        var buildTypeEl = document.getElementById('build-type');
        buildTypeEl.textContent = buildInfo.buildType.toUpperCase();
        buildTypeEl.className = 'build-info-type build-type-' + buildInfo.buildType;
    } catch (error) {
        console.warn('Failed to load build info:', error);
        document.getElementById('build-info').style.display = 'none';
    }
}

// Initialize the repository manager when the page loads
var repoManager;

function initializeApp() {
    console.log('🚀 Initializing Yundera Dev Kit...');
    try {
        repoManager = new RepoManager();
        console.log('✅ RepoManager initialized successfully');

        // Make repoManager globally accessible for debugging
        window.repoManager = repoManager;

        // Initialize theme dropdown in header top-right area
        if (window.ThemeManager && ThemeManager.init) {
            ThemeManager.init();
            var themeDropdown = ThemeManager.createDropdown();
            if (themeDropdown) {
                var headerRight = document.getElementById('header-right');
                if (headerRight) {
                    headerRight.appendChild(themeDropdown);
                }
            }
        }

        // Load build information
        loadBuildInfo();
    } catch (error) {
        console.error('❌ Failed to initialize RepoManager:', error);
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeApp);
} else {
    initializeApp();
}
