// Docker Image Manager Panel - extends RepoManager
'use strict';

(function() {
    // State
    var dockerImagesState = {
        groups: [],
        diskUsage: null,
        searchQuery: '',
        loading: false,
        expandedGroups: {}
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

    function loadImages(cb) {
        dockerImagesState.loading = true;
        renderLoading();

        axios.get(getAuthUrl('/api/admin/docker-images'))
            .then(function(resp) {
                dockerImagesState.loading = false;
                if (resp.data.success) {
                    dockerImagesState.groups = resp.data.groups || [];
                    dockerImagesState.diskUsage = resp.data.diskUsage || null;
                }
                if (cb) cb(null);
            })
            .catch(function(err) {
                dockerImagesState.loading = false;
                console.error('Failed to load docker images:', err);
                if (cb) cb(err);
            });
    }

    function deleteImage(imageId, force, cb) {
        var url = '/api/admin/docker-images/' + imageId;
        if (force) url += '?force=true';
        axios.delete(getAuthUrl(url))
            .then(function(resp) {
                if (cb) cb(null, resp.data);
            })
            .catch(function(err) {
                var msg = (err.response && err.response.data && err.response.data.message) || err.message;
                if (cb) cb(new Error(msg));
            });
    }

    function pruneImages(all, cb) {
        var url = '/api/admin/docker-images/prune';
        if (all) url += '?all=true';
        axios.post(getAuthUrl(url))
            .then(function(resp) {
                if (cb) cb(null, resp.data);
            })
            .catch(function(err) {
                var msg = (err.response && err.response.data && err.response.data.message) || err.message;
                if (cb) cb(new Error(msg));
            });
    }

    // --- Filtering ---

    function getFilteredGroups() {
        var query = dockerImagesState.searchQuery.toLowerCase().trim();
        if (!query) return dockerImagesState.groups;

        var filtered = [];
        for (var i = 0; i < dockerImagesState.groups.length; i++) {
            var group = dockerImagesState.groups[i];
            var matchingImages = group.images.filter(function(img) {
                return img.repository.toLowerCase().indexOf(query) !== -1 ||
                       img.tag.toLowerCase().indexOf(query) !== -1 ||
                       img.id.toLowerCase().indexOf(query) !== -1;
            });
            if (matchingImages.length > 0) {
                filtered.push({ repository: group.repository, images: matchingImages });
            }
        }
        return filtered;
    }

    // --- Rendering ---

    function renderLoading() {
        var list = document.getElementById('docker-images-list');
        if (list) {
            list.innerHTML = '<div class="docker-images-loading"><i class="fas fa-spinner"></i> Loading images...</div>';
        }
    }

    function renderSummary() {
        var du = dockerImagesState.diskUsage;
        var summary = document.getElementById('docker-images-summary');
        if (!summary || !du) return;

        var total = du.imageCount || 0;
        var inUsePercent = total > 0 ? Math.round((du.inUseCount / total) * 100) : 0;
        var unusedPercent = total > 0 ? Math.round((du.unusedCount / total) * 100) : 0;
        var danglingPercent = total > 0 ? Math.round((du.danglingCount / total) * 100) : 0;

        // Fix rounding so it adds to 100
        if (total > 0) {
            var sum = inUsePercent + unusedPercent + danglingPercent;
            if (sum !== 100) unusedPercent += (100 - sum);
        }

        summary.innerHTML =
            '<div class="docker-images-stats">' +
                '<div class="di-stat">' +
                    '<span class="di-stat-value">' + total + '</span>' +
                    '<span class="di-stat-label">Total</span>' +
                '</div>' +
                '<div class="di-stat di-stat-inuse">' +
                    '<span class="di-stat-value">' + du.inUseCount + '</span>' +
                    '<span class="di-stat-label">In Use</span>' +
                '</div>' +
                '<div class="di-stat di-stat-unused">' +
                    '<span class="di-stat-value">' + du.unusedCount + '</span>' +
                    '<span class="di-stat-label">Unused</span>' +
                '</div>' +
                '<div class="di-stat di-stat-dangling">' +
                    '<span class="di-stat-value">' + du.danglingCount + '</span>' +
                    '<span class="di-stat-label">Dangling</span>' +
                '</div>' +
                '<div class="di-stat">' +
                    '<span class="di-stat-value">' + escapeHtml(du.totalSize) + '</span>' +
                    '<span class="di-stat-label">Disk Used</span>' +
                '</div>' +
                '<div class="di-stat">' +
                    '<span class="di-stat-value">' + escapeHtml(du.reclaimable) + '</span>' +
                    '<span class="di-stat-label">Reclaimable</span>' +
                '</div>' +
            '</div>' +
            '<div class="docker-images-usage-bar">' +
                '<div class="di-bar-segment di-bar-inuse" style="width:' + inUsePercent + '%"></div>' +
                '<div class="di-bar-segment di-bar-unused" style="width:' + unusedPercent + '%"></div>' +
                '<div class="di-bar-segment di-bar-dangling" style="width:' + danglingPercent + '%"></div>' +
            '</div>';
    }

    function renderImageList() {
        var list = document.getElementById('docker-images-list');
        if (!list) return;

        var groups = getFilteredGroups();
        if (groups.length === 0) {
            list.innerHTML = '<div class="docker-images-empty"><i class="fas fa-check-circle"></i> No images found</div>';
            return;
        }

        var html = '';
        for (var i = 0; i < groups.length; i++) {
            html += renderGroup(groups[i]);
        }
        list.innerHTML = html;

        // Bind group toggle and action events
        bindImageListEvents(list);
    }

    function renderGroup(group) {
        var repoName = group.repository === '<none>' ? 'Dangling / Untagged' : escapeHtml(group.repository);
        var isExpanded = !!dockerImagesState.expandedGroups[group.repository];
        var chevron = isExpanded ? 'fa-chevron-down' : 'fa-chevron-right';

        // Check if any image in group is Yundera-managed
        var hasYundera = group.images.some(function(img) { return img.yunderaManaged; });
        var yunderaBadge = hasYundera ? ' <span class="docker-image-yundera-badge">Yundera</span>' : '';

        // Status summary for header
        var inUse = 0, unused = 0, dangling = 0;
        for (var i = 0; i < group.images.length; i++) {
            if (group.images[i].status === 'in-use') inUse++;
            else if (group.images[i].status === 'unused') unused++;
            else dangling++;
        }

        var statusSummary = '';
        if (inUse > 0) statusSummary += '<span class="di-group-badge di-badge-inuse">' + inUse + ' in use</span>';
        if (unused > 0) statusSummary += '<span class="di-group-badge di-badge-unused">' + unused + ' unused</span>';
        if (dangling > 0) statusSummary += '<span class="di-group-badge di-badge-dangling">' + dangling + ' dangling</span>';

        var html =
            '<div class="docker-image-group" data-repo="' + escapeHtml(group.repository) + '">' +
                '<div class="docker-image-group-header">' +
                    '<div class="di-group-left">' +
                        '<i class="fas ' + chevron + ' di-group-chevron"></i>' +
                        '<span class="di-group-name">' + repoName + '</span>' +
                        yunderaBadge +
                        '<span class="di-group-count">(' + group.images.length + ')</span>' +
                    '</div>' +
                    '<div class="di-group-right">' +
                        statusSummary +
                    '</div>' +
                '</div>';

        if (isExpanded) {
            html += '<div class="docker-image-group-body">';
            // Column headers
            html += '<div class="docker-image-row docker-image-row-header">' +
                '<span class="di-col-status">Status</span>' +
                '<span class="di-col-tag">Tag</span>' +
                '<span class="di-col-id">Image ID</span>' +
                '<span class="di-col-size">Size</span>' +
                '<span class="di-col-created">Created</span>' +
                '<span class="di-col-containers">Containers</span>' +
                '<span class="di-col-actions">Actions</span>' +
            '</div>';
            for (var j = 0; j < group.images.length; j++) {
                html += renderImageRow(group.images[j]);
            }
            html += '</div>';
        }

        html += '</div>';
        return html;
    }

    function renderImageRow(img) {
        var statusClass = 'di-status-' + img.status;
        var statusLabel = img.status === 'in-use' ? 'In Use' : img.status === 'unused' ? 'Unused' : 'Dangling';

        var tagDisplay = img.tag === '<none>' ? '<em>&lt;none&gt;</em>' : escapeHtml(img.tag);

        // Container chips
        var containerHtml = '';
        if (img.containers && img.containers.length > 0) {
            for (var i = 0; i < img.containers.length; i++) {
                var c = img.containers[i];
                var stateClass = c.state === 'running' ? 'di-container-running' : 'di-container-exited';
                containerHtml += '<span class="di-container-chip ' + stateClass + '">' +
                    escapeHtml(c.name) +
                '</span>';
            }
        } else {
            containerHtml = '<span class="di-no-containers">none</span>';
        }

        // Actions
        var deleteBtn = '<button class="di-action-btn di-delete-btn" data-image-id="' + escapeHtml(img.id) + '" data-image-name="' + escapeHtml(img.repository + ':' + img.tag) + '" title="Delete image"><i class="fas fa-trash-alt"></i></button>';

        return '<div class="docker-image-row">' +
            '<span class="di-col-status"><span class="di-status-dot ' + statusClass + '"></span> ' + statusLabel + '</span>' +
            '<span class="di-col-tag">' + tagDisplay + '</span>' +
            '<span class="di-col-id"><code>' + escapeHtml(img.id) + '</code></span>' +
            '<span class="di-col-size">' + escapeHtml(img.size) + '</span>' +
            '<span class="di-col-created">' + escapeHtml(img.createdSince) + '</span>' +
            '<span class="di-col-containers">' + containerHtml + '</span>' +
            '<span class="di-col-actions">' + deleteBtn + '</span>' +
        '</div>';
    }

    function bindImageListEvents(list) {
        // Group header toggle
        var headers = list.querySelectorAll('.docker-image-group-header');
        for (var i = 0; i < headers.length; i++) {
            (function(header) {
                header.addEventListener('click', function() {
                    var group = header.closest('.docker-image-group');
                    var repo = group.getAttribute('data-repo');
                    dockerImagesState.expandedGroups[repo] = !dockerImagesState.expandedGroups[repo];
                    renderImageList();
                });
            })(headers[i]);
        }

        // Delete buttons
        var deleteBtns = list.querySelectorAll('.di-delete-btn');
        for (var j = 0; j < deleteBtns.length; j++) {
            (function(btn) {
                btn.addEventListener('click', function(e) {
                    e.stopPropagation();
                    var imageId = btn.getAttribute('data-image-id');
                    var imageName = btn.getAttribute('data-image-name');
                    handleDeleteImage(imageId, imageName, false);
                });
            })(deleteBtns[j]);
        }
    }

    // --- Actions ---

    function handleDeleteImage(imageId, imageName, force) {
        var msg = force
            ? 'Force delete image ' + imageName + ' (' + imageId + ')?\n\nThis will remove the image even if stopped containers reference it.'
            : 'Delete image ' + imageName + ' (' + imageId + ')?';

        if (!confirm(msg)) return;

        deleteImage(imageId, force, function(err, result) {
            if (err || (result && !result.success)) {
                var errorMsg = (result && result.message) || (err && err.message) || 'Delete failed';
                // Offer force delete on failure
                if (!force && confirm('Delete failed: ' + errorMsg + '\n\nWould you like to force delete this image?')) {
                    handleDeleteImage(imageId, imageName, true);
                    return;
                }
                Notify.show('Failed to delete image: ' + errorMsg, 'error');
                return;
            }
            Notify.show('Image deleted successfully', 'success');
            refreshAll();
        });
    }

    function handlePruneDangling() {
        var du = dockerImagesState.diskUsage;
        var count = du ? du.danglingCount : 0;
        if (count === 0) {
            Notify.show('No dangling images to prune', 'info');
            return;
        }
        if (!confirm('Prune ' + count + ' dangling image(s)?\n\nThis removes all <none>:<none> images.')) return;

        pruneImages(false, function(err, result) {
            if (err || (result && !result.success)) {
                Notify.show('Prune failed: ' + ((result && result.message) || (err && err.message)), 'error');
                return;
            }
            Notify.show(result.message || 'Dangling images pruned', 'success');
            refreshAll();
        });
    }

    function handlePruneAll() {
        if (!confirm('WARNING: This will remove ALL images not currently used by any container.\n\nThis includes unused images that may be needed for future container starts.\n\nAre you sure?')) return;
        if (!confirm('FINAL CONFIRMATION: Remove all unused Docker images?\n\nThis action cannot be undone.')) return;

        pruneImages(true, function(err, result) {
            if (err || (result && !result.success)) {
                Notify.show('Prune failed: ' + ((result && result.message) || (err && err.message)), 'error');
                return;
            }
            Notify.show(result.message || 'Unused images pruned', 'success');
            refreshAll();
        });
    }

    function refreshAll() {
        loadImages(function() {
            renderSummary();
            renderImageList();
        });
    }

    // --- Panel lifecycle ---

    function openDockerImages() {
        var bodyHTML =
            '<div class="docker-images-panel">' +
                '<div class="docker-images-summary" id="docker-images-summary">' +
                    '<div class="docker-images-loading"><i class="fas fa-spinner"></i> Loading...</div>' +
                '</div>' +
                '<div class="docker-images-toolbar">' +
                    '<div class="search-wrapper">' +
                        '<i class="fas fa-search"></i>' +
                        '<input type="text" class="search-input" id="docker-images-search" placeholder="Search images...">' +
                    '</div>' +
                    '<button class="di-toolbar-btn di-prune-dangling-btn" id="docker-prune-dangling-btn">' +
                        '<i class="fas fa-broom"></i> Prune Dangling' +
                    '</button>' +
                    '<button class="di-toolbar-btn di-prune-all-btn" id="docker-prune-all-btn">' +
                        '<i class="fas fa-trash"></i> Prune All Unused' +
                    '</button>' +
                '</div>' +
                '<div class="docker-images-list" id="docker-images-list">' +
                    '<div class="docker-images-loading"><i class="fas fa-spinner"></i> Loading images...</div>' +
                '</div>' +
            '</div>';

        window.PanelWindow.create({
            id: 'docker-images-panel',
            title: 'Docker Images',
            icon: 'fas fa-cubes',
            bodyHTML: bodyHTML,
            headerButtons: [
                {
                    html: '<i class="fas fa-sync-alt"></i> Refresh',
                    onClick: function() {
                        refreshAll();
                    }
                }
            ],
            onClose: function() {
                dockerImagesState.searchQuery = '';
                dockerImagesState.expandedGroups = {};
            }
        });

        // Bind toolbar events
        var searchInput = document.getElementById('docker-images-search');
        if (searchInput) {
            searchInput.addEventListener('input', function() {
                dockerImagesState.searchQuery = searchInput.value;
                renderImageList();
            });
        }

        var pruneDanglingBtn = document.getElementById('docker-prune-dangling-btn');
        if (pruneDanglingBtn) {
            pruneDanglingBtn.addEventListener('click', handlePruneDangling);
        }

        var pruneAllBtn = document.getElementById('docker-prune-all-btn');
        if (pruneAllBtn) {
            pruneAllBtn.addEventListener('click', handlePruneAll);
        }

        // Load data
        loadImages(function() {
            renderSummary();
            renderImageList();
        });
    }

    // Attach to RepoManager prototype
    RepoManager.prototype.openDockerImages = openDockerImages;
})();
