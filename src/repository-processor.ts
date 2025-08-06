import { Repository, updateRepository, loadSettings } from './storage';
import { cloneOrUpdateRepo } from './GitHandler';
import { buildImageFromRepo } from './DockerHandler';
import { isAppInstalledInCasaOS } from './casaos-status';
import { executePreInstallCommand, preprocessAppstoreCompose } from './compose-processor';
import { CasaOSInstaller, installerEmitter } from './CasaOSInstaller'; // Correctly import the emitter
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'yaml';

const baseDir = "/app/repos";

// This function is no longer needed with the new event-driven approach
// async function pollInstallationJob(...) { ... }

export async function processRepo(
  repository: Repository,
  force: boolean = false
): Promise<{ success: boolean; message:string }> {
  
  try {
    // Phase 0: Force clean any previous installations
    console.log(`🧹 Force cleaning previous installation directories for ${repository.name}...`);
    const hostMetadataDir = path.join('/DATA/AppData/casaos/apps', repository.name);
    const hostDataDir = path.join('/DATA/AppData', repository.name);
    
    try {
      fs.rmSync(hostMetadataDir, { recursive: true, force: true });
      fs.rmSync(hostDataDir, { recursive: true, force: true });
    } catch (e: any) {
      throw new Error(`Failed to clean up previous installation: ${e.message}`);
    }

    // Phase 1: Build image if it's a GitHub repo
    if (repository.type === 'github') {
      updateRepository(repository.id, { status: 'building', statusMessage: 'Cloning repository...', progress: 0 });
      const repoConfig = { url: repository.url!, path: repository.name, autoUpdate: repository.autoUpdate };
      cloneOrUpdateRepo(repoConfig, baseDir);
      
      updateRepository(repository.id, { status: 'building', statusMessage: 'Building image...', progress: 25 });
      await buildImageFromRepo(repoConfig, baseDir);
    }

    // Phase 2: Pre-process the compose file
    updateRepository(repository.id, { status: 'installing', statusMessage: 'Processing compose file...', progress: 75 });
    
    const internalComposePath = path.join('/app/uidata', repository.name, 'docker-compose.yml');
    if (!fs.existsSync(internalComposePath)) {
        throw new Error(`Source docker-compose.yml not found at ${internalComposePath}.`);
    }
    const rawYaml = fs.readFileSync(internalComposePath, 'utf8');
    const composeObject = yaml.parse(rawYaml);

    await executePreInstallCommand(composeObject);
    const settings = loadSettings();
    const { rich } = preprocessAppstoreCompose(composeObject, settings);

    // Step 3: Proactively create all host volume paths
    console.log('🔧 Pre-creating host directories for app data volumes...');
    if (rich.services) {
        for (const serviceName in rich.services) {
            const service = rich.services[serviceName];
            if (service.volumes) {
                for (const volume of service.volumes) {
                    const hostPath = typeof volume === 'string' ? volume.split(':')[0] : volume.source;
                    if (hostPath && hostPath.startsWith('/DATA/AppData')) {
                        fs.mkdirSync(hostPath, { recursive: true });
                    }
                }
            }
        }
    }

    // Step 4: Write the 'rich' compose file to the final destination
    const hostComposePath = path.join(hostMetadataDir, 'docker-compose.yml');
    console.log(`📝 Saving rich compose file to CasaOS metadata path: ${hostComposePath}`);
    fs.mkdirSync(hostMetadataDir, { recursive: true });
    fs.writeFileSync(hostComposePath, yaml.stringify(rich));

    // Step 5: Install the containers by calling Docker Compose directly.
    // This is now an async process handled by events.
    updateRepository(repository.id, { status: 'installing', statusMessage: 'Starting container installation...', progress: 85 });
    
    // Define the listener for when the installation finishes
    const onInstallFinished = async (data: { repositoryId: string, success: boolean, message?: string }) => {
        if (data.repositoryId !== repository.id) {
            return; // Not for us
        }
        
        // IMPORTANT: Remove listener immediately to prevent duplicates
        installerEmitter.removeListener('finished', onInstallFinished);

        if (data.success) {
            console.log(`✅ Installation finished successfully for ${repository.name}. Verifying...`);
            // Brief delay to allow CasaOS to recognize the new container
            await new Promise(resolve => setTimeout(resolve, 5000));
            const isRunning = await isAppInstalledInCasaOS(repository.name);
            updateRepository(repository.id, { 
                status: 'success',
                isInstalled: true,
                isRunning: isRunning,
                statusMessage: 'Installation successful!',
                progress: 100
            });
        } else {
            console.error(`❌ Installation failed in background for ${repository.name}.`);
            updateRepository(repository.id, { status: 'error', statusMessage: data.message || 'Installation failed in background.' });
        }
    };
    
    // Attach the listener BEFORE starting the installation
    installerEmitter.on('finished', onInstallFinished);

    // Start the installation
    const installResult = await CasaOSInstaller.installComposeAppDirectly(hostComposePath, repository.id);

    if (!installResult.success) {
        // If it failed to even start, remove the listener and throw an error
        installerEmitter.removeListener('finished', onInstallFinished);
        throw new Error(installResult.message);
    }

    // The process has started successfully. The UI will get updates via SSE.
    console.log(`✅ Installation process for ${repository.name} has been successfully initiated.`);
    return { success: true, message: 'Installation process initiated.' };
    
  } catch (err: any) {
    console.error(`❌ Error processing ${repository.name}:`, err);
    updateRepository(repository.id, { status: 'error', statusMessage: err.message, progress: 0 });
    const action = repository.type === 'compose' ? 'installation' : 'build/deployment';
    return { success: false, message: err.message || `${action} failed` };
  }
}