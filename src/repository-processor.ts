import { Repository, updateRepository } from './storage';
import { cloneOrUpdateRepo } from './GitHandler';
import { buildAndDeployRepo } from './DockerHandler';
import { verifyCasaOSInstallation, checkCasaOSInstallationProgress } from './casaos-status';
import * as fs from 'fs';
import * as path from 'path';

const baseDir = "/app/repos";

/** 
 * Process one repository: clone/pull + build/deploy with status verification
 * This function is extracted to avoid circular imports with build-queue
 */
export async function processRepo(
  repository: Repository,
  force: boolean = false
): Promise<{ success: boolean; message: string }> {
  if (!force && !repository.autoUpdate) {
    console.log(`🔕 Auto-update disabled for ${repository.name}`);
    return { success: false, message: "Auto-update disabled" };
  }
  
  try {
    // Update status to building
    updateRepository(repository.id, { status: 'building' });
    
    // Create temporary repo config for compatibility with existing handlers
    const repoConfig = {
      url: repository.url,
      path: repository.name,
      autoUpdate: repository.autoUpdate
    };
    
    console.log(`🔨 Building ${repository.name}...`);
    
    // Clone/update and build/deploy
    cloneOrUpdateRepo(repoConfig, baseDir);
    await buildAndDeployRepo(repoConfig, baseDir);
    
    // Build completed successfully - mark as success regardless of verification
    updateRepository(repository.id, { 
      status: 'success',
      lastBuildTime: new Date().toISOString()
    });
    console.log(`✅ Build and deployment completed for ${repository.name}`);
    
    // Attempt verification using actual app name from docker-compose.yml
    let appNameToVerify = repository.name;
    
    // Try to extract actual app name from docker-compose.yml
    const composePath = path.join('/app/uidata', repository.name, 'docker-compose.yml');
    if (fs.existsSync(composePath)) {
      try {
        const yaml = await import('yaml');
        const composeContent = fs.readFileSync(composePath, 'utf8');
        const composeData = yaml.parse(composeContent);
        
        // Get the first service name (which becomes the app name in CasaOS)
        const services = composeData.services;
        if (services && Object.keys(services).length > 0) {
          appNameToVerify = Object.keys(services)[0];
          console.log(`🔍 Using app name from docker-compose.yml: ${appNameToVerify}`);
        }
      } catch (error: any) {
        console.log(`⚠️ Could not parse docker-compose.yml to extract app name: ${error.message}`);
      }
    }
    
    console.log(`🔍 Verifying installation of ${appNameToVerify} (repo: ${repository.name})...`);
    
    // First, investigate what installation progress endpoints might exist
    console.log(`🔬 Investigating CasaOS installation progress endpoints...`);
    await checkCasaOSInstallationProgress(appNameToVerify);
    
    // Wait a bit for CasaOS async installation to complete
    console.log(`⏳ Waiting 5 seconds for CasaOS async installation to complete...`);
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    try {
      const verification = await verifyCasaOSInstallation(appNameToVerify);
      
      if (verification.success && verification.isInstalled) {
        // Check if the app is also running after installation
        const { getCasaOSAppStatus } = await import('./casaos-status');
        let isRunning = false;
        try {
          const runningStatus = await getCasaOSAppStatus(appNameToVerify);
          isRunning = runningStatus?.isRunning || false;
          console.log(`🔍 Post-install running status for ${appNameToVerify}: ${isRunning}`);
        } catch (error: any) {
          console.log(`⚠️ Could not check running status after install: ${error.message}`);
        }
        
        updateRepository(repository.id, { 
          isInstalled: true,
          isRunning: isRunning
        });
        console.log(`✅ Installation verified for ${appNameToVerify} (running: ${isRunning})`);
        return { 
          success: true, 
          message: `Build completed successfully. ${verification.message}` 
        };
      } else {
        console.log(`⚠️ Could not verify installation: ${verification.message}`);
        console.log(`ℹ️ This may be normal if app name differs from repository name`);
        
        // Since build was successful, assume app is installed even if verification failed
        // Try to get running status anyway
        const { getCasaOSAppStatus } = await import('./casaos-status');
        let isRunning = false;
        try {
          const runningStatus = await getCasaOSAppStatus(appNameToVerify);
          isRunning = runningStatus?.isRunning || false;
          console.log(`🔍 Fallback running status check for ${appNameToVerify}: ${isRunning}`);
        } catch (error: any) {
          console.log(`⚠️ Could not check running status in fallback: ${error.message}`);
        }
        
        updateRepository(repository.id, { 
          isInstalled: true,
          isRunning: isRunning
        });
        console.log(`📦 Marking as installed based on successful build (running: ${isRunning}) - sync will verify later`);
        
        return { 
          success: true, 
          message: `Build completed successfully. Note: Could not verify installation (${verification.message})` 
        };
      }
    } catch (verifyError: any) {
      console.log(`⚠️ Verification check failed: ${verifyError.message}`);
      
      // Since build was successful, assume app is installed even if verification failed
      updateRepository(repository.id, { isInstalled: true });
      console.log(`📦 Marking as installed based on successful build - sync will verify later`);
      
      return { 
        success: true, 
        message: `Build completed successfully. Note: Could not verify installation due to verification error` 
      };
    }
    
  } catch (err: any) {
    console.error(`❌ Error building ${repository.name}:`, err);
    updateRepository(repository.id, { status: 'error' });
    return { success: false, message: err.message || "Build/deployment failed" };
  }
}