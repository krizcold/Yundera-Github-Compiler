import { Repository, updateRepository, loadSettings } from './storage';
import { cloneOrUpdateRepo } from './GitHandler';
import { buildImageFromRepo } from './DockerHandler';
import { isAppInstalledInCasaOS } from './casaos-status';
import { executePreInstallCommand, executePostInstallCommand, preprocessAppstoreCompose } from './compose-processor';
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
    // We'll determine the actual app name from the compose file later
    let appName = repository.name; // Default fallback
    let hostMetadataDir = path.join('/DATA/AppData/casaos/apps', appName);
    let localImageName: string | null = null; // Track built image name for GitHub repos
    
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
      localImageName = await buildImageFromRepo(repoConfig, baseDir, true, logCollector); // true = isGitHubRepo
      log(`✅ Docker image build completed`, 'success');
      
      if (localImageName) {
        log(`🐳 Built local image: ${localImageName}`, 'info');
      }
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
    
    // Extract the actual app name from compose file's name property
    if (composeObject.name && composeObject.name !== repository.name) {
        appName = composeObject.name;
        hostMetadataDir = path.join('/DATA/AppData/casaos/apps', appName);
        log(`🏷️ Using app name from compose file: ${appName}`, 'info');
        // Update the repository display name to match the compose file
        updateRepository(repository.id, { displayName: appName });
        log(`📝 Updated repository display name to: ${appName}`, 'info');
    }

    // Only run pre-install command on FIRST installation, never on updates
    if (repository.isInstalled) {
        log(`⏭️ Skipping pre-install command - app is already installed (update mode)`, 'info');
    } else {
        log(`🚀 Executing pre-install command (first installation)...`, 'info');
        await executePreInstallCommand(composeObject, logCollector, runAsUser);
        log(`✅ Pre-install command completed successfully`, 'success');
    }
    
    // Generate app token for secure API access BEFORE compose preprocessing
    log(`🔑 Creating app token for secure API access...`, 'info');
    let appToken: string | null = null;
    try {
      const { createAppToken } = await import('./app-tokens');
      const token = createAppToken(appName, repository.id);
      appToken = token.token;
      log(`✅ App token created for ${appName}: ${appToken.substring(0, 8)}...`, 'success');
    } catch (tokenError: any) {
      log(`⚠️ Failed to create app token: ${tokenError.message}`, 'warning');
      // Continue without token - apps that don't use $API_HASH will work fine
    }
    
    log(`🔧 Loading settings and preprocessing compose file...`, 'info');
    const settings = loadSettings();
    const { rich, clean } = preprocessAppstoreCompose(composeObject, settings, localImageName, appToken);
    log(`✅ Compose file preprocessing completed`, 'success');

    // Step 3: Create all host volume paths
    log('📁 Creating host directories for app data volumes...', 'info');
    let volumeCount = 0;
    const createdPaths = new Set<string>(); // Track unique paths to avoid duplicates
    
    if (clean.services) {
        for (const serviceName in clean.services) {
            const service = clean.services[serviceName];
            if (service.volumes) {
                for (const volume of service.volumes) {
                    const hostPath = typeof volume === 'string' ? volume.split(':')[0] : volume.source;
                    if (hostPath && hostPath.startsWith('/DATA/AppData') && !createdPaths.has(hostPath)) {
                        try {
                            // Create directory using docker exec
                            const { exec } = await import('child_process');
                            const { promisify } = require('util');
                            const execAsync = promisify(exec);
                            
                            // Create directory as ubuntu user via CasaOS container
                            await execAsync(`docker exec --user ubuntu casaos mkdir -p "${hostPath}"`, {
                                timeout: 10000,
                                maxBuffer: 1024 * 1024
                            });
                            
                            // Set ownership and permissions
                            await execAsync(`docker exec casaos chown -R ubuntu:ubuntu "${hostPath}"`, {
                                timeout: 10000,
                                maxBuffer: 1024 * 1024
                            });
                            
                            await execAsync(`docker exec casaos chmod -R 755 "${hostPath}"`, {
                                timeout: 10000,
                                maxBuffer: 1024 * 1024
                            });
                            
                            createdPaths.add(hostPath);
                            volumeCount++;
                            
                        } catch (error: any) {
                            log(`⚠️ Failed to create directory ${hostPath}: ${error.message}`, 'warning');
                            // Fallback to Node.js mkdir if docker exec fails
                            try {
                                fs.mkdirSync(hostPath, { recursive: true });
                                log(`📁 Created directory ${hostPath}, fixing ownership...`, 'info');
                                
                                // Fix ownership after creating with Node.js
                                const { exec } = await import('child_process');
                                const { promisify } = require('util');
                                const execAsync = promisify(exec);
                                
                                await execAsync(`chown -R 1000:1000 "${hostPath}"`, {
                                    timeout: 5000
                                });
                                await execAsync(`chmod -R 755 "${hostPath}"`, {
                                    timeout: 5000
                                });
                                
                                log(`✅ Fixed ownership of ${hostPath} to 1000:1000`, 'success');
                                createdPaths.add(hostPath);
                                volumeCount++;
                            } catch (fallbackError: any) {
                                log(`❌ Failed to create directory: ${fallbackError.message}`, 'error');
                            }
                        }
                    }
                }
            }
        }
    }
    log(`✅ Created ${volumeCount} host volume directories`, 'success');

    // Step 4: Write the 'rich' compose file to the final destination
    const hostComposePath = path.join(hostMetadataDir, 'docker-compose.yml');
    log(`📝 Saving compose file to CasaOS metadata path: ${hostComposePath}`, 'info');
    
    // Create metadata directory with proper ownership
    try {
        const { exec } = await import('child_process');
        const { promisify } = require('util');
        const execAsync = promisify(exec);
        
        await execAsync(`docker exec --user ubuntu casaos mkdir -p "${hostMetadataDir}"`, {
            timeout: 10000,
            maxBuffer: 1024 * 1024
        });
        
        await execAsync(`docker exec casaos chown -R ubuntu:ubuntu "${hostMetadataDir}"`, {
            timeout: 10000,
            maxBuffer: 1024 * 1024
        });
    } catch (error: any) {
        log(`⚠️ Failed to create metadata directory via docker exec: ${error.message}`, 'warning');
        // Fallback to Node.js mkdir
        try {
            fs.mkdirSync(hostMetadataDir, { recursive: true });
            log(`📁 Created metadata directory ${hostMetadataDir}, fixing ownership...`, 'info');
            
            // Fix ownership after creating with Node.js
            const { exec } = await import('child_process');
            const { promisify } = require('util');
            const execAsync = promisify(exec);
            
            await execAsync(`chown -R 1000:1000 "${hostMetadataDir}"`, {
                timeout: 5000
            });
            
            await execAsync(`chmod -R 755 "${hostMetadataDir}"`, {
                timeout: 5000
            });
            
            log(`✅ Fixed ownership of metadata directory to 1000:1000`, 'success');
        } catch (fallbackError: any) {
            log(`❌ Failed to create or fix metadata directory: ${fallbackError.message}`, 'error');
        }
    }
    
    fs.writeFileSync(hostComposePath, yaml.stringify(clean));
    log(`✅ Compose file saved successfully`, 'success');

    // Fix ownership of the docker-compose.yml file to ensure CasaOS can manage it
    log(`🔧 Fixing ownership of docker-compose.yml for CasaOS management...`, 'info');
    try {
        const { exec } = await import('child_process');
        const { promisify } = require('util');
        const execAsync = promisify(exec);

        // Try to fix ownership via docker exec to CasaOS container first
        try {
            await execAsync(`docker exec casaos chown ubuntu:ubuntu "${hostComposePath}"`, {
                timeout: 10000,
                maxBuffer: 1024 * 1024
            });
            await execAsync(`docker exec casaos chmod 644 "${hostComposePath}"`, {
                timeout: 10000,
                maxBuffer: 1024 * 1024
            });
            log(`✅ Fixed docker-compose.yml ownership via CasaOS container`, 'success');
        } catch (dockerError: any) {
            // Fallback to direct chown with numeric IDs
            await execAsync(`chown 1000:1000 "${hostComposePath}"`, {
                timeout: 5000
            });
            await execAsync(`chmod 644 "${hostComposePath}"`, {
                timeout: 5000
            });
            log(`✅ Fixed docker-compose.yml ownership via direct chown`, 'success');
        }
    } catch (error: any) {
        log(`⚠️ Warning: Could not fix docker-compose.yml ownership: ${error.message}. CasaOS may have trouble managing this app.`, 'warning');
    }

    // Step 5: Install the containers by calling Docker Compose directly.
    log('🚀 Starting Docker Compose installation...', 'info');
    updateRepository(repository.id, { status: 'installing' });
    
    // Start the installation with retry logic for transient failures
    let installResult;
    let retryCount = 0;
    const maxRetries = 1; // Retry once on timeout
    
    while (retryCount <= maxRetries) {
      if (retryCount > 0) {
        log(`🔄 Retrying Docker Compose installation (attempt ${retryCount + 1}/${maxRetries + 1})...`, 'info');
        // Use longer timeout on retry (15 minutes instead of 10)
        installResult = await CasaOSInstaller.installComposeAppDirectly(hostComposePath, repository.id, logCollector, appName, !!localImageName, 900000);
      } else {
        // First attempt with default timeout (10 minutes)
        installResult = await CasaOSInstaller.installComposeAppDirectly(hostComposePath, repository.id, logCollector, appName, !!localImageName);
      }
      
      if (installResult.success) {
        break; // Success, exit retry loop
      }
      
      // Check if this is a timeout error that we should retry
      const isTimeoutError = installResult.message.includes('timed out') || installResult.message.includes('timeout');
      
      if (!isTimeoutError || retryCount >= maxRetries) {
        // Not a timeout error, or we've exceeded max retries
        const errorMsg = installResult.message;
        log(`❌ Docker Compose installation failed after ${retryCount + 1} attempt(s): ${errorMsg}`, 'error');
        throw new Error(errorMsg);
      }
      
      retryCount++;
      log(`⚠️ Installation timed out, will retry with extended timeout...`, 'warning');
    }

    // Installation completed successfully
    log(`✅ Docker Compose installation completed successfully for ${repository.name}`, 'success');
    
    // Fix ownership of any directories Docker Compose may have created as root
    log(`🔧 Fixing ownership of Docker Compose created directories...`, 'info');
    const appDataPath = `/DATA/AppData/${appName}`;
    try {
        const { exec } = await import('child_process');
        const { promisify } = require('util');
        const execAsync = promisify(exec);
        
        // Check if the app data directory exists (Docker may have created it)
        if (fs.existsSync(appDataPath)) {
            
            try {
                // Try to fix ownership via docker exec to CasaOS container first
                await execAsync(`docker exec casaos chown -R ubuntu:ubuntu "${appDataPath}"`, {
                    timeout: 10000,
                    maxBuffer: 1024 * 1024
                });
            } catch (dockerError: any) {
                // Fallback to direct chown with numeric IDs
                await execAsync(`chown -R 1000:1000 "${appDataPath}"`, {
                    timeout: 5000
                });
            }
            
            log(`✅ Fixed ownership of Docker Compose directory: ${appDataPath}`, 'success');
        } else {
        }

        // Also fix ownership of the metadata directory in case Docker Compose created additional files
        log(`🔧 Ensuring metadata directory ownership is correct...`, 'info');
        try {
            await execAsync(`docker exec casaos chown -R ubuntu:ubuntu "${hostMetadataDir}"`, {
                timeout: 10000,
                maxBuffer: 1024 * 1024
            });
            log(`✅ Fixed ownership of metadata directory: ${hostMetadataDir}`, 'success');
        } catch (metadataError: any) {
            // Fallback to direct chown with numeric IDs
            try {
                await execAsync(`chown -R 1000:1000 "${hostMetadataDir}"`, {
                    timeout: 5000
                });
                log(`✅ Fixed ownership of metadata directory via direct chown`, 'success');
            } catch (fallbackError: any) {
                log(`⚠️ Warning: Could not fix metadata directory ownership: ${fallbackError.message}`, 'warning');
            }
        }

    } catch (error: any) {
        log(`⚠️ Warning: Could not fix ownership of Docker Compose directories: ${error.message}`, 'warning');
    }
    
    log(`🔍 Verifying installation status...`, 'info');
    
    // Brief delay to allow CasaOS to recognize the new container
    log(`⏳ Waiting 3 seconds for CasaOS to recognize the new container...`, 'info');
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Use the actual app name for verification - this matches what Docker Compose uses
    const appNameToCheck = appName;
    log(`🔍 Checking app status using app name: ${appNameToCheck}`, 'info');
    
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

    // Execute post-install command if app is running successfully
    if (isRunning) {
        log(`🎉 Executing post-install command...`, 'info');
        try {
            await executePostInstallCommand(composeObject, logCollector, runAsUser);
            log(`✅ Post-install command completed`, 'success');
        } catch (error: any) {
            log(`⚠️ Post-install command failed: ${error.message}`, 'warning');
            // Continue with installation process - post-install failures are non-fatal
        }
    } else {
        log(`⏭️ Skipping post-install command - app is not running`, 'info');
    }

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