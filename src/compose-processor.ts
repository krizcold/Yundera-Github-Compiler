import * as yaml from 'yaml';
import { GlobalSettings } from './storage';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

interface ProcessedCompose {
    rich: any; // The full object with x-casaos modifications, for saving
    clean: any; // The object with x-casaos removed, for installation
}

/**
 * Executes the pre-install command if it exists in the compose file.
 */
export async function executePreInstallCommand(composeObject: any): Promise<void> {
    const cmd = composeObject?.['x-casaos']?.['pre-install-cmd'];
    if (!cmd || typeof cmd !== 'string') {
        console.log('ℹ️ No pre-install-cmd found, skipping.');
        return;
    }

    console.log(`🚀 Executing pre-install command: ${cmd}`);
    try {
        const { stdout, stderr } = await execAsync(cmd);
        if (stdout) console.log(`[pre-install-cmd stdout]:\n${stdout}`);
        if (stderr) console.error(`[pre-install-cmd stderr]:\n${stderr}`);
        console.log('✅ Pre-install command executed successfully.');
    } catch (error) {
        console.error('❌ Failed to execute pre-install command:', error);
        throw new Error(`Pre-install command failed: ${error}`);
    }
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

            // Replicate Go logic: Set hostname for the main service
            if (serviceName === mainServiceKey) {
                console.log(`🔧 Setting hostname for main service '${serviceName}' to '${appId}'`);
                service.hostname = appId;
            }

            // Substitute $AppID in volumes
            if (service.volumes) {
                service.volumes = service.volumes.map((volume: any) => {
                    let volumeString = '';
                    if (typeof volume === 'string') {
                        volumeString = volume;
                    } else if (volume.source) {
                        volumeString = `${volume.source}:${volume.target}`;
                        if (volume.read_only || volume.bind?.propagation === 'ro') { // Check both syntaxes
                            volumeString += ':ro';
                        }
                    }
                    return volumeString.replace(/\$AppID/g, appId);
                });
            }

            // Replicate Go logic: Ensure service is on the 'pcs' network
            if (!service.networks) {
                service.networks = ['pcs'];
            } else if (Array.isArray(service.networks) && !service.networks.includes('pcs')) {
                // If it's an array but doesn't have pcs, add it.
                // This handles cases like `networks: [ 'default' ]`
                service.networks.push('pcs');
            } else if (typeof service.networks === 'object' && !service.networks.pcs) {
                // This handles cases like `networks: { default: {} }`
                service.networks.pcs = null;
            }
            
            // Add user/group rights if not present
            if (!service.user && !Object.keys(service.environment || {}).some(k => k.toUpperCase() === 'PUID')) {
                 service.user = `${settings.puid}:${settings.pgid}`;
            }

            // Convert ports to expose
            if (useDynamicWebUIPort && service.ports) {
                console.log(`    - Converting ports to expose for service '${serviceName}'`);
                if (!service.expose) service.expose = [];
                const exposedPorts = service.ports.map((p: string | number) => String(p).split(':').pop()?.split('/')[0]);
                for (const p of exposedPorts) {
                    if (p && !service.expose.includes(p)) service.expose.push(p);
                }
                delete service.ports;
            }
        }
    }
    
    // Replicate Go logic: Ensure top-level networks are defined correctly
    if (!richCompose.networks) {
        richCompose.networks = {};
    }
    richCompose.networks.pcs = { name: 'pcs', external: true };

    // Process x-casaos extensions
    if (richCompose['x-casaos']) {
        const mainServiceKey = richCompose['x-casaos'].main;
        const originalMainService = composeObject.services?.[mainServiceKey];
        let webuiPort = '80';

        if (richCompose['x-casaos'].webui_port) {
            webuiPort = String(richCompose['x-casaos'].webui_port);
        } else if (originalMainService?.ports?.[0]) {
             webuiPort = String(originalMainService.ports[0]).split(':').pop()?.split('/')[0] || '80';
        } else if (richCompose.services?.[mainServiceKey]?.expose?.[0]) {
             webuiPort = String(richCompose.services[mainServiceKey].expose[0]);
        }

        richCompose['x-casaos'].scheme = settings.refScheme;
        richCompose['x-casaos'].port_map = new yaml.Scalar(settings.refPort);
        richCompose['x-casaos'].hostname = `${webuiPort}${settings.refSeparator}${appId}${settings.refSeparator}${settings.refDomain}`;
    }

    // Create the clean version for installation by stripping x-casaos
    const cleanCompose = JSON.parse(JSON.stringify(richCompose));
    delete cleanCompose['x-casaos'];

    console.log('✅ Compose file pre-processing complete.');
    return {
        rich: richCompose,
        clean: cleanCompose
    };
}


/**
 * Converts a YAML string to a JSON object.
 */
export function convertYamlToJson(yamlString: string): any {
    try {
        return yaml.parse(yamlString);
    } catch (error) {
        console.error('❌ Failed to parse YAML:', error);
        throw new Error('Invalid YAML format.');
    }
}

/**
 * Converts a JSON object to a YAML string.
 */
export function convertJsonToYaml(jsonObject: any): string {
    try {
        // Force all strings to be double-quoted to avoid type ambiguity in the Go parser.
        // This is the critical fix for the "expected type 'string', got 'int'" error.
        return yaml.stringify(jsonObject, { defaultStringType: 'QUOTE_DOUBLE' });
    } catch (error) {
        console.error('❌ Failed to stringify JSON to YAML:', error);
        throw new Error('Could not convert JSON to YAML.');
    }
}
