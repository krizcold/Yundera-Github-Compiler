import { Repository, updateRepository, loadSettings } from './storage';
import { cloneOrUpdateRepo } from './GitHandler';
import { buildImageFromRepo } from './DockerHandler';
import { isAppInstalledInCasaOS } from './casaos-status';
import { executePreInstallCommand, preprocessAppstoreCompose } from './compose-processor';
import { CasaOSInstaller } from './CasaOSInstaller';
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
      updateRepository(repository.id, { status: 'building' });
      const repoConfig = { url: repository.url!, path: repository.name, autoUpdate: repository.autoUpdate };
      cloneOrUpdateRepo(repoConfig, baseDir);
      
      updateRepository(repository.id, { status: 'building' });
      await buildImageFromRepo(repoConfig, baseDir);
    }

    // Phase 2: Pre-process the compose file
    updateRepository(repository.id, { status: 'installing' });
    
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
    updateRepository(repository.id, { status: 'installing' });
    
    // Start the installation and wait for completion
    const installResult = await CasaOSInstaller.installComposeAppDirectly(hostComposePath, repository.id);

    if (!installResult.success) {
        throw new Error(installResult.message);
    }

    // Installation completed successfully
    console.log(`✅ Installation completed successfully for ${repository.name}. Verifying...`);
    
    // Brief delay to allow CasaOS to recognize the new container
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Get the actual app name to check
    let appNameToCheck = repository.name;
    if (fs.existsSync(internalComposePath)) {
        try {
            const composeContent = fs.readFileSync(internalComposePath, 'utf8');
            const composeData = yaml.parse(composeContent);
            if (composeData.services && Object.keys(composeData.services).length > 0) {
                appNameToCheck = Object.keys(composeData.services)[0];
            }
        } catch (error) {
            // Fallback to repo name
        }
    }
    
    // Verify installation status directly
    const isRunning = await isAppInstalledInCasaOS(appNameToCheck);
    updateRepository(repository.id, { 
        status: 'success',
        isInstalled: true,
        isRunning: isRunning
    });
    
    console.log(`✅ Installation process for ${repository.name} completed successfully. App running: ${isRunning}`);
    
    // Trigger immediate sync to update UI
    setTimeout(async () => {
        const { syncWithCasaOS } = await import('./index');
        await syncWithCasaOS();
    }, 1000);
    
    return { success: true, message: 'Installation completed successfully.' };
    
  } catch (err: any) {
    console.error(`❌ Error processing ${repository.name}:`, err);
    updateRepository(repository.id, { status: 'error' });
    const action = repository.type === 'compose' ? 'installation' : 'build/deployment';
    return { success: false, message: err.message || `${action} failed` };
  }
}