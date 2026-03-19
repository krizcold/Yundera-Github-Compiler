// Store Tracker Panel - extends RepoManager
'use strict';

(function() {
    var VERSION_CHECK_CACHE_MS = 60 * 60 * 1000; // 1 hour

    // State
    var storeTrackerState = {
        stores: [],
        apps: [],
        filteredApps: [],
        searchQuery: '',
        selectedStore: 'all',
        sortBy: 'name',
        versionCheckInProgress: false,
        addFormVisible: false,
        appComposeMap: {}, // name -> composeRaw lookup
        appUpdatableMap: {}, // name -> updatable images array
        lastVersionCheck: null // timestamp of last successful version check
    };

    // --- Helpers ---

    function getAuthUrl(path) {
        if (window.repoManager && window.repoManager.addHashToUrl) {
            return window.repoManager.addHashToUrl(path);
        }
        return path;
    }

    function escapeHtml(str) {
        if (!str) return '';
        var div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    // --- API calls ---

    function loadStoreConfigs(cb) {
        axios.get(getAuthUrl('/api/admin/store-tracker/stores'))
            .then(function(resp) {
                storeTrackerState.stores = resp.data.stores || [];
                if (cb) cb(null, storeTrackerState.stores);
            })
            .catch(function(err) {
                console.error('Failed to load store configs:', err);
                if (cb) cb(err);
            });
    }

    function addStore(repoUrl, cb) {
        axios.post(getAuthUrl('/api/admin/store-tracker/stores'), { repoUrl: repoUrl })
            .then(function(resp) {
                if (resp.data.success) {
                    storeTrackerState.stores.push(resp.data.store);
                    if (cb) cb(null, resp.data.store);
                } else {
                    if (cb) cb(new Error(resp.data.message));
                }
            })
            .catch(function(err) {
                var msg = (err.response && err.response.data && err.response.data.message) || err.message;
                if (cb) cb(new Error(msg));
            });
    }

    function removeStore(storeId, cb) {
        axios.delete(getAuthUrl('/api/admin/store-tracker/stores/' + storeId))
            .then(function(resp) {
                if (resp.data.success) {
                    storeTrackerState.stores = storeTrackerState.stores.filter(function(s) { return s.id !== storeId; });
                    storeTrackerState.apps = storeTrackerState.apps.filter(function(a) { return a.storeId !== storeId; });
                    if (cb) cb(null);
                } else {
                    if (cb) cb(new Error(resp.data.message));
                }
            })
            .catch(function(err) {
                if (cb) cb(err);
            });
    }

    function loadStoreApps(refresh, cb) {
        var url = '/api/admin/store-tracker/apps';
        var params = [];
        if (refresh) params.push('refresh=true');
        if (params.length) url += '?' + params.join('&');

        axios.get(getAuthUrl(url))
            .then(function(resp) {
                storeTrackerState.apps = resp.data.apps || [];
                filterStoreApps();
                if (cb) cb(null, storeTrackerState.apps);
            })
            .catch(function(err) {
                console.error('Failed to load store apps:', err);
                if (cb) cb(err);
            });
    }

    function checkAllVersions(forceRefresh) {
        if (storeTrackerState.versionCheckInProgress) return;

        // Collect all images from ALL apps (not just filtered)
        var allImages = [];
        storeTrackerState.apps.forEach(function(app) {
            app.images.forEach(function(img) {
                allImages.push(img);
            });
        });

        if (allImages.length === 0) return;

        storeTrackerState.versionCheckInProgress = true;
        updateCheckButton();

        // Mark images as checking
        storeTrackerState.apps.forEach(function(app) {
            app.images.forEach(function(img) {
                if (!img.versionStatus || forceRefresh) {
                    img.versionStatus = 'checking';
                }
            });
        });
        filterStoreApps();
        renderStoreApps();

        var payload = { images: allImages };
        if (forceRefresh) payload.refresh = true;

        axios.post(getAuthUrl('/api/admin/store-tracker/check-versions'), payload)
            .then(function(resp) {
                var results = resp.data.results || [];
                // Build lookup by fullRef
                var resultMap = {};
                results.forEach(function(r) {
                    resultMap[r.fullRef] = r;
                });

                // Apply results to all matching images across all apps
                storeTrackerState.apps.forEach(function(app) {
                    app.images.forEach(function(img) {
                        var result = resultMap[img.fullRef];
                        if (result) {
                            img.versionStatus = result.versionStatus;
                            img.latestTag = result.latestTag;
                        }
                    });
                });

                storeTrackerState.lastVersionCheck = Date.now();
                filterStoreApps();
                renderStoreApps();
            })
            .catch(function(err) {
                console.error('Version check failed:', err);
                // Clear checking status on error
                storeTrackerState.apps.forEach(function(app) {
                    app.images.forEach(function(img) {
                        if (img.versionStatus === 'checking') {
                            img.versionStatus = undefined;
                        }
                    });
                });
                filterStoreApps();
                renderStoreApps();
                window.Notify.show('Version check failed', 'error');
            })
            .finally(function() {
                storeTrackerState.versionCheckInProgress = false;
                updateCheckButton();
            });
    }

    // --- Filtering and sorting ---

    function filterStoreApps() {
        var query = storeTrackerState.searchQuery.toLowerCase();
        var selectedStore = storeTrackerState.selectedStore;

        storeTrackerState.filteredApps = storeTrackerState.apps.filter(function(app) {
            if (selectedStore !== 'all' && app.storeId !== selectedStore) return false;
            if (query) {
                var searchable = (app.name + ' ' + (app.description || '') + ' ' + (app.category || '') + ' ' + (app.developer || '')).toLowerCase();
                if (searchable.indexOf(query) === -1) return false;
            }
            return true;
        });

        // Sort
        var sortBy = storeTrackerState.sortBy;
        storeTrackerState.filteredApps.sort(function(a, b) {
            if (sortBy === 'name') {
                return a.name.localeCompare(b.name);
            } else if (sortBy === 'category') {
                return (a.category || '').localeCompare(b.category || '');
            } else if (sortBy === 'store') {
                return a.storeName.localeCompare(b.storeName);
            } else if (sortBy === 'status') {
                var statusOrder = { 'update-available': 0, 'unknown': 1, 'latest-tag': 2, 'up-to-date': 3, 'checking': 4 };
                var aStatus = getAppWorstStatus(a);
                var bStatus = getAppWorstStatus(b);
                return (statusOrder[aStatus] || 5) - (statusOrder[bStatus] || 5);
            }
            return 0;
        });
    }

    function getAppWorstStatus(app) {
        var worst = 'up-to-date';
        var order = { 'update-available': 0, 'unknown': 1, 'latest-tag': 2, 'checking': 3, 'up-to-date': 4 };
        app.images.forEach(function(img) {
            var s = img.versionStatus || 'unknown';
            if ((order[s] || 5) < (order[worst] || 5)) worst = s;
        });
        return worst;
    }

    // --- Rendering ---

    function renderSidebar() {
        var list = document.getElementById('store-sidebar-list');
        if (!list) return;

        var html = '';

        // "All" item
        var allCount = storeTrackerState.apps.length;
        var allActive = storeTrackerState.selectedStore === 'all' ? ' active' : '';
        html += '<div class="store-sidebar-item' + allActive + '" data-store-id="all">' +
            '<span class="store-item-icon"><i class="fas fa-layer-group"></i></span>' +
            '<span class="store-item-name">All Stores</span>' +
            '<span class="store-item-count">' + allCount + '</span>' +
            '</div>';

        // Store items
        storeTrackerState.stores.forEach(function(store) {
            var count = storeTrackerState.apps.filter(function(a) { return a.storeId === store.id; }).length;
            var active = storeTrackerState.selectedStore === store.id ? ' active' : '';
            html += '<div class="store-sidebar-item' + active + '" data-store-id="' + store.id + '">' +
                '<span class="store-item-icon"><i class="fas fa-store"></i></span>' +
                '<span class="store-item-name">' + escapeHtml(store.name) + '</span>' +
                '<span class="store-item-count">' + count + '</span>' +
                '<button class="store-remove-btn" data-remove-store="' + store.id + '" title="Remove store"><i class="fas fa-trash-alt"></i></button>' +
                '</div>';
        });

        list.innerHTML = html;

        // Bind click events
        list.querySelectorAll('.store-sidebar-item').forEach(function(item) {
            item.addEventListener('click', function(e) {
                if (e.target.closest('.store-remove-btn')) return;
                var storeId = item.getAttribute('data-store-id');
                storeTrackerState.selectedStore = storeId;
                filterStoreApps();
                renderSidebar();
                renderStoreApps();
            });
        });

        list.querySelectorAll('.store-remove-btn').forEach(function(btn) {
            btn.addEventListener('click', function(e) {
                e.stopPropagation();
                var storeId = btn.getAttribute('data-remove-store');
                var store = storeTrackerState.stores.find(function(s) { return s.id === storeId; });
                if (store && confirm('Remove store "' + store.name + '"?')) {
                    removeStore(storeId, function(err) {
                        if (err) {
                            window.Notify.show('Failed to remove store', 'error');
                        } else {
                            if (storeTrackerState.selectedStore === storeId) {
                                storeTrackerState.selectedStore = 'all';
                            }
                            filterStoreApps();
                            renderSidebar();
                            renderStoreApps();
                        }
                    });
                }
            });
        });
    }

    function renderStoreApps() {
        var grid = document.getElementById('store-app-grid');
        if (!grid) return;

        if (storeTrackerState.filteredApps.length === 0) {
            if (storeTrackerState.stores.length === 0) {
                grid.innerHTML = '<div class="store-empty-state">' +
                    '<i class="fas fa-store"></i>' +
                    '<h3>No Stores Configured</h3>' +
                    '<p>Add an App Store repository from the sidebar to start tracking app versions.</p>' +
                    '</div>';
            } else if (storeTrackerState.apps.length === 0) {
                grid.innerHTML = '<div class="store-loading">' +
                    '<i class="fas fa-spinner"></i> Loading apps...' +
                    '</div>';
            } else {
                grid.innerHTML = '<div class="store-empty-state">' +
                    '<i class="fas fa-search"></i>' +
                    '<h3>No Apps Found</h3>' +
                    '<p>Try adjusting your search or filter.</p>' +
                    '</div>';
            }
            return;
        }

        var html = '';
        storeTrackerState.filteredApps.forEach(function(app) {
            html += createAppCard(app);
        });
        grid.innerHTML = html;

        // Bind action button events
        grid.querySelectorAll('.app-open-compose-btn').forEach(function(btn) {
            btn.addEventListener('click', function(e) {
                e.stopPropagation();
                var appName = btn.getAttribute('data-app-name');
                var composeRaw = storeTrackerState.appComposeMap[appName];
                if (composeRaw) openComposeInYmlBuilder(composeRaw, appName);
            });
        });

        grid.querySelectorAll('.app-update-btn:not([disabled])').forEach(function(btn) {
            btn.addEventListener('click', function(e) {
                e.stopPropagation();
                var appName = btn.getAttribute('data-app-name');
                var composeRaw = storeTrackerState.appComposeMap[appName];
                var updatableImages = storeTrackerState.appUpdatableMap[appName] || [];
                if (composeRaw) openUpdateInYmlBuilder(composeRaw, appName, updatableImages);
            });
        });
    }

    // --- Compose opening helpers ---

    function bumpTagsInYaml(yamlStr, images) {
        var result = yamlStr;
        images.forEach(function(img) {
            if (img.latestTag && img.currentTag !== img.latestTag) {
                var oldRef = img.fullRef;
                var newRef = oldRef.replace(':' + img.currentTag, ':' + img.latestTag);
                result = result.split(oldRef).join(newRef);
            }
        });
        return result;
    }

    function openComposeInYmlBuilder(composeRaw, appName) {
        // Close the store tracker panel
        PanelWindow.close('store-tracker-panel');

        // Set editing mode to new-compose so saveYaml creates a new repo
        if (window.repoManager) {
            window.repoManager.currentEditingRepo = 'new-compose';
        }

        // Open YML Builder with the compose content
        YmlBuilder.open(composeRaw, appName);

        // Show the yaml-modal
        var modal = document.getElementById('yaml-modal');
        if (modal) modal.style.display = 'block';
    }

    function openUpdateInYmlBuilder(composeRaw, appName, updatableImages) {
        // Bump image tags in the compose YAML
        var bumped = bumpTagsInYaml(composeRaw, updatableImages);

        // Close store tracker, open YML Builder
        PanelWindow.close('store-tracker-panel');

        if (window.repoManager) {
            window.repoManager.currentEditingRepo = 'new-compose';
        }

        YmlBuilder.open(bumped, 'Update — ' + appName);

        var modal = document.getElementById('yaml-modal');
        if (modal) modal.style.display = 'block';
    }

    function createAppCard(app) {
        // Store compose data for later use
        storeTrackerState.appComposeMap[app.name] = app.composeRaw;

        var iconHtml;
        if (app.icon) {
            iconHtml = '<img class="app-icon" src="' + escapeHtml(app.icon) + '" alt="" onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\'">' +
                '<div class="app-icon-placeholder" style="display:none"><i class="fas fa-cube"></i></div>';
        } else {
            iconHtml = '<div class="app-icon-placeholder"><i class="fas fa-cube"></i></div>';
        }

        var categoryHtml = app.category ? '<span class="app-category">' + escapeHtml(app.category) + '</span>' : '';
        var descHtml = app.description ? '<div class="app-description" title="' + escapeHtml(app.description) + '">' + escapeHtml(app.description) + '</div>' : '';

        var imagesHtml = '';
        var hasUpdate = false;
        app.images.forEach(function(img) {
            var status = img.versionStatus || '';
            var dotClass = status || '';
            var badgeText = '';

            if (status === 'up-to-date') {
                badgeText = 'Up to date';
            } else if (status === 'update-available') {
                badgeText = img.currentTag + ' → ' + (img.latestTag || '?');
                hasUpdate = true;
            } else if (status === 'latest-tag') {
                badgeText = ':latest';
            } else if (status === 'unknown') {
                badgeText = 'Unknown';
            } else if (status === 'checking') {
                badgeText = 'Checking...';
            }

            var displayRef = img.fullRef;
            if (displayRef.length > 40) {
                displayRef = '...' + displayRef.slice(-37);
            }

            imagesHtml += '<div class="image-row">' +
                (status ? '<span class="version-dot ' + dotClass + '"></span>' : '') +
                '<span class="image-name" title="' + escapeHtml(img.fullRef) + '">' + escapeHtml(displayRef) + '</span>' +
                (badgeText ? '<span class="version-badge ' + dotClass + '">' + escapeHtml(badgeText) + '</span>' : '') +
                '</div>';
        });

        // Store updatable images in state map (not DOM attribute — JSON quotes break HTML attributes)
        var updatableImages = app.images.filter(function(img) { return img.versionStatus === 'update-available' && img.latestTag; });
        storeTrackerState.appUpdatableMap[app.name] = updatableImages;

        var buttonsHtml = '<div class="app-card-actions">' +
            '<button class="app-action-btn app-open-compose-btn" data-app-name="' + escapeHtml(app.name) + '">' +
                '<i class="fas fa-file-code"></i> Open Compose</button>' +
            '<button class="app-action-btn app-update-btn' + (hasUpdate ? '' : ' disabled') + '" ' +
                'data-app-name="' + escapeHtml(app.name) + '"' +
                (hasUpdate ? '' : ' disabled') + '>' +
                '<i class="fas fa-arrow-up"></i> Update</button>' +
            '</div>';

        return '<div class="store-app-card">' +
            '<div class="app-card-header">' +
                iconHtml +
                '<div class="app-card-info">' +
                    '<div class="app-name">' + escapeHtml(app.name) + '</div>' +
                    '<div class="app-store-name">' + escapeHtml(app.storeName) + '</div>' +
                '</div>' +
                categoryHtml +
            '</div>' +
            descHtml +
            '<div class="app-images">' + imagesHtml + '</div>' +
            buttonsHtml +
            '</div>';
    }

    function formatTimeAgo(ts) {
        if (!ts) return '';
        var diff = Date.now() - ts;
        var secs = Math.floor(diff / 1000);
        if (secs < 60) return 'just now';
        var mins = Math.floor(secs / 60);
        if (mins < 60) return mins + 'm ago';
        var hrs = Math.floor(mins / 60);
        return hrs + 'h ' + (mins % 60) + 'm ago';
    }

    function updateCheckButton() {
        var btn = document.getElementById('store-check-versions-btn');
        if (!btn) return;
        if (storeTrackerState.versionCheckInProgress) {
            btn.disabled = true;
            btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Checking...';
        } else {
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-tag"></i> Check Versions';
        }

        // Update "Last checked" label
        var label = document.getElementById('store-last-checked');
        if (label) {
            if (storeTrackerState.lastVersionCheck) {
                label.textContent = 'Last checked: ' + formatTimeAgo(storeTrackerState.lastVersionCheck);
                label.style.display = '';
            } else {
                label.style.display = 'none';
            }
        }
    }

    function showAddForm() {
        storeTrackerState.addFormVisible = true;
        var addSection = document.getElementById('store-add-section');
        if (addSection) {
            addSection.innerHTML =
                '<div class="store-add-form">' +
                    '<input type="text" id="store-add-url" placeholder="GitHub repo URL (e.g. https://github.com/user/repo)" />' +
                    '<div class="form-actions">' +
                        '<button class="btn-save" id="store-add-save"><i class="fas fa-check"></i> Add</button>' +
                        '<button class="btn-cancel" id="store-add-cancel"><i class="fas fa-times"></i></button>' +
                    '</div>' +
                '</div>';

            document.getElementById('store-add-save').addEventListener('click', function() {
                var url = document.getElementById('store-add-url').value.trim();
                if (!url) {
                    window.Notify.show('GitHub repo URL is required', 'warning');
                    return;
                }
                addStore(url, function(err) {
                    if (err) {
                        window.Notify.show('Failed to add store: ' + err.message, 'error');
                    } else {
                        hideAddForm();
                        renderSidebar();
                        // Fetch apps for the new store
                        var grid = document.getElementById('store-app-grid');
                        if (grid) grid.innerHTML = '<div class="store-loading"><i class="fas fa-spinner"></i> Loading apps...</div>';
                        loadStoreApps(true, function() {
                            filterStoreApps();
                            renderSidebar();
                            renderStoreApps();
                            checkAllVersions(true);
                        });
                    }
                });
            });

            document.getElementById('store-add-cancel').addEventListener('click', hideAddForm);

            var urlInput = document.getElementById('store-add-url');
            if (urlInput) {
                urlInput.focus();
                // Allow pressing Enter to submit
                urlInput.addEventListener('keydown', function(e) {
                    if (e.key === 'Enter') {
                        document.getElementById('store-add-save').click();
                    }
                });
            }
        }
    }

    function hideAddForm() {
        storeTrackerState.addFormVisible = false;
        var addSection = document.getElementById('store-add-section');
        if (addSection) {
            addSection.innerHTML =
                '<div class="store-sidebar-add">' +
                    '<button id="store-add-btn"><i class="fas fa-plus"></i> Add Store</button>' +
                '</div>';
            document.getElementById('store-add-btn').addEventListener('click', showAddForm);
        }
    }

    // --- Panel lifecycle ---

    function openStoreTracker() {
        var bodyHTML =
            '<div class="store-tracker-sidebar">' +
                '<div class="sidebar-header">Stores</div>' +
                '<div class="store-sidebar-list" id="store-sidebar-list"></div>' +
                '<div id="store-add-section">' +
                    '<div class="store-sidebar-add">' +
                        '<button id="store-add-btn"><i class="fas fa-plus"></i> Add Store</button>' +
                    '</div>' +
                '</div>' +
            '</div>' +
            '<div class="store-tracker-main">' +
                '<div class="store-toolbar">' +
                    '<div class="search-wrapper">' +
                        '<i class="fas fa-search"></i>' +
                        '<input type="text" class="search-input" id="store-search-input" placeholder="Search apps...">' +
                    '</div>' +
                    '<select class="store-sort-select" id="store-sort-select">' +
                        '<option value="name">Sort: Name</option>' +
                        '<option value="category">Sort: Category</option>' +
                        '<option value="store">Sort: Store</option>' +
                        '<option value="status">Sort: Version Status</option>' +
                    '</select>' +
                    '<button class="check-versions-btn" id="store-check-versions-btn">' +
                        '<i class="fas fa-tag"></i> Check Versions' +
                    '</button>' +
                    '<span class="store-last-checked" id="store-last-checked" style="display:none"></span>' +
                '</div>' +
                '<div class="store-app-grid" id="store-app-grid">' +
                    '<div class="store-loading"><i class="fas fa-spinner"></i> Loading...</div>' +
                '</div>' +
            '</div>';

        window.PanelWindow.create({
            id: 'store-tracker-panel',
            title: 'Update Assistant',
            icon: 'fas fa-store',
            bodyHTML: bodyHTML,
            headerButtons: [],
            onClose: function() {
                storeTrackerState.addFormVisible = false;
                storeTrackerState.versionCheckInProgress = false;
            }
        });

        // Bind toolbar events
        var searchInput = document.getElementById('store-search-input');
        if (searchInput) {
            searchInput.addEventListener('input', function() {
                storeTrackerState.searchQuery = searchInput.value;
                filterStoreApps();
                renderStoreApps();
            });
        }

        var sortSelect = document.getElementById('store-sort-select');
        if (sortSelect) {
            sortSelect.addEventListener('change', function() {
                storeTrackerState.sortBy = sortSelect.value;
                filterStoreApps();
                renderStoreApps();
            });
        }

        var checkBtn = document.getElementById('store-check-versions-btn');
        if (checkBtn) {
            checkBtn.addEventListener('click', function() { checkAllVersions(true); });
        }

        var addBtn = document.getElementById('store-add-btn');
        if (addBtn) {
            addBtn.addEventListener('click', showAddForm);
        }

        // Load data and auto-check versions (skip if checked within cache TTL)
        loadStoreConfigs(function() {
            renderSidebar();
            if (storeTrackerState.stores.length > 0) {
                loadStoreApps(false, function() {
                    filterStoreApps();
                    renderSidebar();
                    renderStoreApps();
                    // Only auto-check if no recent check exists
                    var needsCheck = !storeTrackerState.lastVersionCheck ||
                        (Date.now() - storeTrackerState.lastVersionCheck) > VERSION_CHECK_CACHE_MS;
                    if (needsCheck) {
                        checkAllVersions(true);
                    } else {
                        updateCheckButton(); // show "Last checked" label
                    }
                });
            } else {
                renderStoreApps();
            }
        });
    }

    // Attach to RepoManager prototype
    RepoManager.prototype.openStoreTracker = openStoreTracker;
})();
