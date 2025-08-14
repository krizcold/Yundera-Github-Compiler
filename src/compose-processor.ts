import type { GlobalSettings } from './storage';

export async function executePreInstallCommand(composeObject: any, logCollector?: any, runAsUser: string = 'ubuntu'): Promise<void> {
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
        
        log(`🔄 Executing pre-install command via Docker exec to CasaOS host...`, 'info');
        
        // Execute on host using docker exec to casaos container - same level of access as CasaOS pre-install-cmd
        const crypto = await import('crypto');
        
        // Test if we can access docker and the casaos container
        log(`🐳 Testing Docker access and CasaOS container availability...`, 'info');
        
        try {
            // Check if docker command is available and casaos container exists
            const dockerTest = await execAsync('docker ps --filter "name=casaos" --format "{{.Names}}"', {
                timeout: 10000,
                maxBuffer: 1024 * 1024
            });
            
            if (dockerTest.stdout.trim() !== 'casaos') {
                throw new Error(`CasaOS container not found. Available containers: ${dockerTest.stdout}`);
            }
            
            log(`✅ CasaOS container found and accessible`, 'info');
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
        log(`👤 Running pre-install command as user: ${runAsUser}`, 'info');
        const dockerCommand = `docker exec --user ${runAsUser} casaos bash -c '
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

# Execute the script as selected user
echo "Executing pre-install script as ${runAsUser} user: ${tempScript}"
bash ${tempScript}
SCRIPT_EXIT_CODE=$?

# Note: No cleanup - leave files for testing and future terminal interface

# Exit with the same code as the script
exit $SCRIPT_EXIT_CODE
'`;
        
        log(`🐳 Docker exec execution to CasaOS container`, 'info');
        
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
        log('💡 Pre-install commands should create files in host /tmp, not container /tmp.', 'info');
        log('🔧 Make sure Docker socket is accessible and CasaOS container is running.', 'info');
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
export function preprocessAppstoreCompose(composeObject: any, settings: GlobalSettings): ProcessedCompose {
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

            // Add AppID to environment for all services
            if (!service.environment) {
                service.environment = {};
            }
            service.environment.AppID = appId;

            // Only process the main service for port handling
            if (serviceName === mainServiceKey && useDynamicWebUIPort) {
                // Generate random WebUI port for this service only
                const randomPort = 30000 + Math.floor(Math.random() * 35000);
                richCompose['x-casaos'].webui_port = randomPort;

                console.log(`🎲 Generated random WebUI port for ${appId}: ${randomPort}`);

                // Find and update port mappings
                if (service.ports && Array.isArray(service.ports)) {
                    const updatedPorts = service.ports.map((portMapping: any) => {
                        if (typeof portMapping === 'string') {
                            // Handle string format like "8080:8080"
                            const [hostPort, containerPort] = portMapping.split(':');
                            if (hostPort && containerPort) {
                                return `${randomPort}:${containerPort}`;
                            }
                        } else if (typeof portMapping === 'object' && portMapping.target) {
                            // Handle object format
                            return {
                                ...portMapping,
                                published: randomPort
                            };
                        }
                        return portMapping;
                    });
                    
                    service.ports = updatedPorts;
                    console.log(`🔄 Updated port mappings for service ${serviceName}`);
                }

                // Update expose section if it exists
                if (service.expose && Array.isArray(service.expose)) {
                    // Keep expose as-is, it's for inter-container communication
                    console.log(`ℹ️ Keeping expose unchanged for service ${serviceName}`);
                }
            }

            // Process template substitutions
            if (service.environment) {
                for (const key in service.environment) {
                    let value = service.environment[key];
                    if (typeof value === 'string') {
                        // Replace template variables
                        value = value.replace(/\$\{?PUID\}?/g, settings.puid);
                        value = value.replace(/\$\{?PGID\}?/g, settings.pgid);
                        value = value.replace(/\$\{?APP_ID\}?/g, appId);
                        
                        // Handle domain construction
                        const webUiPort = richCompose['x-casaos']?.webui_port || 80;
                        const domainValue = webUiPort === 80 
                            ? `${appId}${settings.refSeparator}${settings.refDomain}`
                            : `${appId}${settings.refSeparator}${settings.refDomain}:${webUiPort}`;
                        
                        value = value.replace(/\$\{?REF_DOMAIN\}?/g, domainValue);
                        value = value.replace(/\$\{?REF_SCHEME\}?/g, settings.refScheme);
                        value = value.replace(/\$\{?REF_PORT\}?/g, settings.refPort);
                        
                        service.environment[key] = value;
                    }
                }
            }

            // Extract icon from service labels if available
            if (service.labels) {
                for (const label of service.labels) {
                    if (typeof label === 'string' && label.includes('icon=')) {
                        const iconMatch = label.match(/icon=(.+)/);
                        if (iconMatch) {
                            richCompose['x-casaos'].icon = iconMatch[1];
                            break;
                        }
                    }
                }
            }
        }
    }

    // Create clean version by removing pre-install-cmd and other CasaOS-specific stuff
    const cleanCompose = JSON.parse(JSON.stringify(richCompose));
    
    // Remove pre-install-cmd from clean version
    if (cleanCompose['x-casaos'] && cleanCompose['x-casaos']['pre-install-cmd']) {
        delete cleanCompose['x-casaos']['pre-install-cmd'];
        console.log('🧹 Removed pre-install-cmd from clean compose version');
    }

    console.log('✅ App Store compose preprocessing complete');
    
    return {
        rich: richCompose,
        clean: cleanCompose
    };
}