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
  force: boolean = false,
  logCollector?: any,
  runAsUser?: string
): Promise<{ success: boolean; message:string }> {
  
  // Helper function to log both to console and stream
  const log = (message: string, type: 'system' | 'info' | 'warning' | 'error' | 'success' = 'info') => {
    console.log(message);
    if (logCollector) {
      logCollector.addLog(message, type);
    }
  };
  
  try {
    // Phase 0: Force clean any previous installations
    log(`🧹 Force cleaning previous installation directories for ${repository.name}...`, 'info');
    const hostMetadataDir = path.join('/DATA/AppData/casaos/apps', repository.name);
    const hostDataDir = path.join('/DATA/AppData', repository.name);
    
    try {
      fs.rmSync(hostMetadataDir, { recursive: true, force: true });
      fs.rmSync(hostDataDir, { recursive: true, force: true });
      log(`✅ Cleaned up previous installation directories`, 'success');
    } catch (e: any) {
      const errorMsg = `Failed to clean up previous installation: ${e.message}`;
      log(`❌ ${errorMsg}`, 'error');
      throw new Error(errorMsg);
    }

    // Phase 1: Build image if it's a GitHub repo
    if (repository.type === 'github') {
      log(`🔄 Updating repository status to 'building'...`, 'info');
      updateRepository(repository.id, { status: 'building' });
      
      const repoConfig = { url: repository.url!, path: repository.name, autoUpdate: repository.autoUpdate };
      
      log(`📥 Cloning/updating repository from ${repository.url}...`, 'info');
      cloneOrUpdateRepo(repoConfig, baseDir);
      log(`✅ Repository clone/update completed`, 'success');
      
      log(`🏗️ Building Docker image from repository...`, 'info');
      updateRepository(repository.id, { status: 'building' });
      await buildImageFromRepo(repoConfig, baseDir);
      log(`✅ Docker image build completed`, 'success');
    }

    // Phase 2: Pre-process the compose file
    log(`🔄 Updating repository status to 'installing'...`, 'info');
    updateRepository(repository.id, { status: 'installing' });
    
    log(`📋 Looking for docker-compose.yml file...`, 'info');
    const internalComposePath = path.join('/app/uidata', repository.name, 'docker-compose.yml');
    if (!fs.existsSync(internalComposePath)) {
        const errorMsg = `Source docker-compose.yml not found at ${internalComposePath}.`;
        log(`❌ ${errorMsg}`, 'error');
        throw new Error(errorMsg);
    }
    
    log(`✅ Found docker-compose.yml, parsing...`, 'success');
    const rawYaml = fs.readFileSync(internalComposePath, 'utf8');
    const composeObject = yaml.parse(rawYaml);

    log(`🚀 Executing pre-install command...`, 'info');
    await executePreInstallCommand(composeObject, logCollector, runAsUser);
    log(`✅ Pre-install command completed successfully`, 'success');
    
    log(`🔧 Loading settings and preprocessing compose file...`, 'info');
    const settings = loadSettings();
    const { rich } = preprocessAppstoreCompose(composeObject, settings);
    log(`✅ Compose file preprocessing completed`, 'success');

    // Step 3: Proactively create all host volume paths
    log('📁 Pre-creating host directories for app data volumes...', 'info');
    let volumeCount = 0;
    if (rich.services) {
        for (const serviceName in rich.services) {
            const service = rich.services[serviceName];
            if (service.volumes) {
                for (const volume of service.volumes) {
                    const hostPath = typeof volume === 'string' ? volume.split(':')[0] : volume.source;
                    if (hostPath && hostPath.startsWith('/DATA/AppData')) {
                        fs.mkdirSync(hostPath, { recursive: true });
                        volumeCount++;
                    }
                }
            }
        }
    }
    log(`✅ Created ${volumeCount} host volume directories`, 'success');

    // Step 4: Write the 'rich' compose file to the final destination
    const hostComposePath = path.join(hostMetadataDir, 'docker-compose.yml');
    log(`📝 Saving compose file to CasaOS metadata path: ${hostComposePath}`, 'info');
    fs.mkdirSync(hostMetadataDir, { recursive: true });
    fs.writeFileSync(hostComposePath, yaml.stringify(rich));
    log(`✅ Compose file saved successfully`, 'success');

    // Step 5: Install the containers by calling Docker Compose directly.
    log('🚀 Starting Docker Compose installation...', 'info');
    updateRepository(repository.id, { status: 'installing' });
    
    // Start the installation and wait for completion
    const installResult = await CasaOSInstaller.installComposeAppDirectly(hostComposePath, repository.id, logCollector);

    if (!installResult.success) {
        const errorMsg = installResult.message;
        log(`❌ Docker Compose installation failed: ${errorMsg}`, 'error');
        throw new Error(errorMsg);
    }

    // Installation completed successfully
    log(`✅ Docker Compose installation completed successfully for ${repository.name}`, 'success');
    log(`🔍 Verifying installation status...`, 'info');
    
    // Brief delay to allow CasaOS to recognize the new container
    log(`⏳ Waiting 3 seconds for CasaOS to recognize the new container...`, 'info');
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Get the actual app name to check
    let appNameToCheck = repository.name;
    if (fs.existsSync(internalComposePath)) {
        try {
            const composeContent = fs.readFileSync(internalComposePath, 'utf8');
            const composeData = yaml.parse(composeContent);
            if (composeData.services && Object.keys(composeData.services).length > 0) {
                appNameToCheck = Object.keys(composeData.services)[0];
                log(`🔍 Checking app status using service name: ${appNameToCheck}`, 'info');
            }
        } catch (error) {
            log(`⚠️ Could not parse compose file for service name, using repository name`, 'warning');
        }
    }
    
    // Verify installation status directly
    log(`🔍 Checking if app is running in CasaOS...`, 'info');
    const isRunning = await isAppInstalledInCasaOS(appNameToCheck);
    updateRepository(repository.id, { 
        status: 'success',
        isInstalled: true,
        isRunning: isRunning
    });
    
    const statusMessage = isRunning ? 'App is running successfully' : 'App installed but not running';
    log(`✅ Installation process completed. ${statusMessage}`, 'success');
    
    // Trigger immediate sync to update UI
    log(`🔄 Triggering UI sync...`, 'info');
    setTimeout(async () => {
        const { syncWithCasaOS } = await import('./index');
        await syncWithCasaOS();
    }, 1000);
    
    log(`🎉 All installation steps completed successfully!`, 'success');
    return { success: true, message: 'Installation completed successfully.' };
    
  } catch (err: any) {
    const errorMsg = `❌ Error processing ${repository.name}: ${err.message}`;
    console.error(errorMsg, err);
    if (logCollector) {
        logCollector.addLog(errorMsg, 'error');
        logCollector.addLog(`💀 Build process terminated with error`, 'error');
    }
    updateRepository(repository.id, { status: 'error' });
    const action = repository.type === 'compose' ? 'installation' : 'build/deployment';
    return { success: false, message: err.message || `${action} failed` };
  }
}