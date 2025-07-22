import { Repository, updateRepository } from './storage';
import { cloneOrUpdateRepo } from './GitHandler';
import { buildAndDeployRepo } from './DockerHandler';
import { verifyCasaOSInstallation } from './casaos-status';

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
    
    // Attempt verification (but don't fail on verification issues)
    console.log(`🔍 Verifying installation of ${repository.name}...`);
    try {
      const verification = await verifyCasaOSInstallation(repository.name);
      
      if (verification.success && verification.isInstalled) {
        updateRepository(repository.id, { isInstalled: true });
        console.log(`✅ Installation verified: ${verification.message}`);
        return { 
          success: true, 
          message: `Build completed successfully. ${verification.message}` 
        };
      } else {
        console.log(`⚠️ Could not verify installation: ${verification.message}`);
        console.log(`ℹ️ This may be normal if app name differs from repository name`);
        return { 
          success: true, 
          message: `Build completed successfully. Note: Could not verify installation (${verification.message})` 
        };
      }
    } catch (verifyError: any) {
      console.log(`⚠️ Verification check failed: ${verifyError.message}`);
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