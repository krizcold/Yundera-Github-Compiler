import type { GlobalSettings } from './storage';

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

// Keep the rest of the existing functions
export interface ProcessedCompose {
    rich: any;
    clean: any;
}

/**
 * Pre-processes an App Store-style docker-compose object.
 * Returns two versions: one for saving (rich) and one for installation (clean).
 */
export function preprocessAppstoreCompose(composeObject: any, settings: GlobalSettings, localImageName?: string | null, appToken?: string | null): ProcessedCompose {
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

    // Process services
    if (richCompose.services) {
        for (const serviceName in richCompose.services) {
            const service = richCompose.services[serviceName];

            // Replace image with local image name for GitHub repos
            if (localImageName && serviceName === mainServiceKey) {
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

                // Add proper user (PUID:PGID from settings)
                service.user = `${settings.puid}:${settings.pgid}`;

                // Add icon as label if available from x-casaos
                if (richCompose['x-casaos']?.icon) {
                    if (!service.labels) {
                        service.labels = {};
                    }
                    service.labels.icon = richCompose['x-casaos'].icon;
                }
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
                    .replace(/\$\{?REF_PORT\}?/g, settings.refPort);
                
                // Replace $API_HASH with the app's specific token if available
                if (appToken) {
                    result = result.replace(/\$\{?API_HASH\}?/g, appToken);
                }
                
                return result;
            };

            // Process template substitutions in environment variables
            if (service.environment) {
                for (const key in service.environment) {
                    let value = service.environment[key];
                    if (typeof value === 'string') {
                        service.environment[key] = replaceTemplateVars(value);
                    }
                }
            }

            // Inject AUTH_HASH for apps that need authentication
            // Generate a unique AUTH_HASH for this app installation
            if (!service.environment) {
                service.environment = {};
            }
            
            // Only add AUTH_HASH if the service doesn't already have it
            if (!service.environment.AUTH_HASH) {
                const crypto = require('crypto');
                const authHash = crypto.randomBytes(32).toString('hex');
                service.environment.AUTH_HASH = authHash;
            }

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
                richCompose['x-casaos'].hostname = `${port}-${appId}-${settings.refDomain}`;
                richCompose['x-casaos'].scheme = settings.refScheme || 'https';
                richCompose['x-casaos'].port_map = settings.refScheme === 'https' ? "443" : "80";
            }
        }

        // Process template variables in x-casaos volumes
        if (richCompose['x-casaos'].volumes && Array.isArray(richCompose['x-casaos'].volumes)) {
            richCompose['x-casaos'].volumes = richCompose['x-casaos'].volumes.map((volume: string) => {
                if (typeof volume === 'string') {
                    return volume
                        .replace(/\$\{?PUID\}?/g, settings.puid)
                        .replace(/\$\{?PGID\}?/g, settings.pgid)
                        .replace(/\$\{?APP_ID\}?/g, appId)
                        .replace(/\$AppID/g, appId)
                        .replace(/\$\{?REF_DOMAIN\}?/g, settings.refDomain || '')
                        .replace(/\$\{?REF_SCHEME\}?/g, settings.refScheme || '')
                        .replace(/\$\{?REF_PORT\}?/g, settings.refPort || '');
                }
                return volume;
            });
        }

    }

    // Create clean version by removing pre-install-cmd and other CasaOS-specific stuff
    const cleanCompose = JSON.parse(JSON.stringify(richCompose));
    
    // Remove pre-install-cmd from clean version
    if (cleanCompose['x-casaos'] && cleanCompose['x-casaos']['pre-install-cmd']) {
        delete cleanCompose['x-casaos']['pre-install-cmd'];
    }
    
    return {
        rich: richCompose,
        clean: cleanCompose
    };
}