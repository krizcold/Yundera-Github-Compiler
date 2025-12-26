import type { GlobalSettings } from './storage';
import * as yaml from 'yaml';

// PCS Processing Types and Functions (1:1 with CasaOS AppStore)
interface PCSEnvironment {
    PUID: string;
    PGID: string;
    DATA_ROOT: string;
    REF_NET: string;
    REF_SCHEME: string;
    REF_PORT: string;
    REF_DOMAIN: string;
    REF_SEPARATOR: string;
}

function getPCSEnvironment(): PCSEnvironment {
    return {
        PUID: process.env.PUID || '1000',
        PGID: process.env.PGID || '1000',
        DATA_ROOT: process.env.DATA_ROOT || '/DATA',
        REF_NET: process.env.REF_NET || 'pcs',
        REF_SCHEME: process.env.REF_SCHEME || 'http',
        REF_PORT: process.env.REF_PORT || '80',
        REF_DOMAIN: process.env.REF_DOMAIN || '',
        REF_SEPARATOR: process.env.REF_SEPARATOR || '-'
    };
}

// Critical User Rights Injection Logic (matches CasaOS exactly)
function shouldAddUserToService(service: any, puid: string, pgid: string): boolean {
    // CRITICAL: Only inject user if NO user is defined
    // If user is already defined (including "root"), RESPECT IT
    const hasUser = service.user !== undefined && service.user !== '';

    if (hasUser) {
        console.log(`Service ${service.container_name || 'unnamed'} already has user: ${service.user}, skipping injection`);
        return false;
    } else {
        console.log(`Service ${service.container_name || 'unnamed'} has no user defined, will inject PUID:PGID`);
        return true;
    }
}

function processServiceUserRights(service: any, pcsEnv: PCSEnvironment): any {
    const serviceCopy = { ...service };

    // Apply user rights based on CasaOS logic
    if (shouldAddUserToService(serviceCopy, pcsEnv.PUID, pcsEnv.PGID)) {
        serviceCopy.user = `${pcsEnv.PUID}:${pcsEnv.PGID}`;
        console.log(`Injected user ${serviceCopy.user} to service`);
    }

    return serviceCopy;
}

// Volume and Network Processing Functions
function processVolumes(volumes: any[], dataRoot: string): any[] {
    if (!volumes || !dataRoot) return volumes;

    return volumes.map(volume => {
        if (typeof volume === 'string') {
            // Replace /DATA with actual DATA_ROOT
            return volume.replace(/^\/DATA/, dataRoot);
        } else if (volume && typeof volume === 'object') {
            // Handle object-style volumes
            if (volume.source && volume.source.startsWith('/DATA')) {
                volume.source = volume.source.replace(/^\/DATA/, dataRoot);
            }
        }
        return volume;
    });
}

function processNetworks(service: any, compose: any, refNet: string, isMainService: boolean): any {
    const serviceCopy = { ...service };

    // Skip if NetworkMode is set and not bridge
    if (serviceCopy.network_mode && serviceCopy.network_mode !== 'bridge') {
        console.log(`Service has network_mode ${serviceCopy.network_mode}, skipping network config`);
        return serviceCopy;
    }

    // Only apply refNet to main service
    if (refNet && isMainService) {
        // Add network to compose networks
        if (!compose.networks) {
            compose.networks = {};
        }
        compose.networks[refNet] = {
            external: true,
            name: refNet
        };

        // Add network to service
        if (!serviceCopy.networks) {
            serviceCopy.networks = [];
        }
        if (Array.isArray(serviceCopy.networks)) {
            if (!serviceCopy.networks.includes(refNet)) {
                serviceCopy.networks.push(refNet);
            }
        } else {
            serviceCopy.networks[refNet] = {};
        }
    }

    return serviceCopy;
}

export async function executePostInstallCommand(composeObject: any, logCollector?: any, runAsUser?: string): Promise<void> {
    // Use PUID from environment to match real AppStore behavior, fallback to ubuntu
    const defaultUser = process.env.PUID ? `${process.env.PUID}` : 'ubuntu';
    const actualRunAsUser = runAsUser || defaultUser;
    // Helper function to log both to console and stream
    const log = (message: string, type: 'system' | 'info' | 'warning' | 'error' | 'success' = 'info') => {
        console.log(message);
        if (logCollector) {
            logCollector.addLog(message, type);
        }
    };

    const cmd = composeObject?.['x-casaos']?.['post-install-cmd'];
    if (!cmd || typeof cmd !== 'string') {
        log('ℹ️ No post-install-cmd found, skipping.', 'info');
        return;
    }

    log(`🎉 Executing post-install command on host...`, 'info');
    log(`📜 Command: ${cmd}`, 'system');

    try {
        // SIMPLE APPROACH: Execute directly in host context
        // Since we're running in the GitHub Compiler container, we need to execute
        // the post-install command in a way that accesses the host filesystem

        const { exec } = await import('child_process');
        const { promisify } = require('util');
        const execAsync = promisify(exec);

        log(`🔄 Executing post-install command via Docker exec to CasaOS host (user: ${actualRunAsUser})...`, 'info');

        // Execute on host using docker exec to casaos container - same level of access as CasaOS post-install-cmd
        const crypto = await import('crypto');

        try {
            // Check if docker command is available and casaos container exists
            const dockerTest = await execAsync('docker ps --filter "name=casaos" --format "{{.Names}}"', {
                timeout: 10000,
                maxBuffer: 1024 * 1024
            });

            if (dockerTest.stdout.trim() !== 'casaos') {
                throw new Error(`CasaOS container not found. Available containers: ${dockerTest.stdout}`);
            }

        } catch (error: any) {
            log(`❌ Docker access test failed: ${error.message}`, 'error');
            throw new Error(`Cannot access Docker or CasaOS container: ${error.message}`);
        }

        // Create temporary script with the command
        const scriptId = crypto.randomBytes(8).toString('hex');
        const scriptContent = `#!/bin/bash
set -e

# Execute the post-install command
${cmd}
`;

        const tempScript = `/tmp/yundera-postinstall-${scriptId}.sh`;

        // Encode script content to base64 to avoid heredoc conflicts
        const scriptBase64 = Buffer.from(scriptContent).toString('base64');

        // Execute via docker exec to casaos container with selected user - this gives us the same access as CasaOS post-install-cmd
        const dockerCommand = `docker exec --user ${actualRunAsUser} casaos bash -c '
# Set permissive umask for all files created during this session
umask 022

# Create script with proper permissions
echo "${scriptBase64}" | base64 -d > ${tempScript}

# Verify script was created and set proper permissions
if [ ! -f "${tempScript}" ]; then
  echo "ERROR: Failed to create script file ${tempScript}"
  exit 1
fi

# Set script permissions: readable/executable by all, writable by owner
chmod 755 ${tempScript}

# Verify permissions
if [ ! -x "${tempScript}" ]; then
  echo "ERROR: Script ${tempScript} is not executable"
  ls -la ${tempScript}
  exit 1
fi

# Execute the script
echo "Executing post-install script: ${tempScript}"
bash ${tempScript}
SCRIPT_EXIT_CODE=$?

# Exit with the same code as the script
exit $SCRIPT_EXIT_CODE
'`;

        const result = await execAsync(dockerCommand, {
            timeout: 300000, // 5 minute timeout
            maxBuffer: 1024 * 1024 * 10, // 10MB buffer
            shell: '/bin/sh'
        });

        if (result.stdout) {
            const lines = result.stdout.trim().split('\n');
            lines.forEach((line: string) => {
                if (line.trim()) {
                    log(`📤 ${line}`, 'info');
                }
            });
        }

        if (result.stderr) {
            const lines = result.stderr.trim().split('\n');
            lines.forEach((line: string) => {
                if (line.trim()) {
                    log(`⚠️ ${line}`, 'warning');
                }
            });
        }

        log('✅ Post-install command executed successfully.', 'success');

    } catch (error: any) {
        log(`❌ Post-install command execution failed: ${error.message}`, 'error');
        // NOTE: Post-install command failures should be warnings, not installation failures
        log(`⚠️ Post-install command failed, but installation will continue`, 'warning');
        // Don't throw error - just log the failure
    }
}

export async function executePreInstallCommand(composeObject: any, logCollector?: any, runAsUser?: string): Promise<void> {
    // Use PUID from environment to match real AppStore behavior, fallback to ubuntu
    const defaultUser = process.env.PUID ? `${process.env.PUID}` : 'ubuntu';
    const actualRunAsUser = runAsUser || defaultUser;
    // Helper function to log both to console and stream
    const log = (message: string, type: 'system' | 'info' | 'warning' | 'error' | 'success' = 'info') => {
        console.log(message);
        if (logCollector) {
            logCollector.addLog(message, type);
        }
    };

    const cmd = composeObject?.['x-casaos']?.['pre-install-cmd'];
    if (!cmd || typeof cmd !== 'string') {
        log('ℹ️ No pre-install-cmd found, skipping.', 'info');
        return;
    }

    log(`🚀 Executing pre-install command on host...`, 'info');
    log(`📜 Command: ${cmd}`, 'system');
    
    try {
        // SIMPLE APPROACH: Execute directly in host context
        // Since we're running in the GitHub Compiler container, we need to execute
        // the pre-install command in a way that accesses the host filesystem
        
        const { exec } = await import('child_process');
        const { promisify } = require('util');
        const execAsync = promisify(exec);
        
        log(`🔄 Executing pre-install command via Docker exec to CasaOS host (user: ${actualRunAsUser})...`, 'info');
        
        // Execute on host using docker exec to casaos container - same level of access as CasaOS pre-install-cmd
        const crypto = await import('crypto');
        
        try {
            // Check if docker command is available and casaos container exists
            const dockerTest = await execAsync('docker ps --filter "name=casaos" --format "{{.Names}}"', {
                timeout: 10000,
                maxBuffer: 1024 * 1024
            });
            
            if (dockerTest.stdout.trim() !== 'casaos') {
                throw new Error(`CasaOS container not found. Available containers: ${dockerTest.stdout}`);
            }
            
        } catch (error: any) {
            log(`❌ Docker access test failed: ${error.message}`, 'error');
            throw new Error(`Cannot access Docker or CasaOS container: ${error.message}`);
        }
        
        // Create temporary script with the command
        const scriptId = crypto.randomBytes(8).toString('hex');
        const scriptContent = `#!/bin/bash
set -e

# Execute the pre-install command
${cmd}
`;
        
        const tempScript = `/tmp/yundera-preinstall-${scriptId}.sh`;
        
        // Encode script content to base64 to avoid heredoc conflicts
        const scriptBase64 = Buffer.from(scriptContent).toString('base64');
        
        // Execute via docker exec to casaos container with selected user - this gives us the same access as CasaOS pre-install-cmd
        const dockerCommand = `docker exec --user ${actualRunAsUser} casaos bash -c '
# Set permissive umask for all files created during this session
umask 022

# Create script with proper permissions
echo "${scriptBase64}" | base64 -d > ${tempScript}

# Verify script was created and set proper permissions
if [ ! -f "${tempScript}" ]; then
  echo "ERROR: Failed to create script file ${tempScript}"
  exit 1
fi

# Set script permissions: readable/executable by all, writable by owner
chmod 755 ${tempScript}

# Verify permissions
if [ ! -x "${tempScript}" ]; then
  echo "ERROR: Script ${tempScript} is not executable"
  ls -la ${tempScript}
  exit 1
fi

# Execute the script
echo "Executing pre-install script: ${tempScript}"
bash ${tempScript}
SCRIPT_EXIT_CODE=$?

# Exit with the same code as the script
exit $SCRIPT_EXIT_CODE
'`;
        
        const result = await execAsync(dockerCommand, { 
            timeout: 300000, // 5 minute timeout
            maxBuffer: 1024 * 1024 * 10, // 10MB buffer
            shell: '/bin/sh'
        });
        
        if (result.stdout) {
            const lines = result.stdout.trim().split('\n');
            lines.forEach((line: string) => {
                if (line.trim()) {
                    log(`📤 ${line}`, 'info');
                }
            });
        }
        
        if (result.stderr) {
            const lines = result.stderr.trim().split('\n');
            lines.forEach((line: string) => {
                if (line.trim()) {
                    log(`⚠️ ${line}`, 'warning');
                }
            });
        }
        
        log('✅ Pre-install command executed successfully.', 'success');

    } catch (error: any) {
        log(`❌ Pre-install command execution failed: ${error.message}`, 'error');
        throw new Error(`Pre-install command failed: ${error.message}`);
    }
}

// Helper Functions for PCS Processing
function hasPUIDInEnv(environment: any): boolean {
    if (!environment) return false;

    if (Array.isArray(environment)) {
        return environment.some(env =>
            typeof env === 'string' && env.toUpperCase().startsWith('PUID=')
        );
    } else {
        return Object.keys(environment).some(key =>
            key.toUpperCase() === 'PUID'
        );
    }
}

function getMainServiceName(compose: any): string {
    if (!compose['x-casaos']?.main) {
        // Default to first service if no main specified
        return Object.keys(compose.services || {})[0] || '';
    }
    return compose['x-casaos'].main;
}

function updateCasaOSExtensions(compose: any, pcsEnv: PCSEnvironment): any {
    if (!compose['x-casaos']) {
        return compose;
    }

    const casaos = compose['x-casaos'];

    // Update scheme/port/domain in URLs
    if (casaos.scheme) {
        casaos.scheme = pcsEnv.REF_SCHEME;
    }

    if (casaos.port) {
        casaos.port = pcsEnv.REF_PORT;
    }

    // Process tips.before_install environment variables
    if (casaos.tips?.before_install) {
        for (const [lang, tip] of Object.entries(casaos.tips.before_install)) {
            if (typeof tip === 'string') {
                // Expand environment variables
                casaos.tips.before_install[lang] = (tip as string)
                    .replace(/\$DATA_ROOT/g, pcsEnv.DATA_ROOT)
                    .replace(/\$PUID/g, pcsEnv.PUID)
                    .replace(/\$PGID/g, pcsEnv.PGID);
            }
        }
    }

    return compose;
}

// Main PCS Processing Function (1:1 with CasaOS AppStore)
export function applyPCSProcessing(composeContent: string): string {
    const compose = yaml.parse(composeContent) as any;
    const pcsEnv = getPCSEnvironment();

    console.log('🔧 Applying PCS processing (1:1 with CasaOS AppStore)...');

    // Determine main service
    const mainServiceName = getMainServiceName(compose);

    // Process each service
    if (compose.services) {
        const processedServices: any = {};

        for (const [serviceName, service] of Object.entries(compose.services)) {
            let processedService = service as any;

            // 1. Apply user rights (CRITICAL STEP)
            processedService = processServiceUserRights(processedService, pcsEnv);

            // 2. Process volumes
            if (processedService.volumes) {
                processedService.volumes = processVolumes(processedService.volumes, pcsEnv.DATA_ROOT);
            }

            // 3. Process networks
            const isMainService = serviceName === mainServiceName;
            processedService = processNetworks(processedService, compose, pcsEnv.REF_NET, isMainService);

            // 4. Inject environment variables (if not already present)
            if (!processedService.environment) {
                processedService.environment = {};
            }

            // Only inject PUID/PGID if not already present
            if (!hasPUIDInEnv(processedService.environment)) {
                if (Array.isArray(processedService.environment)) {
                    processedService.environment.push(`PUID=${pcsEnv.PUID}`);
                    processedService.environment.push(`PGID=${pcsEnv.PGID}`);
                } else {
                    processedService.environment.PUID = pcsEnv.PUID;
                    processedService.environment.PGID = pcsEnv.PGID;
                }
            }

            processedServices[serviceName] = processedService;
        }

        compose.services = processedServices;
    }

    // Process x-casaos extensions
    updateCasaOSExtensions(compose, pcsEnv);

    console.log('✅ PCS processing complete');
    return yaml.stringify(compose);
}

// Keep the rest of the existing functions
export interface ProcessedCompose {
    rich: any;
    clean: any;
    authHash: string; // The AUTH_HASH used (for persistence)
}

/**
 * Pre-processes an App Store-style docker-compose object.
 * Returns two versions: one for saving (rich) and one for installation (clean).
 * @param existingAuthHash - If provided, reuses this AUTH_HASH instead of generating a new one (for updates)
 */
export function preprocessAppstoreCompose(composeObject: any, settings: GlobalSettings, localImageName?: string | null, appToken?: string | null, builtServiceName?: string | null, existingAuthHash?: string | null): ProcessedCompose {
    console.log('🔧 Pre-processing App Store-style compose file...');

    // Create a deep copy to avoid modifying the original object in memory
    const richCompose = JSON.parse(JSON.stringify(composeObject));

    const appId = richCompose.name;
    if (!appId) {
        throw new Error('Compose file is missing the top-level `name` property.');
    }

    const useDynamicWebUIPort = !richCompose?.['x-casaos']?.webui_port;

    // Get the main service key from x-casaos
    const mainServiceKey = richCompose['x-casaos']?.main;

    // Use existing AUTH_HASH if provided (for updates), otherwise generate a new one
    const crypto = require('crypto');
    const authHash = existingAuthHash || crypto.randomBytes(32).toString('hex');

    if (existingAuthHash) {
        console.log(`🔑 Using existing AUTH_HASH for app update: ${authHash.substring(0, 8)}...`);
    } else {
        console.log(`🔑 Generated new AUTH_HASH for first installation: ${authHash.substring(0, 8)}...`);
    }

    // Helper function to replace template variables in strings
    const replaceTemplateVars = (value: string): string => {
        const originalValue = value;
        const webUiPort = richCompose['x-casaos']?.webui_port || 80;
        const domainValue = webUiPort === 80
            ? `${appId}${settings.refSeparator}${settings.refDomain}`
            : `${appId}${settings.refSeparator}${settings.refDomain}:${webUiPort}`;

        let result = value
            .replace(/\$\{?PUID\}?/g, settings.puid)
            .replace(/\$\{?PGID\}?/g, settings.pgid)
            .replace(/\$\{?APP_ID\}?/g, appId)
            .replace(/\$AppID/g, appId)  // Handle $AppID without braces
            .replace(/\$\{?REF_DOMAIN\}?/g, domainValue)
            .replace(/\$\{?REF_SCHEME\}?/g, settings.refScheme)
            .replace(/\$\{?REF_PORT\}?/g, settings.refPort)
            .replace(/\$\{?AUTH_HASH\}?/g, authHash);  // Replace AUTH_HASH globally

        // Replace $API_HASH with the app's specific token if available
        if (appToken) {
            result = result.replace(/\$\{?API_HASH\}?/g, appToken);
        }

        return result;
    };

    // Helper function to recursively process template variables in any object
    const processTemplateVarsRecursively = (obj: any): any => {
        if (typeof obj === 'string') {
            return replaceTemplateVars(obj);
        } else if (Array.isArray(obj)) {
            return obj.map(item => processTemplateVarsRecursively(item));
        } else if (obj && typeof obj === 'object') {
            const result: any = {};
            for (const [key, value] of Object.entries(obj)) {
                result[key] = processTemplateVarsRecursively(value);
            }
            return result;
        } else {
            return obj; // primitives (numbers, booleans, null, undefined)
        }
    };

    // Process services
    if (richCompose.services) {
        for (const serviceName in richCompose.services) {
            const service = richCompose.services[serviceName];

            if (localImageName && builtServiceName && serviceName === builtServiceName) {
                service.image = localImageName;
            }

            // Convert ports to expose for CasaOS AppStore compatibility
            if (service.ports && Array.isArray(service.ports)) {
                // Extract container ports from ports array and convert to expose
                const exposedPorts: string[] = [];
                
                service.ports.forEach((portMapping: any) => {
                    if (typeof portMapping === 'string') {
                        // Handle string format like "8080:8080" or "8080"
                        const parts = portMapping.split(':');
                        const containerPort = parts.length > 1 ? parts[1] : parts[0];
                        if (containerPort && !exposedPorts.includes(containerPort)) {
                            exposedPorts.push(containerPort);
                        }
                    } else if (typeof portMapping === 'object' && portMapping.target) {
                        // Handle object format
                        const containerPort = portMapping.target.toString();
                        if (!exposedPorts.includes(containerPort)) {
                            exposedPorts.push(containerPort);
                        }
                    }
                });

                // Convert ports to expose for CasaOS compatibility
                if (exposedPorts.length > 0) {
                    service.expose = exposedPorts;
                    delete service.ports; // Remove ports array
                }
            }

            // Add required CasaOS metadata for main service
            if (serviceName === mainServiceKey) {
                // Add hostname
                service.hostname = appId;

                // NOTE: User assignment now handled by PCS processing to respect explicit user settings
                // PCS will inject PUID:PGID only if no user is defined, respecting explicit users like "root"

                // Add icon as label if available from x-casaos
                if (richCompose['x-casaos']?.icon) {
                    if (!service.labels) {
                        service.labels = {};
                    }
                    service.labels.icon = richCompose['x-casaos'].icon;
                }
            }


            // Process template substitutions in environment variables
            if (service.environment) {
                for (const key in service.environment) {
                    let value = service.environment[key];
                    if (typeof value === 'string') {
                        service.environment[key] = replaceTemplateVars(value);
                    }
                }
            }

            // NOTE: AUTH_HASH is NOT force-injected anymore
            // It is only replaced via template variable substitution (replaceTemplateVars)
            // Apps that need AUTH_HASH must explicitly define it with $AUTH_HASH in their environment

            // Process template substitutions in volumes
            if (service.volumes && Array.isArray(service.volumes)) {
                service.volumes = service.volumes.map((volume: any) => {
                    if (typeof volume === 'string') {
                        // Handle string format like "/host/path:/container/path"
                        return replaceTemplateVars(volume);
                    } else if (typeof volume === 'object' && volume.source) {
                        // Handle object format with source property
                        return {
                            ...volume,
                            source: replaceTemplateVars(volume.source)
                        };
                    }
                    return volume;
                });
            }

            // Process template substitutions in other string fields
            if (typeof service.command === 'string') {
                service.command = replaceTemplateVars(service.command);
            }
            if (typeof service.entrypoint === 'string') {
                service.entrypoint = replaceTemplateVars(service.entrypoint);
            }
            if (typeof service.working_dir === 'string') {
                service.working_dir = replaceTemplateVars(service.working_dir);
            }

            // Process template substitutions in labels
            if (service.labels) {
                if (Array.isArray(service.labels)) {
                    // Handle labels as array
                    service.labels = service.labels.map((label: any) => {
                        if (typeof label === 'string') {
                            return replaceTemplateVars(label);
                        }
                        return label;
                    });
                    
                    // Extract icon from array labels if available
                    for (const label of service.labels) {
                        if (typeof label === 'string' && label.includes('icon=')) {
                            const iconMatch = label.match(/icon=(.+)/);
                            if (iconMatch) {
                                richCompose['x-casaos'].icon = iconMatch[1];
                                break;
                            }
                        }
                    }
                } else if (typeof service.labels === 'object') {
                    // Handle labels as object (most common)
                    for (const [key, value] of Object.entries(service.labels)) {
                        if (typeof value === 'string') {
                            service.labels[key] = replaceTemplateVars(value);
                        }
                    }
                    
                    // Extract icon from object labels if available
                    if (service.labels.icon) {
                        richCompose['x-casaos'].icon = service.labels.icon;
                    }
                }
            }
        }
    }

    // Process template variables in ENTIRE x-casaos section (including index, hostname, descriptions, etc.)
    if (richCompose['x-casaos']) {
        console.log('🔧 Processing template variables in x-casaos section...');

        // Process all x-casaos fields for template variables using recursive helper
        // But exclude some fields that should NOT be processed (to avoid breaking metadata)
        const fieldsToSkip = ['is_uncontrolled', 'store_app_id', 'architectures']; // Skip these as they're metadata, not user content

        const processedXCasaOS: any = {};
        for (const [key, value] of Object.entries(richCompose['x-casaos'])) {
            if (fieldsToSkip.includes(key)) {
                processedXCasaOS[key] = value; // Keep as-is
            } else {
                processedXCasaOS[key] = processTemplateVarsRecursively(value);
            }
        }

        richCompose['x-casaos'] = processedXCasaOS;
        console.log('✅ Template variables processed in x-casaos section');
    }

    // Add required CasaOS metadata to x-casaos section
    if (richCompose['x-casaos']) {
        // Add missing required fields for CasaOS compatibility
        richCompose['x-casaos'].is_uncontrolled = false;
        richCompose['x-casaos'].store_app_id = appId;

        // Generate hostname using REF_DOMAIN format if available
        if (settings.refDomain) {
            const mainService = richCompose.services[mainServiceKey];
            if (mainService && mainService.expose && mainService.expose.length > 0) {
                const port = mainService.expose[0];
                // Omit port prefix for standard port 80
                const portPrefix = (port === 80 || port === '80') ? '' : `${port}${settings.refSeparator}`;
                richCompose['x-casaos'].hostname = `${portPrefix}${appId}${settings.refSeparator}${settings.refDomain}`;
                richCompose['x-casaos'].scheme = settings.refScheme || 'https';
                richCompose['x-casaos'].port_map = settings.refScheme === 'https' ? "443" : "80";
            }
        }

        // Note: x-casaos template variable processing (including volumes) is now handled above by recursive processing

    }

    // Create clean version by removing pre-install-cmd and other CasaOS-specific stuff
    const cleanCompose = JSON.parse(JSON.stringify(richCompose));
    
    // Remove pre-install-cmd and post-install-cmd from clean version
    if (cleanCompose['x-casaos'] && cleanCompose['x-casaos']['pre-install-cmd']) {
        delete cleanCompose['x-casaos']['pre-install-cmd'];
    }
    if (cleanCompose['x-casaos'] && cleanCompose['x-casaos']['post-install-cmd']) {
        delete cleanCompose['x-casaos']['post-install-cmd'];
    }

    // CRITICAL: Apply PCS processing at the very end (1:1 with CasaOS AppStore)
    // This ensures PUID:PGID injection happens correctly
    console.log('🔧 Applying PCS processing to both rich and clean compose versions...');

    const richComposeYaml = yaml.stringify(richCompose);
    const cleanComposeYaml = yaml.stringify(cleanCompose);

    const pcsProcessedRichYaml = applyPCSProcessing(richComposeYaml);
    const pcsProcessedCleanYaml = applyPCSProcessing(cleanComposeYaml);

    const finalRichCompose = yaml.parse(pcsProcessedRichYaml);
    const finalCleanCompose = yaml.parse(pcsProcessedCleanYaml);

    console.log('✅ PCS processing applied to compose files');

    return {
        rich: finalRichCompose,
        clean: finalCleanCompose,
        authHash: authHash
    };
}