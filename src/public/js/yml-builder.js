// Smart YML Builder - Validation, env var highlighting, CodeMirror 6 integration
'use strict';

(function () {
    // ========== Environment Variable Registry ==========
    // Sourced from compose-processor.ts:554-614 and AppStore/AppStoreLab CONTRIBUTING.md
    const KNOWN_VARS = {
        // Identity
        '$AppID':       { desc: 'Application identifier (from compose name field). Used as Docker project name, CasaOS app ID, and in volume paths.', defaultVal: '<app-name>', category: 'identity' },
        '$APP_ID':      { desc: 'Alias for $AppID.', defaultVal: '<app-name>', category: 'identity' },
        '$name':        { desc: 'Alias for $AppID.', defaultVal: '<app-name>', category: 'identity' },
        // Auth
        '$AUTH_HASH':   { desc: 'Per-app 32-byte hex hash for web UI authentication. Persists across updates. Use with nginx-hash-lock pattern.', defaultVal: '<generated-hash>', category: 'auth' },
        '$API_HASH':    { desc: 'App-specific API token for secure external API calls from the Dev Kit.', defaultVal: '<api-token>', category: 'auth' },
        // User/System
        '$DefaultUserName':      { desc: 'Default admin username.', defaultVal: 'admin', category: 'user' },
        '$DefaultPassword':      { desc: 'Default admin password.', defaultVal: 'casaos', category: 'user' },
        '$APP_DEFAULT_PASSWORD': { desc: 'Auto-generated secure password for the app. Use for admin tokens, DB passwords, etc.', defaultVal: 'casaos', category: 'user' },
        '$PUID':        { desc: 'Process user ID for file permissions. Injected automatically into all services if not present.', defaultVal: '1000', category: 'system' },
        '$PGID':        { desc: 'Process group ID for file permissions. Injected automatically into all services if not present.', defaultVal: '1000', category: 'system' },
        '$TZ':          { desc: 'System timezone.', defaultVal: 'UTC', category: 'system' },
        '$USER':        { desc: 'Current system user.', defaultVal: 'root', category: 'system' },
        // Domain
        '$APP_DOMAIN':  { desc: 'App-specific nsl.sh subdomain (e.g. username.nsl.sh). Used in Caddy labels: caddy_0: appname-${APP_DOMAIN}', defaultVal: '<app-domain>', category: 'domain' },
        '$PUBLIC_IP_DASH':    { desc: 'Public IP with dots/colons replaced by dashes (e.g. 192-168-1-1). Used in Caddy labels for nip.io and sslip.io routing.', defaultVal: '<ip-dash>', category: 'domain' },
        '$APP_PUBLIC_IP':     { desc: 'Public IP address (prefers IPv6). Alias for $PCS_PUBLIC_IP.', defaultVal: '<public-ip>', category: 'domain' },
        '$APP_PUBLIC_IPV4':   { desc: 'Public IPv4 address.', defaultVal: '<public-ipv4>', category: 'domain' },
        '$APP_PUBLIC_IPV6':   { desc: 'Public IPv6 address.', defaultVal: '<public-ipv6>', category: 'domain' },
        '$APP_EMAIL':         { desc: 'Admin email address (admin@DOMAIN).', defaultVal: '<email>', category: 'domain' },
        '$APP_DATA_ROOT':     { desc: 'Data root path. Alias for $DATA_ROOT.', defaultVal: '/DATA', category: 'system' },
        '$APP_NET':           { desc: 'App network name. Defaults to pcs.', defaultVal: 'pcs', category: 'domain' },
        '$REF_DOMAIN':  { desc: 'Full reference domain with app prefix and port. Computed from settings + webui_port.', defaultVal: '<ref-domain>', category: 'domain' },
        '$REF_NET':     { desc: 'Reference network name for mesh routing.', defaultVal: 'pcs', category: 'domain' },
        '$REF_SCHEME':  { desc: 'URL scheme (http or https).', defaultVal: 'http', category: 'domain' },
        '$REF_PORT':    { desc: 'Reference port.', defaultVal: '80', category: 'domain' },
        '$REF_SEPARATOR': { desc: 'Domain separator character.', defaultVal: '-', category: 'domain' },
        '$REF_DEFAULT_PORT': { desc: 'Default reference port.', defaultVal: '80', category: 'domain' },
        '$DATA_ROOT':   { desc: 'Data storage root path. Volume paths starting with /DATA are auto-replaced.', defaultVal: '/DATA', category: 'system' },
        // SMTP
        '$SMTP_HOST':   { desc: 'SMTP mail server hostname.', defaultVal: '<smtp-host>', category: 'smtp' },
        '$SMTP_PORT':   { desc: 'SMTP mail server port.', defaultVal: '<smtp-port>', category: 'smtp' },
    };

    const DEPRECATED_VARS = {
        '$PCS_DOMAIN':           { desc: 'Deprecated PCS platform domain.', replacement: '$APP_DOMAIN' },
        '$PCS_DEFAULT_PASSWORD': { desc: 'Deprecated PCS password variable.', replacement: '$APP_DEFAULT_PASSWORD' },
        '$PCS_DATA_ROOT':        { desc: 'Deprecated PCS data root.', replacement: '$DATA_ROOT' },
        '$PCS_PUBLIC_IP':        { desc: 'Deprecated PCS public IP.', replacement: null },
        '$PCS_PUBLIC_IPV6':      { desc: 'Deprecated PCS public IPv6.', replacement: null },
        '$PCS_EMAIL':            { desc: 'Deprecated PCS email.', replacement: null },
        '$domain':               { desc: 'Deprecated legacy domain variable.', replacement: '$APP_DOMAIN' },
        '$default_pwd':          { desc: 'Deprecated legacy password variable.', replacement: '$APP_DEFAULT_PASSWORD' },
        '$public_ip':            { desc: 'Deprecated legacy public IP.', replacement: null },
    };

    // ========== Comprehensive Validation Checks ==========
    // Based on analysis of yundera-root compose-processor.ts, AppStore CONTRIBUTING.md,
    // AppStoreLab CONTRIBUTING.md, and patterns across 80+ real app compose files.

    function runValidation(parsed) {
        const results = [];
        const isParsed = parsed && typeof parsed === 'object';

        // ===== REQUIRED =====

        // 1. name defined and valid
        results.push(checkName(parsed, isParsed));

        // 2. At least one service
        results.push(checkServices(parsed, isParsed));

        // 3. Valid x-casaos block (main, title, description, architectures, icon, category, index, webui_port)
        results.push(checkXCasaOS(parsed, isParsed));

        // ===== RECOMMENDED =====

        // 4. Valid env variables
        results.push({ id: 'envvars', section: 'recommended', status: 'pass', detail: '',
            label: 'Valid env variables',
            help: 'Template variables like <code>$AppID</code>, <code>$APP_DOMAIN</code> are replaced at deploy time. Deprecated <code>$PCS_*</code> vars still work but should be migrated to <code>$APP_*</code> equivalents. Unknown <code>$VAR</code> patterns are flagged as they may be unintentional.',
            _envScanDeferred: true });

        // 5. Installation tips
        results.push(checkTips(parsed, isParsed));

        // 6. Resource limits (cpu_shares + memory per service)
        results.push(checkResourceLimits(parsed, isParsed));

        // 7. Pinned image tags
        results.push(checkImageTags(parsed, isParsed));

        // 8. Restart policy
        results.push(checkRestartPolicy(parsed, isParsed));

        // 9. Logging configuration
        results.push(checkLogging(parsed, isParsed));

        // 10. Volume paths convention
        results.push(checkVolumePaths(parsed, isParsed));

        // 11. Network configuration (pcs external)
        results.push(checkNetworks(parsed, isParsed));

        // 12. Caddy labels for web apps
        results.push(checkCaddyLabels(parsed, isParsed));

        // ===== OPTIONAL =====

        // 13. pre-install-cmd
        results.push(checkPreInstallCmd(parsed, isParsed));

        // 14. post-install-cmd
        results.push(checkPostInstallCmd(parsed, isParsed));

        // 15. Per-service x-casaos annotations
        results.push(checkServiceAnnotations(parsed, isParsed));

        // 16. Healthchecks
        results.push(checkHealthchecks(parsed, isParsed));

        // 17. Screenshots & thumbnail
        results.push(checkScreenshots(parsed, isParsed));

        // 18. Multi-language support
        results.push(checkMultiLanguage(parsed, isParsed));

        return results;
    }

    // --- Individual check functions ---

    function checkName(parsed, ok) {
        const c = { id: 'name', section: 'required',
            label: '<code>name</code> defined',
            help: 'The top-level <code>name</code> field is the app\'s unique identifier. It becomes the Docker Compose project name, CasaOS app ID, and is used in volume paths. Must be lowercase alphanumeric with hyphens/underscores, starting with a letter or digit.' };
        if (!ok) { c.status = 'fail'; c.detail = 'YAML parse error'; }
        else if (!parsed.name) { c.status = 'fail'; c.detail = 'Missing top-level <code>name</code> field'; }
        else if (!/^[a-z0-9][a-z0-9_-]*$/.test(parsed.name)) { c.status = 'fail'; c.detail = `Invalid: "${parsed.name}" — must match <code>[a-z0-9][a-z0-9_-]*</code>`; }
        else { c.status = 'pass'; c.detail = parsed.name; }
        return c;
    }

    function checkServices(parsed, ok) {
        const c = { id: 'services', section: 'required',
            label: 'Services defined',
            help: 'At least one service must be defined in the <code>services:</code> block. The service named in <code>x-casaos.main</code> receives special processing (hostname injection, network injection, Caddy routing).' };
        if (!ok) { c.status = 'fail'; c.detail = 'YAML parse error'; }
        else if (!parsed.services || typeof parsed.services !== 'object' || Object.keys(parsed.services).length === 0) { c.status = 'fail'; c.detail = 'No services defined'; }
        else { c.status = 'pass'; c.detail = Object.keys(parsed.services).length + ' service(s)'; }
        return c;
    }

    function checkXCasaOS(parsed, ok) {
        const c = { id: 'xcasaos', section: 'required',
            label: 'Valid <code>x-casaos</code>',
            help: 'The <code>x-casaos</code> extension block provides CasaOS app store metadata. Required fields: <code>main</code> (primary service name), <code>title.en_us</code>, <code>description.en_us</code>, <code>architectures</code> (e.g. [amd64, arm64]), <code>icon</code> (CDN URL), <code>category</code>, <code>author</code>, <code>developer</code>, <code>index</code> (web path), <code>webui_port</code>.' };
        if (!ok) { c.status = 'fail'; c.detail = 'YAML parse error'; return c; }
        const xc = parsed['x-casaos'];
        if (!xc) { c.status = 'fail'; c.detail = 'Missing <code>x-casaos</code> block'; return c; }
        const missing = [];
        if (!xc.main) missing.push('main');
        if (!xc.title || !xc.title.en_us) missing.push('title.en_us');
        if (!xc.description || !xc.description.en_us) missing.push('description.en_us');
        if (!xc.architectures || !Array.isArray(xc.architectures) || xc.architectures.length === 0) missing.push('architectures');
        if (!xc.icon) missing.push('icon');
        if (!xc.category) missing.push('category');
        if (!xc.author) missing.push('author');
        if (!xc.developer) missing.push('developer');
        if (xc.index === undefined && xc.index !== '') missing.push('index');
        // webui_port is optional if scheme/hostname/port_map are set (external apps)
        if (xc.webui_port === undefined && !xc.hostname) missing.push('webui_port');
        if (missing.length > 0) { c.status = 'fail'; c.detail = 'Missing: ' + missing.map(m => '<code>' + m + '</code>').join(', '); }
        else { c.status = 'pass'; c.detail = ''; }
        // Also check main matches a service
        if (c.status === 'pass' && parsed.services && !parsed.services[xc.main]) {
            c.status = 'warn'; c.detail = '<code>main: ' + xc.main + '</code> does not match any service name';
        }
        return c;
    }

    function checkTips(parsed, ok) {
        const c = { id: 'tips', section: 'recommended',
            label: 'Installation tips',
            help: '<code>x-casaos.tips.before_install</code> shows users important info before installing (credentials, setup steps, startup warnings). Supports markdown with tables. Template variables like <code>$APP_DEFAULT_PASSWORD</code> are resolved. Should include at minimum <code>en_us</code>. Featured apps need translations (ko_kr, zh_cn, fr_fr, es_es).' };
        if (!ok) { c.status = 'warn'; c.detail = 'YAML parse error'; return c; }
        const xc = parsed['x-casaos'];
        if (!xc || !xc.tips || !xc.tips.before_install) { c.status = 'warn'; c.detail = 'No <code>tips.before_install</code>'; return c; }
        const tips = xc.tips.before_install;
        const hasEnUs = typeof tips === 'object' && (
            (Array.isArray(tips) ? tips.some(t => t && t.en_us) : !!tips.en_us)
        );
        if (!hasEnUs) { c.status = 'warn'; c.detail = 'Missing <code>en_us</code> in tips'; }
        else { c.status = 'pass'; c.detail = ''; }
        return c;
    }

    function checkResourceLimits(parsed, ok) {
        const c = { id: 'resources', section: 'recommended',
            label: 'Resource limits',
            help: 'Every service should have <code>cpu_shares</code> and <code>deploy.resources.limits.memory</code>. CPU share tiers: 100 (system critical), 90 (admin critical), 80 (high priority), 70 (standard app), 50 (supporting DB), 30 (background), 20 (heavy background), 10 (caches/background), 5 (ML/low priority). Memory examples: 256M (light), 512M (standard), 1024M (heavy), 2048M+ (ML/Java).' };
        if (!ok || !parsed.services) { c.status = 'skip'; c.detail = 'No services'; return c; }
        const noCpu = [], noMem = [];
        for (const [name, svc] of Object.entries(parsed.services)) {
            if (!svc || typeof svc !== 'object') continue;
            if (svc.cpu_shares === undefined) noCpu.push(name);
            if (!svc.deploy?.resources?.limits?.memory) noMem.push(name);
        }
        const issues = [];
        if (noCpu.length > 0) issues.push('No <code>cpu_shares</code>: ' + noCpu.map(s => '<code>' + s + '</code>').join(', '));
        if (noMem.length > 0) issues.push('No memory limit: ' + noMem.map(s => '<code>' + s + '</code>').join(', '));
        if (issues.length > 0) { c.status = 'warn'; c.detail = issues.join('<br>'); }
        else { c.status = 'pass'; c.detail = ''; }
        return c;
    }

    function checkImageTags(parsed, ok) {
        const c = { id: 'images', section: 'recommended',
            label: 'Pinned image tags',
            help: 'All container images must use specific version tags — never <code>:latest</code> or untagged. This prevents unexpected breaking changes on pull. Examples: <code>vaultwarden/server:1.35.3</code>, <code>redis:7.4-alpine</code>, <code>postgres:16-alpine</code>. This is a hard requirement per CONTRIBUTING.md.' };
        if (!ok || !parsed.services) { c.status = 'skip'; c.detail = 'No services'; return c; }
        const bad = [];
        for (const [name, svc] of Object.entries(parsed.services)) {
            if (!svc || typeof svc !== 'object' || !svc.image) continue;
            const img = String(svc.image);
            if (img.endsWith(':latest')) { bad.push(name + ' → ' + img); }
            else if (!img.includes(':') && !img.includes('$') && !img.includes('@')) { bad.push(name + ' → ' + img + ' (untagged)'); }
        }
        if (bad.length > 0) { c.status = 'warn'; c.detail = bad.map(s => '<code>' + s + '</code>').join(', '); }
        else { c.status = 'pass'; c.detail = ''; }
        return c;
    }

    function checkRestartPolicy(parsed, ok) {
        const c = { id: 'restart', section: 'recommended',
            label: 'Restart policy',
            help: 'Every service should define <code>restart: unless-stopped</code> (or <code>always</code>) so containers recover from crashes and survive reboots.' };
        if (!ok || !parsed.services) { c.status = 'skip'; c.detail = 'No services'; return c; }
        const missing = [];
        for (const [name, svc] of Object.entries(parsed.services)) {
            if (!svc || typeof svc !== 'object') continue;
            if (!svc.restart) missing.push(name);
        }
        if (missing.length > 0) { c.status = 'warn'; c.detail = 'No restart policy: ' + missing.map(s => '<code>' + s + '</code>').join(', '); }
        else { c.status = 'pass'; c.detail = ''; }
        return c;
    }

    function checkLogging(parsed, ok) {
        const c = { id: 'logging', section: 'recommended',
            label: 'Log rotation',
            help: 'Services should configure logging with <code>json-file</code> driver and <code>max-size</code>/<code>max-file</code> options to prevent disk exhaustion. Recommended: main services 50m/3 files, DBs 10m/2 files, caches 5m/2 files.' };
        if (!ok || !parsed.services) { c.status = 'skip'; c.detail = 'No services'; return c; }
        const missing = [];
        for (const [name, svc] of Object.entries(parsed.services)) {
            if (!svc || typeof svc !== 'object') continue;
            if (!svc.logging || !svc.logging.options || !svc.logging.options['max-size']) missing.push(name);
        }
        if (missing.length > 0) { c.status = 'warn'; c.detail = 'No log rotation: ' + missing.map(s => '<code>' + s + '</code>').join(', '); }
        else { c.status = 'pass'; c.detail = ''; }
        return c;
    }

    function checkVolumePaths(parsed, ok) {
        const c = { id: 'volumes', section: 'recommended',
            label: 'Volume path convention',
            help: 'Persistent data should map to <code>/DATA/AppData/&lt;appname&gt;/</code> subdirectories. User media goes to <code>/DATA/Media/</code>, <code>/DATA/Downloads/</code>, <code>/DATA/Gallery/</code>, <code>/DATA/Documents/</code>. <b>Important:</b> host paths for directories MUST end with <code>/</code> — without it, Docker treats the path as a file, which can break installations. Example: <code>/DATA/AppData/myapp/data/:/container/path/</code>' };
        if (!ok || !parsed.services) { c.status = 'skip'; c.detail = 'No services'; return c; }
        const badPaths = [];
        const missingSlash = [];
        let hasVolumes = false;
        for (const [name, svc] of Object.entries(parsed.services)) {
            if (!svc || !Array.isArray(svc.volumes)) continue;
            for (const vol of svc.volumes) {
                const v = typeof vol === 'string' ? vol : (vol.source || '');
                // Skip named volumes (no leading / or $)
                if (!v.startsWith('/') && !v.startsWith('$')) continue;
                hasVolumes = true;
                const hostPath = v.split(':')[0];
                // Check if it uses /DATA/ or $DATA_ROOT
                if (!hostPath.startsWith('/DATA') && !hostPath.startsWith('$DATA_ROOT') && !hostPath.startsWith('${DATA_ROOT')) {
                    badPaths.push(name + ': ' + hostPath);
                }
                // Check trailing slash: host paths for directories should end with /
                // Skip files with known extensions (e.g. .json, .conf, .yml, .sock)
                const hasExtension = /\.\w{1,5}$/.test(hostPath);
                if (!hasExtension && !hostPath.endsWith('/')) {
                    missingSlash.push(name + ': ' + hostPath);
                }
            }
        }
        if (!hasVolumes) { c.status = 'skip'; c.detail = 'No volumes defined'; return c; }
        const issues = [];
        if (badPaths.length > 0) issues.push('Non-standard: ' + badPaths.slice(0, 3).map(s => '<code>' + s + '</code>').join(', ') + (badPaths.length > 3 ? ' +' + (badPaths.length - 3) + ' more' : ''));
        if (missingSlash.length > 0) issues.push('Missing trailing <code>/</code> (treated as file!): ' + missingSlash.slice(0, 3).map(s => '<code>' + s + '</code>').join(', ') + (missingSlash.length > 3 ? ' +' + (missingSlash.length - 3) + ' more' : ''));
        if (issues.length > 0) { c.status = 'warn'; c.detail = issues.join('<br>'); }
        else { c.status = 'pass'; c.detail = ''; }
        return c;
    }

    function checkNetworks(parsed, ok) {
        const c = { id: 'networks', section: 'recommended',
            label: 'Network configuration',
            help: 'Web-accessible apps should join the <code>pcs</code> external network for Caddy reverse proxy discovery. Define it as: <code>networks: pcs: { external: true }</code>. The system auto-injects this on the main service if REF_NET is set, but explicit definition is clearer.' };
        if (!ok) { c.status = 'warn'; c.detail = 'YAML parse error'; return c; }
        if (!parsed.services) { c.status = 'skip'; c.detail = 'No services'; return c; }
        // Check if pcs network is defined at top level or any service uses it
        const nets = parsed.networks || {};
        const hasPcs = nets.pcs !== undefined;
        let serviceUsesPcs = false;
        if (parsed.services) {
            for (const svc of Object.values(parsed.services)) {
                if (!svc || typeof svc !== 'object') continue;
                if (svc.network_mode === 'host') { c.status = 'pass'; c.detail = 'Host networking'; return c; }
                if (Array.isArray(svc.networks) && svc.networks.includes('pcs')) serviceUsesPcs = true;
                if (svc.networks && typeof svc.networks === 'object' && svc.networks.pcs !== undefined) serviceUsesPcs = true;
            }
        }
        if (hasPcs || serviceUsesPcs) { c.status = 'pass'; c.detail = ''; }
        else { c.status = 'warn'; c.detail = 'No <code>pcs</code> network defined'; }
        return c;
    }

    function checkCaddyLabels(parsed, ok) {
        const c = { id: 'caddy', section: 'recommended',
            label: 'Caddy reverse proxy',
            help: 'For HTTPS access, the main service needs three Caddy label sets: <code>caddy_0</code> (gateway via APP_DOMAIN), <code>caddy_1</code> (nip.io), <code>caddy_2</code> (sslip.io). <code>caddy_0</code> and <code>caddy_1</code> need <code>import: gateway_tls</code>. Use <code>expose:</code> (not <code>ports:</code>). Apps using the external URL pattern (<code>scheme</code>+<code>hostname</code>+<code>port_map</code> in x-casaos) are exempt.' };
        if (!ok || !parsed.services) { c.status = 'skip'; c.detail = 'No services'; return c; }
        const xc = parsed['x-casaos'];
        // Apps using external URL pattern (scheme+hostname+port_map, e.g. Samba doc page, Tailscale admin) skip Caddy
        if (xc && xc.hostname && !xc.webui_port) { c.status = 'pass'; c.detail = 'External URL pattern'; return c; }
        // Check if any service has caddy labels (new or old format)
        let hasNewCaddy = false;
        let hasOldCaddy = false;
        let usesPortsInstead = false;
        for (const [name, svc] of Object.entries(parsed.services)) {
            if (!svc || typeof svc !== 'object') continue;
            const labels = svc.labels;
            if (labels && !Array.isArray(labels) && typeof labels === 'object') {
                if (labels.caddy_0 !== undefined) hasNewCaddy = true;
                if (labels.caddy !== undefined) hasOldCaddy = true;
            }
            if (Array.isArray(labels)) {
                for (const l of labels) {
                    if (typeof l === 'string') {
                        if (l.startsWith('caddy_0=')) hasNewCaddy = true;
                        if (l.startsWith('caddy=')) hasOldCaddy = true;
                    }
                }
            }
            if (svc.ports && Array.isArray(svc.ports) && svc.ports.length > 0) usesPortsInstead = true;
        }
        if (hasNewCaddy) { c.status = 'pass'; c.detail = ''; }
        else if (hasOldCaddy) { c.status = 'warn'; c.detail = 'Uses old Caddy label format. Use the new 3-tier format with <code>caddy_0</code>/<code>caddy_1</code>/<code>caddy_2</code>'; }
        else if (usesPortsInstead) { c.status = 'warn'; c.detail = 'Uses <code>ports:</code> — prefer <code>expose:</code> + Caddy labels for HTTPS routing'; }
        else { c.status = 'warn'; c.detail = 'No Caddy labels found on any service'; }
        return c;
    }

    function checkPreInstallCmd(parsed, ok) {
        const c = { id: 'preinstall', section: 'optional',
            label: '<code>pre-install-cmd</code>',
            help: 'Shell script executed inside the casaos container BEFORE Docker Compose up. Must be idempotent (safe to re-run). <b>Important:</b> template variables like <code>$AppID</code> are NOT replaced — use the literal app name instead. <code>$PUID</code>/<code>$PGID</code> work via shell env vars. Example: <code>mkdir -p /DATA/AppData/myapp/data && chown -R $PUID:$PGID /DATA/AppData/myapp</code>' };
        if (!ok) { c.status = 'skip'; c.detail = ''; return c; }
        const xc = parsed['x-casaos'];
        if (xc && xc['pre-install-cmd']) { c.status = 'pass'; c.detail = ''; }
        else { c.status = 'skip'; c.detail = 'Not defined'; }
        return c;
    }

    function checkPostInstallCmd(parsed, ok) {
        const c = { id: 'postinstall', section: 'optional',
            label: '<code>post-install-cmd</code>',
            help: 'Shell script run AFTER containers start and are confirmed running. Used for runtime configuration (e.g. exec into container for setup). Failures are logged as warnings but do not abort installation.' };
        if (!ok) { c.status = 'skip'; c.detail = ''; return c; }
        const xc = parsed['x-casaos'];
        if (xc && xc['post-install-cmd']) { c.status = 'pass'; c.detail = ''; }
        else { c.status = 'skip'; c.detail = 'Not defined'; }
        return c;
    }

    function checkServiceAnnotations(parsed, ok) {
        const c = { id: 'svc-annotations', section: 'optional',
            label: 'Service annotations',
            help: 'Per-service <code>x-casaos</code> blocks annotate volumes and environment variables for the CasaOS UI. Format: <code>x-casaos: { volumes: [{ container: /path, description: { en_us: "..." } }], envs: [{ container: VAR_NAME, description: { en_us: "..." } }] }</code>' };
        if (!ok || !parsed.services) { c.status = 'skip'; c.detail = 'Not defined'; return c; }
        let hasAnnotations = false;
        for (const svc of Object.values(parsed.services)) {
            if (svc && svc['x-casaos']) { hasAnnotations = true; break; }
        }
        if (hasAnnotations) { c.status = 'pass'; c.detail = ''; }
        else { c.status = 'skip'; c.detail = 'Not defined'; }
        return c;
    }

    function checkHealthchecks(parsed, ok) {
        const c = { id: 'healthchecks', section: 'optional',
            label: 'Healthchecks',
            help: 'Healthchecks let Docker monitor container health. Examples: HTTP check with <code>curl -f http://localhost/</code>, DB check with <code>pg_isready</code>, Redis with <code>redis-cli ping</code>. Set <code>interval</code>, <code>timeout</code>, <code>retries</code>, and <code>start_period</code>.' };
        if (!ok || !parsed.services) { c.status = 'skip'; c.detail = 'Not defined'; return c; }
        let count = 0;
        for (const svc of Object.values(parsed.services)) {
            if (svc && svc.healthcheck) count++;
        }
        if (count > 0) { c.status = 'pass'; c.detail = count + ' service(s)'; }
        else { c.status = 'skip'; c.detail = 'Not defined'; }
        return c;
    }

    function checkScreenshots(parsed, ok) {
        const c = { id: 'screenshots', section: 'optional',
            label: 'Screenshots & thumbnail',
            help: 'Required for featured apps. Screenshots: 1280x720px, at least 3 images. Thumbnail: 784x442px. Icon: 192x192 transparent PNG. Host on JSDelivr CDN: <code>https://cdn.jsdelivr.net/gh/Yundera/AppStore@main/Apps/[AppName]/filename.png</code>' };
        if (!ok) { c.status = 'skip'; c.detail = ''; return c; }
        const xc = parsed['x-casaos'];
        if (!xc) { c.status = 'skip'; c.detail = 'No x-casaos'; return c; }
        const issues = [];
        if (!xc.screenshot_link || !Array.isArray(xc.screenshot_link) || xc.screenshot_link.length === 0) issues.push('screenshots');
        if (!xc.thumbnail) issues.push('thumbnail');
        if (!xc.tagline || !xc.tagline.en_us) issues.push('tagline');
        if (issues.length > 0) { c.status = 'skip'; c.detail = 'Missing: ' + issues.map(s => '<code>' + s + '</code>').join(', '); }
        else { c.status = 'pass'; c.detail = ''; }
        return c;
    }

    function checkMultiLanguage(parsed, ok) {
        const c = { id: 'i18n', section: 'optional',
            label: 'Multi-language',
            help: 'Featured apps need translations in at least: <code>en_us</code>, <code>ko_kr</code>, <code>zh_cn</code>, <code>fr_fr</code>, <code>es_es</code>, <code>de_de</code>. Apply to title, tagline, description, and tips.' };
        if (!ok) { c.status = 'skip'; c.detail = ''; return c; }
        const xc = parsed['x-casaos'];
        if (!xc || !xc.title) { c.status = 'skip'; c.detail = ''; return c; }
        const featuredLangs = ['en_us', 'ko_kr', 'zh_cn', 'fr_fr', 'es_es'];
        const titleLangs = Object.keys(xc.title || {});
        const missing = featuredLangs.filter(l => !titleLangs.includes(l));
        if (missing.length === 0) { c.status = 'pass'; c.detail = titleLangs.length + ' language(s)'; }
        else if (titleLangs.includes('en_us') && titleLangs.length > 1) { c.status = 'pass'; c.detail = titleLangs.length + ' language(s)'; }
        else if (titleLangs.includes('en_us')) { c.status = 'skip'; c.detail = 'Only en_us — add translations for featured status'; }
        else { c.status = 'skip'; c.detail = 'No translations'; }
        return c;
    }

    // ========== Env Var Text Scanner ==========

    function scanEnvVarsFromText(text) {
        const deprecated = [];
        const unknown = [];
        const varRegex = /\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?/g;
        let match;
        const seen = new Set();
        while ((match = varRegex.exec(text)) !== null) {
            const name = match[1];
            const fullVar = '$' + name;
            if (seen.has(name)) continue;
            seen.add(name);
            if (DEPRECATED_VARS[fullVar]) {
                deprecated.push(fullVar);
            } else if (!KNOWN_VARS[fullVar]) {
                if (name.length > 1) {
                    unknown.push(fullVar);
                }
            }
        }
        return { deprecated, unknown };
    }

    // ========== Tooltip System (fixed-position, rendered to body) ==========
    let activeTooltip = null;

    function showTooltip(helpEl, html) {
        hideTooltip();
        const rect = helpEl.getBoundingClientRect();
        const tip = document.createElement('div');
        tip.className = 'yml-tooltip-popup';
        tip.innerHTML = html;
        document.body.appendChild(tip);
        activeTooltip = tip;

        // Position: try right of the (?) button, fall back to left if offscreen
        const tipWidth = 260;
        let left = rect.right + 8;
        let top = rect.top + rect.height / 2;

        // Check if it would overflow the right edge
        if (left + tipWidth > window.innerWidth - 10) {
            left = rect.left - tipWidth - 8;
        }
        // Check if it would overflow the left edge
        if (left < 10) {
            left = 10;
        }

        tip.style.left = left + 'px';
        tip.style.top = top + 'px';
        tip.style.transform = 'translateY(-50%)';

        // Check vertical overflow
        requestAnimationFrame(() => {
            if (!activeTooltip) return;
            const tipRect = tip.getBoundingClientRect();
            if (tipRect.bottom > window.innerHeight - 10) {
                tip.style.top = (window.innerHeight - tipRect.height - 10) + 'px';
                tip.style.transform = 'none';
            }
            if (tipRect.top < 10) {
                tip.style.top = '10px';
                tip.style.transform = 'none';
            }
        });
    }

    function hideTooltip() {
        if (activeTooltip) {
            activeTooltip.remove();
            activeTooltip = null;
        }
    }

    // ========== Insert Button Logic ==========
    const INSERTABLE_CHECKS = new Set([
        'tips', 'resources', 'restart', 'logging', 'networks', 'caddy',
        'preinstall', 'postinstall', 'healthchecks'
    ]);

    function getInsertDisabled(checkId, parsed) {
        if (!parsed || typeof parsed !== 'object') return 'YAML parse error';
        const xc = parsed['x-casaos'];
        const services = parsed.services;
        const hasServices = services && typeof services === 'object' && Object.keys(services).length > 0;

        switch (checkId) {
            case 'tips':
                if (!xc) return 'No x-casaos block';
                if (xc.tips && xc.tips.before_install) return 'Tips already defined';
                return false;
            case 'resources':
                if (!hasServices) return 'No services defined';
                { const missing = Object.entries(services).some(([, s]) => s && typeof s === 'object' && (s.cpu_shares === undefined || !s.deploy?.resources?.limits?.memory));
                  if (!missing) return 'All services have resource limits'; }
                return false;
            case 'restart':
                if (!hasServices) return 'No services defined';
                { const allHave = Object.values(services).every(s => !s || typeof s !== 'object' || s.restart);
                  if (allHave) return 'All services have restart policy'; }
                return false;
            case 'logging':
                if (!hasServices) return 'No services defined';
                { const allHave = Object.values(services).every(s => !s || typeof s !== 'object' || (s.logging && s.logging.options && s.logging.options['max-size']));
                  if (allHave) return 'All services have logging'; }
                return false;
            case 'networks': {
                if (!hasServices) return 'No services defined';
                const nets = parsed.networks || {};
                if (nets.pcs !== undefined) return 'pcs network already defined';
                let serviceUsesPcs = false;
                for (const svc of Object.values(services)) {
                    if (!svc || typeof svc !== 'object') continue;
                    if (svc.network_mode === 'host') return 'Host networking mode';
                    if (Array.isArray(svc.networks) && svc.networks.includes('pcs')) serviceUsesPcs = true;
                    if (svc.networks && typeof svc.networks === 'object' && svc.networks.pcs !== undefined) serviceUsesPcs = true;
                }
                if (serviceUsesPcs) return 'Service already uses pcs network';
                return false;
            }
            case 'caddy': {
                if (!hasServices) return 'No services defined';
                if (!xc || !xc.main) return 'No x-casaos.main defined';
                if (xc.hostname && !xc.webui_port) return 'External URL pattern (no Caddy needed)';
                for (const svc of Object.values(services)) {
                    if (!svc || typeof svc !== 'object') continue;
                    const labels = svc.labels;
                    if (labels && !Array.isArray(labels) && typeof labels === 'object') {
                        if (labels.caddy_0 !== undefined) return 'Caddy labels already defined (new format)';
                    }
                    if (Array.isArray(labels)) {
                        for (const l of labels) {
                            if (typeof l === 'string' && l.startsWith('caddy_0=')) return 'Caddy labels already defined (new format)';
                        }
                    }
                    // Old format detected — allow insert so (+) button can replace it
                }
                return false;
            }
            case 'preinstall':
                if (!xc) return 'No x-casaos block';
                if (xc['pre-install-cmd']) return 'pre-install-cmd already defined';
                return false;
            case 'postinstall':
                if (!xc) return 'No x-casaos block';
                if (xc['post-install-cmd']) return 'post-install-cmd already defined';
                return false;
            case 'healthchecks':
                if (!hasServices) return 'No services defined';
                { const allHave = Object.values(services).every(s => !s || typeof s !== 'object' || s.healthcheck);
                  if (allHave) return 'All services have healthchecks'; }
                return false;
            default:
                return 'Not insertable';
        }
    }

    // --- Text position helpers ---

    /**
     * Find the character position at the end of a root-level YAML block.
     * Scans from the line starting with `blockName:` until the next root-level key or EOF.
     * Returns the char position at the end of the last line of the block.
     */
    function findBlockEndPos(text, blockName) {
        const lines = text.split('\n');
        let inBlock = false;
        let lastContentLineEnd = -1;

        let charPos = 0;
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const lineEnd = charPos + line.length; // position at end of this line (before \n)

            if (!inBlock) {
                // Match root-level block start: blockName: (with optional trailing content)
                const trimmed = line.replace(/^\s*/, '');
                const indent = line.length - trimmed.length;
                if (indent === 0 && trimmed.startsWith(blockName + ':')) {
                    inBlock = true;
                    lastContentLineEnd = lineEnd;
                }
            } else {
                const trimmed = line.trim();
                // Skip blank and comment-only lines
                if (trimmed === '' || trimmed.startsWith('#')) {
                    charPos = lineEnd + 1;
                    continue;
                }
                // Check indent: if at column 0, it's a new root block
                const lineIndent = line.length - line.trimStart().length;
                if (lineIndent === 0) {
                    // End of block found
                    break;
                }
                lastContentLineEnd = lineEnd;
            }
            charPos = lineEnd + 1;
        }

        if (lastContentLineEnd === -1) return text.length;
        return lastContentLineEnd;
    }

    /**
     * Find the character position at the end of a specific service block within services:.
     * Returns the char position at the end of the last line of the service block.
     */
    function findServiceBlockEndPos(text, serviceName) {
        const lines = text.split('\n');
        let inServices = false;
        let inTargetService = false;
        let serviceIndent = -1;
        let lastContentLineEnd = -1;

        let charPos = 0;
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const lineEnd = charPos + line.length;
            const trimmed = line.trim();

            if (!inServices) {
                if (line.match(/^services\s*:/)) {
                    inServices = true;
                }
                charPos = lineEnd + 1;
                continue;
            }

            // Inside services block
            if (trimmed === '' || trimmed.startsWith('#')) {
                charPos = lineEnd + 1;
                continue;
            }

            const lineIndent = line.length - line.trimStart().length;

            // Root-level key exits services
            if (lineIndent === 0) break;

            if (!inTargetService) {
                // Look for service name at indent 2
                if (lineIndent === 2 && trimmed.startsWith(serviceName + ':')) {
                    inTargetService = true;
                    serviceIndent = lineIndent;
                    lastContentLineEnd = lineEnd;
                }
            } else {
                // We're inside the target service
                if (lineIndent <= serviceIndent) {
                    // New service or end of services
                    break;
                }
                lastContentLineEnd = lineEnd;
            }
            charPos = lineEnd + 1;
        }

        return lastContentLineEnd === -1 ? text.length : lastContentLineEnd;
    }

    /**
     * Find a specific key's block within a service.
     * Returns { found, endPos } where endPos is the char position at end of that key's block.
     * If not found, returns { found: false, endPos: -1 }.
     */
    function findKeyInService(text, serviceName, keyName) {
        const lines = text.split('\n');
        let inServices = false;
        let inTargetService = false;
        let serviceIndent = -1;
        let inKey = false;
        let keyIndent = -1;
        let lastKeyLineEnd = -1;

        let charPos = 0;
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const lineEnd = charPos + line.length;
            const trimmed = line.trim();

            if (!inServices) {
                if (line.match(/^services\s*:/)) inServices = true;
                charPos = lineEnd + 1;
                continue;
            }

            if (trimmed === '' || trimmed.startsWith('#')) {
                charPos = lineEnd + 1;
                continue;
            }

            const lineIndent = line.length - line.trimStart().length;
            if (lineIndent === 0) break; // left services

            if (!inTargetService) {
                if (lineIndent === 2 && trimmed.startsWith(serviceName + ':')) {
                    inTargetService = true;
                    serviceIndent = lineIndent;
                }
                charPos = lineEnd + 1;
                continue;
            }

            // Inside target service
            if (lineIndent <= serviceIndent) break; // left service

            if (!inKey) {
                // Look for the key at service-child indent (4)
                if (lineIndent === 4 && trimmed.startsWith(keyName + ':')) {
                    inKey = true;
                    keyIndent = lineIndent;
                    lastKeyLineEnd = lineEnd;
                }
            } else {
                // Inside the key's block — stop at same or lower indent
                if (lineIndent <= keyIndent) break;
                lastKeyLineEnd = lineEnd;
            }

            charPos = lineEnd + 1;
        }

        return inKey ? { found: true, endPos: lastKeyLineEnd } : { found: false, endPos: -1 };
    }

    function handleInsert(checkId) {
        const text = getValue();
        let parsed;
        try { parsed = jsyaml.load(text); } catch (e) { return; }

        const result = buildInsertion(checkId, parsed, text);
        if (!result) return;

        // Handle fullText replacement (used when old labels are removed and replaced)
        if (result.fullText) {
            if (cmView) {
                cmView.dispatch({ changes: { from: 0, to: text.length, insert: result.fullText } });
            } else {
                const ta = document.querySelector('.yml-fallback-editor');
                if (ta) {
                    ta.value = result.fullText;
                    ta.dispatchEvent(new Event('input'));
                }
            }
        } else if (result.changes && result.changes.length > 0) {
            if (cmView) {
                cmView.dispatch({ changes: result.changes });
            } else {
                // Fallback textarea insertion
                const ta = document.querySelector('.yml-fallback-editor');
                if (ta) {
                    let newText = text;
                    // Apply changes in reverse position order to preserve earlier positions
                    const sorted = result.changes.slice().sort((a, b) => b.from - a.from);
                    for (const change of sorted) {
                        const before = newText.substring(0, change.from);
                        const after = newText.substring(change.to !== undefined ? change.to : change.from);
                        newText = before + change.insert + after;
                    }
                    ta.value = newText;
                    ta.dispatchEvent(new Event('input'));
                }
            }
        } else {
            return;
        }

        // Visual feedback
        const el = document.querySelector('[data-insert-id="' + checkId + '"]');
        if (el) {
            el.classList.add('inserted');
            setTimeout(() => el.classList.remove('inserted'), 600);
        }
    }

    function buildInsertion(checkId, parsed, text) {
        const services = parsed.services || {};
        const xc = parsed['x-casaos'];
        const appName = parsed.name || 'myapp';

        switch (checkId) {
            case 'tips': {
                const pos = findBlockEndPos(text, 'x-casaos');
                const snippet = '\n  tips:\n    before_install:\n      en_us: |\n' +
                    '        Default credentials:\n' +
                    '        | Username | Password |\n' +
                    '        |----------|----------|\n' +
                    '        | admin    | $APP_DEFAULT_PASSWORD |';
                return { changes: [{ from: pos, insert: snippet }] };
            }

            case 'restart': {
                const changes = [];
                for (const [name, svc] of Object.entries(services)) {
                    if (!svc || typeof svc !== 'object' || svc.restart) continue;
                    const pos = findServiceBlockEndPos(text, name);
                    changes.push({ from: pos, insert: '\n    restart: unless-stopped' });
                }
                return { changes };
            }

            case 'logging': {
                const changes = [];
                for (const [name, svc] of Object.entries(services)) {
                    if (!svc || typeof svc !== 'object') continue;
                    if (svc.logging && svc.logging.options && svc.logging.options['max-size']) continue;
                    const pos = findServiceBlockEndPos(text, name);
                    const snippet = '\n    logging:\n      driver: json-file\n      options:\n        max-size: "50m"\n        max-file: "3"';
                    changes.push({ from: pos, insert: snippet });
                }
                return { changes };
            }

            case 'resources': {
                const changes = [];
                for (const [name, svc] of Object.entries(services)) {
                    if (!svc || typeof svc !== 'object') continue;
                    let snippet = '';
                    if (svc.cpu_shares === undefined) {
                        snippet += '\n    cpu_shares: 70';
                    }
                    if (!svc.deploy?.resources?.limits?.memory) {
                        snippet += '\n    deploy:\n      resources:\n        limits:\n          memory: 512M';
                    }
                    if (snippet) {
                        const pos = findServiceBlockEndPos(text, name);
                        changes.push({ from: pos, insert: snippet });
                    }
                }
                return { changes };
            }

            case 'networks': {
                const changes = [];
                // Add root-level networks block
                const hasNetworksBlock = text.match(/^networks\s*:/m);
                if (!hasNetworksBlock) {
                    const endPos = text.length;
                    changes.push({ from: endPos, insert: '\nnetworks:\n  pcs:\n    name: pcs\n    external: true\n' });
                }
                return { changes };
            }

            case 'caddy': {
                const mainService = xc && xc.main;
                if (!mainService || !services[mainService]) return null;
                const svc = services[mainService];
                const changes = [];

                // Determine port: existing expose/ports > webui_port > placeholder
                let port = 'PORT';
                const hasExpose = Array.isArray(svc.expose) && svc.expose.length > 0;
                if (hasExpose) {
                    port = String(svc.expose[0]).replace(/['"]/g, '');
                } else if (Array.isArray(svc.ports) && svc.ports.length > 0) {
                    const p = String(svc.ports[0]);
                    const parts = p.split(':');
                    port = parts[parts.length - 1].replace(/\/.*$/, '').trim();
                } else if (xc && xc.webui_port) {
                    port = String(xc.webui_port);
                }

                // New 3-tier Caddy label template (map style)
                const caddyLabels =
                    '\n      caddy_0: ' + appName + '-${APP_DOMAIN}' +
                    '\n      caddy_0.import: gateway_tls' +
                    '\n      caddy_0.reverse_proxy: "{{upstreams ' + port + '}}"' +
                    '\n      caddy_1: ' + appName + '-${PUBLIC_IP_DASH}.nip.io' +
                    '\n      caddy_1.import: gateway_tls' +
                    '\n      caddy_1.reverse_proxy: "{{upstreams ' + port + '}}"' +
                    '\n      caddy_2: ' + appName + '-${PUBLIC_IP_DASH}.sslip.io' +
                    '\n      caddy_2.reverse_proxy: "{{upstreams ' + port + '}}"';

                // Check for old caddy labels that need to be removed
                const hasOldCaddy = svc.labels && !Array.isArray(svc.labels) && typeof svc.labels === 'object' &&
                    (svc.labels.caddy !== undefined || Object.keys(svc.labels).some(k => k === 'caddy' || (k.startsWith('caddy.') && !k.startsWith('caddy_'))));
                const hasOldCaddyArray = Array.isArray(svc.labels) &&
                    svc.labels.some(l => typeof l === 'string' && (l.startsWith('caddy=') || l.startsWith('caddy.')));

                const labelsInfo = findKeyInService(text, mainService, 'labels');
                const exposeInfo = findKeyInService(text, mainService, 'expose');
                const hasLabels = svc.labels && (Array.isArray(svc.labels) ? svc.labels.length > 0 : Object.keys(svc.labels).length > 0);

                if (hasLabels && (hasOldCaddy || hasOldCaddyArray)) {
                    // Old caddy labels exist — remove them and replace with new 3-tier format
                    // Remove old caddy lines from the text and insert new ones
                    let modifiedText = text;
                    const lines = text.split('\n');
                    const linesToRemove = [];
                    for (let i = 0; i < lines.length; i++) {
                        const trimmed = lines[i].trim();
                        // Match old format: caddy: ..., caddy.xxx: ..., - caddy=..., - caddy.xxx=...
                        if (trimmed.match(/^-?\s*"?caddy[.=]/) || trimmed.match(/^caddy[.:]\s/) || trimmed === 'caddy:' ||
                            (trimmed.startsWith('caddy:') && !trimmed.startsWith('caddy_'))) {
                            // But don't match caddy_0, caddy_1, caddy_2
                            if (!trimmed.match(/^-?\s*"?caddy_\d/)) {
                                linesToRemove.push(i);
                            }
                        }
                    }
                    // Remove lines in reverse order and track position adjustment
                    if (linesToRemove.length > 0) {
                        const newLines = lines.filter((_, i) => !linesToRemove.includes(i));
                        modifiedText = newLines.join('\n');
                        // Re-find labels position in modified text
                        const newLabelsInfo = findKeyInService(modifiedText, mainService, 'labels');
                        const change = { from: newLabelsInfo.endPos, insert: caddyLabels };
                        // Return with full text replacement since we modified lines
                        return { fullText: modifiedText.slice(0, newLabelsInfo.endPos) + caddyLabels + modifiedText.slice(newLabelsInfo.endPos) };
                    }
                    // Fallback: just append
                    changes.push({ from: labelsInfo.endPos, insert: caddyLabels });
                } else if (hasLabels) {
                    // Labels exist but no old caddy — append new caddy entries
                    changes.push({ from: labelsInfo.endPos, insert: caddyLabels });
                    if (!hasExpose) {
                        const serviceEnd = findServiceBlockEndPos(text, mainService);
                        changes.push({ from: serviceEnd, insert: '\n    expose:\n      - "' + port + '"' });
                    }
                } else if (hasExpose) {
                    // No labels, but expose exists — insert labels right after expose block
                    const labelsSnippet = '\n    labels:' + caddyLabels;
                    changes.push({ from: exposeInfo.endPos, insert: labelsSnippet });
                } else {
                    // Neither labels nor expose — add both at service end
                    const serviceEnd = findServiceBlockEndPos(text, mainService);
                    const snippet = '\n    expose:\n      - "' + port + '"\n    labels:' + caddyLabels;
                    changes.push({ from: serviceEnd, insert: snippet });
                }

                // Add expose if labels existed but expose didn't (and not already handled)
                if (hasLabels && !hasExpose && !(hasOldCaddy || hasOldCaddyArray)) {
                    const serviceEnd = findServiceBlockEndPos(text, mainService);
                    changes.push({ from: serviceEnd, insert: '\n    expose:\n      - "' + port + '"' });
                }

                return { changes };
            }

            case 'preinstall': {
                const pos = findBlockEndPos(text, 'x-casaos');
                const snippet = '\n  pre-install-cmd: |\n' +
                    '    mkdir -p /DATA/AppData/' + appName + '/data/\n' +
                    '    chown -R $PUID:$PGID /DATA/AppData/' + appName + '/';
                return { changes: [{ from: pos, insert: snippet }] };
            }

            case 'postinstall': {
                const pos = findBlockEndPos(text, 'x-casaos');
                const snippet = '\n  post-install-cmd: |\n    echo "Post-install setup complete"';
                return { changes: [{ from: pos, insert: snippet }] };
            }

            case 'healthchecks': {
                const changes = [];
                for (const [name, svc] of Object.entries(services)) {
                    if (!svc || typeof svc !== 'object' || svc.healthcheck) continue;
                    const pos = findServiceBlockEndPos(text, name);
                    const port = '8080';
                    const snippet = '\n    healthcheck:\n      test: ["CMD", "curl", "-f", "http://localhost:' + port + '/"]\n      interval: 30s\n      timeout: 10s\n      retries: 3\n      start_period: 30s';
                    changes.push({ from: pos, insert: snippet });
                }
                return { changes };
            }

            default:
                return null;
        }
    }

    // ========== Sidebar Rendering ==========
    function renderSidebar(results, envScan, parsed) {
        const sidebar = document.getElementById('yml-sidebar-content');
        if (!sidebar) return;

        // Update env check with text-based scan
        const envCheck = results.find(r => r.id === 'envvars');
        if (envCheck) {
            const issues = [];
            if (envScan.deprecated.length > 0) {
                issues.push('Deprecated: ' + envScan.deprecated.map(v => '<code>' + v + '</code>').join(', '));
            }
            if (envScan.unknown.length > 0) {
                issues.push('Unknown: ' + envScan.unknown.map(v => '<code>' + v + '</code>').join(', '));
            }
            if (issues.length > 0) { envCheck.status = 'warn'; envCheck.detail = issues.join('<br>'); }
            else { envCheck.status = 'pass'; envCheck.detail = ''; }
        }

        const sections = {
            required: { title: 'Required', items: [] },
            recommended: { title: 'Recommended', items: [] },
            optional: { title: 'Optional', items: [] },
        };

        for (const r of results) {
            if (sections[r.section]) sections[r.section].items.push(r);
        }

        let html = '';
        for (const [key, sec] of Object.entries(sections)) {
            if (sec.items.length === 0) continue;
            html += '<div class="yml-sidebar-section">';
            html += '<div class="yml-sidebar-section-title">' + sec.title + '</div>';
            for (const item of sec.items) {
                let icon = '';
                switch (item.status) {
                    case 'pass': icon = '<i class="fas fa-check"></i>'; break;
                    case 'warn': icon = '<i class="fas fa-exclamation-triangle"></i>'; break;
                    case 'fail': icon = '<i class="fas fa-times-circle"></i>'; break;
                    case 'skip': icon = '<i class="fas fa-minus-circle"></i>'; break;
                }
                html += '<div class="yml-check-item">';
                html += '<div class="yml-check-icon ' + item.status + '">' + icon + '</div>';
                html += '<div class="yml-check-body">';
                let insertBtn = '';
                if (INSERTABLE_CHECKS.has(item.id)) {
                    const disabled = getInsertDisabled(item.id, parsed);
                    insertBtn = '<span class="yml-check-insert' + (disabled ? ' disabled' : '') + '" data-insert-id="' + item.id + '" title="' + (disabled ? disabled : 'Insert template') + '"><i class="fas fa-plus"></i></span> ';
                }
                html += '<div class="yml-check-label">' + item.label + ' ' + insertBtn + '<span class="yml-check-help" data-help-id="' + item.id + '">?</span></div>';
                if (item.detail) {
                    html += '<div class="yml-check-detail">' + item.detail + '</div>';
                }
                html += '</div></div>';
            }
            html += '</div>';
        }

        sidebar.innerHTML = html;

        // Bind tooltip events via event delegation
        sidebar.querySelectorAll('.yml-check-help').forEach(el => {
            const id = el.getAttribute('data-help-id');
            const item = results.find(r => r.id === id);
            if (!item) return;
            el.addEventListener('mouseenter', () => showTooltip(el, item.help));
            el.addEventListener('mouseleave', hideTooltip);
        });

        // Bind insert button click events
        sidebar.querySelectorAll('.yml-check-insert:not(.disabled)').forEach(el => {
            const id = el.getAttribute('data-insert-id');
            el.addEventListener('click', (e) => {
                e.stopPropagation();
                handleInsert(id);
            });
        });

        updateFooterSummary(results);
    }

    function updateFooterSummary(results) {
        const summary = document.getElementById('yml-validation-summary');
        if (!summary) return;
        let fails = 0, warns = 0, passes = 0;
        for (const r of results) {
            if (r.status === 'fail') fails++;
            else if (r.status === 'warn') warns++;
            else if (r.status === 'pass') passes++;
        }
        let html = '';
        if (fails > 0) html += '<span class="summary-item has-fail"><i class="fas fa-times-circle"></i> ' + fails + ' error' + (fails > 1 ? 's' : '') + '</span>';
        if (warns > 0) html += '<span class="summary-item has-warn"><i class="fas fa-exclamation-triangle"></i> ' + warns + ' warning' + (warns > 1 ? 's' : '') + '</span>';
        html += '<span class="summary-item"><i class="fas fa-check" style="color:var(--success-color)"></i> ' + passes + ' passed</span>';
        summary.innerHTML = html;
    }

    // ========== Editor Integration ==========
    let cmEditor = null;
    let cmView = null;
    let cmTheme = null; // track theme at editor creation time
    let validationTimer = null;
    let lastResults = [];
    let lastEnvScan = { deprecated: [], unknown: [] };
    let lastParsed = null;

    function initEditor(content) {
        const container = document.getElementById('yml-editor-container');
        if (!container) return;

        const ta = document.getElementById('yaml-textarea');

        if (window.CM6) {
            initCM6Editor(container, content, ta);
        } else {
            initFallbackEditor(container, content, ta);
        }
    }

    function initCM6Editor(container, content, hiddenTextarea) {
        const CM = window.CM6;
        container.innerHTML = '';

        const isDark = document.documentElement.dataset.theme === 'dark' || document.documentElement.dataset.theme === 'midnight';
        cmTheme = document.documentElement.dataset.theme || 'light';

        const extraKeybindings = [];
        // Add Ctrl+Shift+Z as alternative redo keybinding
        if (CM.keymap && CM.redo) {
            extraKeybindings.push(CM.keymap.of([{ key: 'Mod-Shift-z', run: CM.redo }]));
        }
        const extensions = [
            CM.basicSetup,
            CM.yaml(),
            ...extraKeybindings,
            CM.EditorView.updateListener.of(update => {
                if (update.docChanged) {
                    const text = update.state.doc.toString();
                    if (hiddenTextarea) hiddenTextarea.value = text;
                    scheduleValidation(text);
                }
                const cursor = update.state.selection.main.head;
                const line = update.state.doc.lineAt(cursor);
                const cursorEl = document.getElementById('yml-cursor-pos');
                if (cursorEl) cursorEl.textContent = 'Ln ' + line.number + ', Col ' + (cursor - line.from + 1);
            }),
            // Apply oneDark theme for dark/midnight modes, light theme otherwise
            ...(isDark && CM.oneDark ? [CM.oneDark] : []),
            CM.EditorView.theme({
                '&': { height: '100%' },
                '.cm-scroller': { overflow: 'auto', fontFamily: "'Courier New', Courier, monospace", fontSize: '13px' },
                '.cm-content': { caretColor: 'var(--text-primary)' },
                '.cm-gutters': { background: 'var(--bg-primary)', color: 'var(--text-tertiary)', border: 'none', borderRight: '1px solid var(--border-color)' },
                '.cm-activeLineGutter': { background: 'var(--bg-surface)' },
                '.cm-activeLine': { background: 'rgba(37, 99, 235, 0.05)' },
                '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': { background: 'rgba(37, 99, 235, 0.15) !important' },
                '.cm-cursor': { borderLeftColor: 'var(--text-primary)' },
            }, { dark: isDark }),
            // Env var highlighting
            CM.ViewPlugin.fromClass(class {
                constructor(view) { this.decorations = this.buildDecorations(view); }
                update(update) { if (update.docChanged || update.viewportChanged) this.decorations = this.buildDecorations(update.view); }
                buildDecorations(view) {
                    const builder = new CM.RangeSetBuilder();
                    const varRegex = /\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?/g;
                    for (const { from, to } of view.visibleRanges) {
                        const text = view.state.doc.sliceString(from, to);
                        let match;
                        while ((match = varRegex.exec(text)) !== null) {
                            const varName = '$' + match[1];
                            const start = from + match.index;
                            const end = start + match[0].length;
                            let cls = 'yml-env-unknown';
                            if (KNOWN_VARS[varName]) cls = 'yml-env-known';
                            else if (DEPRECATED_VARS[varName]) cls = 'yml-env-deprecated';
                            builder.add(start, end, CM.Decoration.mark({ class: cls }));
                        }
                    }
                    return builder.finish();
                }
            }, { decorations: v => v.decorations }),
            // :latest and untagged image highlighting
            CM.ViewPlugin.fromClass(class {
                constructor(view) { this.decorations = this.buildDecorations(view); }
                update(update) { if (update.docChanged || update.viewportChanged) this.decorations = this.buildDecorations(update.view); }
                buildDecorations(view) {
                    const builder = new CM.RangeSetBuilder();
                    // Match image: lines with :latest or no tag
                    const imgRegex = /^(\s*image:\s*)(\S+)/gm;
                    for (const { from, to } of view.visibleRanges) {
                        const text = view.state.doc.sliceString(from, to);
                        let match;
                        while ((match = imgRegex.exec(text)) !== null) {
                            const imgValue = match[2];
                            // Strip surrounding quotes
                            const img = imgValue.replace(/^['"]|['"]$/g, '');
                            if (img.endsWith(':latest') || (!img.includes(':') && !img.includes('$') && !img.includes('@'))) {
                                const start = from + match.index + match[1].length;
                                const end = start + match[2].length;
                                builder.add(start, end, CM.Decoration.mark({ class: 'yml-image-warn' }));
                            }
                        }
                    }
                    return builder.finish();
                }
            }, { decorations: v => v.decorations }),
            // Hover tooltips for env vars
            CM.hoverTooltip((view, pos) => {
                const line = view.state.doc.lineAt(pos);
                const lineText = line.text;
                const varRegex = /\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?/g;
                let match;
                while ((match = varRegex.exec(lineText)) !== null) {
                    const start = line.from + match.index;
                    const end = start + match[0].length;
                    if (pos >= start && pos <= end) {
                        const varName = '$' + match[1];
                        const known = KNOWN_VARS[varName];
                        const dep = DEPRECATED_VARS[varName];
                        return {
                            pos: start, end: end, above: true,
                            create() {
                                const dom = document.createElement('div');
                                dom.className = 'yml-hover-tooltip';
                                let html = '<div class="tooltip-label">' + varName + '</div>';
                                if (known) {
                                    html += '<div class="tooltip-value">' + known.desc + '</div>';
                                    if (known.defaultVal) html += '<div class="tooltip-value" style="margin-top:2px;opacity:0.7">Default: ' + known.defaultVal + '</div>';
                                } else if (dep) {
                                    html += '<div class="tooltip-value">' + dep.desc + '</div>';
                                    if (dep.replacement) html += '<div class="tooltip-deprecated">Use ' + dep.replacement + ' instead</div>';
                                } else {
                                    html += '<div class="tooltip-value" style="color:#fbbf24">Unrecognized template variable — will not be replaced at deploy time</div>';
                                }
                                dom.innerHTML = html;
                                return { dom };
                            }
                        };
                    }
                }
                return null;
            }),
            // YAML linting
            CM.linter(view => {
                const text = view.state.doc.toString();
                const diagnostics = [];
                try {
                    jsyaml.load(text);
                } catch (e) {
                    if (e.mark) {
                        const lineNum = Math.min(e.mark.line + 1, view.state.doc.lines);
                        const from = view.state.doc.line(lineNum).from;
                        diagnostics.push({ from: from, to: from + 1, severity: 'error', message: e.reason || e.message });
                    }
                }
                return diagnostics;
            }),
            CM.lintGutter(),
        ];

        cmView = new CM.EditorView({
            doc: content || '',
            extensions,
            parent: container,
        });
        cmEditor = cmView;
    }

    function initFallbackEditor(container, content, hiddenTextarea) {
        container.innerHTML = '';
        const ta = document.createElement('textarea');
        ta.className = 'yml-fallback-editor';
        ta.placeholder = 'Enter Docker Compose YAML...';
        ta.value = content || '';
        ta.spellcheck = false;
        ta.addEventListener('input', () => {
            if (hiddenTextarea) hiddenTextarea.value = ta.value;
            scheduleValidation(ta.value);
            const lines = ta.value.substring(0, ta.selectionStart).split('\n');
            const cursorEl = document.getElementById('yml-cursor-pos');
            if (cursorEl) cursorEl.textContent = 'Ln ' + lines.length + ', Col ' + (lines[lines.length - 1].length + 1);
        });
        container.appendChild(ta);
        cmEditor = null;
        cmView = null;
    }

    function scheduleValidation(text) {
        clearTimeout(validationTimer);
        validationTimer = setTimeout(() => { doValidation(text); }, 300);
    }

    function doValidation(text) {
        let parsed = null;
        const statusDot = document.querySelector('.yml-parse-status .status-dot');
        const statusText = document.querySelector('.yml-parse-status .status-text');

        try {
            parsed = jsyaml.load(text);
            if (statusDot) statusDot.classList.remove('error');
            if (statusText) statusText.textContent = 'Valid YAML';
        } catch (e) {
            if (statusDot) statusDot.classList.add('error');
            if (statusText) statusText.textContent = e.reason || 'Parse error';
        }

        lastParsed = parsed;
        lastResults = runValidation(parsed);
        lastEnvScan = scanEnvVarsFromText(text);
        renderSidebar(lastResults, lastEnvScan, parsed);
    }

    // ========== Env Preview ==========
    function toggleEnvPreview() {
        const overlay = document.getElementById('yml-env-preview-overlay');
        const toggle = document.getElementById('yml-env-toggle');
        if (!overlay || !toggle) return;

        const isActive = overlay.classList.contains('active');
        if (isActive) {
            overlay.classList.remove('active');
            toggle.classList.remove('active');
        } else {
            const text = getValue();
            const resolved = resolveEnvVars(text);
            const pre = overlay.querySelector('pre');
            if (pre) pre.textContent = resolved;
            overlay.classList.add('active');
            toggle.classList.add('active');
        }
    }

    function resolveEnvVars(text) {
        let result = text;
        const all = {};
        for (const [k, v] of Object.entries(KNOWN_VARS)) { all[k] = v.defaultVal || '<' + k.substring(1) + '>'; }
        for (const [k, v] of Object.entries(DEPRECATED_VARS)) { all[k] = v.replacement ? (KNOWN_VARS[v.replacement]?.defaultVal || '<deprecated>') : '<deprecated>'; }

        for (const [varName, value] of Object.entries(all)) {
            const name = varName.substring(1);
            const regex = new RegExp('\\$\\{?' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\}?', 'g');
            result = result.replace(regex, value);
        }
        return result;
    }

    function resetPreview() {
        const overlay = document.getElementById('yml-env-preview-overlay');
        const toggle = document.getElementById('yml-env-toggle');
        if (overlay) overlay.classList.remove('active');
        if (toggle) toggle.classList.remove('active');
    }

    // ========== Sidebar Toggle ==========
    function toggleSidebar() {
        const sidebar = document.getElementById('yml-validation-sidebar');
        const toggleBtn = document.getElementById('yml-sidebar-toggle');
        if (!sidebar || !toggleBtn) return;

        hideTooltip(); // Close any open tooltip

        const isMobile = window.innerWidth <= 768;
        if (isMobile) {
            sidebar.classList.toggle('expanded-mobile');
            toggleBtn.classList.toggle('expanded-mobile');
        } else {
            sidebar.classList.toggle('collapsed');
            toggleBtn.classList.toggle('collapsed');
        }
    }

    // ========== Public API ==========
    function open(yamlContent, subtitle) {
        const titleEl = document.querySelector('.yml-builder-header h3');
        if (titleEl) {
            titleEl.textContent = subtitle ? 'Smart YML Builder — ' + subtitle : 'Smart YML Builder';
        }

        resetPreview();
        hideTooltip();

        const ta = document.getElementById('yaml-textarea');
        if (ta) ta.value = yamlContent || '';

        // Recreate editor if theme changed since last init
        const currentTheme = document.documentElement.dataset.theme || 'light';
        if (cmView && cmTheme !== currentTheme) {
            cmView.destroy();
            cmView = null;
            cmEditor = null;
        }

        if (cmView) {
            cmView.dispatch({
                changes: { from: 0, to: cmView.state.doc.length, insert: yamlContent || '' }
            });
        } else {
            initEditor(yamlContent || '');
        }

        doValidation(yamlContent || '');
    }

    function getValue() {
        if (cmView) return cmView.state.doc.toString();
        const fallback = document.querySelector('.yml-fallback-editor');
        if (fallback) return fallback.value;
        const ta = document.getElementById('yaml-textarea');
        return ta ? ta.value : '';
    }

    function getValidationResults() {
        return {
            results: lastResults,
            envScan: lastEnvScan,
            hasRequiredFailures: lastResults.some(r => r.section === 'required' && r.status === 'fail'),
            failCount: lastResults.filter(r => r.status === 'fail').length,
            warnCount: lastResults.filter(r => r.status === 'warn').length,
        };
    }

    // Listen for CM6 ready event
    document.addEventListener('cm6-ready', () => {
        const modal = document.getElementById('yaml-modal');
        if (modal && modal.style.display === 'block') {
            const content = getValue();
            initEditor(content);
            doValidation(content);
        }
    });

    // Clean up tooltip on scroll or resize
    document.addEventListener('scroll', hideTooltip, true);
    window.addEventListener('resize', hideTooltip);

    // Expose public API
    function editorUndo() {
        if (cmView && window.CM6 && window.CM6.undo) {
            window.CM6.undo(cmView);
        }
    }

    function editorRedo() {
        if (cmView && window.CM6 && window.CM6.redo) {
            window.CM6.redo(cmView);
        }
    }

    window.YmlBuilder = {
        open,
        getValue,
        getValidationResults,
        resetPreview,
        toggleEnvPreview,
        toggleSidebar,
        undo: editorUndo,
        redo: editorRedo,
    };
})();
