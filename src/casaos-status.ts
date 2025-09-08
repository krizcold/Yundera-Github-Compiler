import { exec } from 'child_process';
import { promisify } from 'util';
import { isAppLoggingEnabled } from './config';

const execAsync = promisify(exec);

// CasaOS status checking - try multiple endpoints
export async function getCasaOSInstalledApps(forceRefresh: boolean = false): Promise<string[]> {
  // Try multiple endpoints that might contain app information
  const endpoints = [
    '/v2/app_management/compose',
    '/v2/app_management/apps',  
    '/v1/app_management/apps'
  ];
  
  for (const endpoint of endpoints) {
    try {
      // Add cache-busting parameter if force refresh is requested
      const url = forceRefresh 
        ? `http://localhost:8080${endpoint}?_t=${Date.now()}`
        : `http://localhost:8080${endpoint}`;
        
      const command = `
        docker exec casaos sh -c "
          curl -s '${url}' \\
            -H 'Accept: application/json' \\
            -H 'Cache-Control: no-cache'
        " 2>&1
      `;
      
      const { stdout } = await execAsync(command);
      
      // Skip empty or error responses
      if (!stdout || stdout.trim() === '' || stdout.includes('Connection refused') || stdout.includes('404')) {
        continue;
      }
      
      try {
        const response = JSON.parse(stdout);
        
        // Only log when apps are found and beacon is enabled
        if (response.data && typeof response.data === 'object' && !Array.isArray(response.data)) {
          const keys = Object.keys(response.data);
          if (keys.length > 0 && isAppLoggingEnabled()) {
            console.log(`📱 Found ${keys.length} apps in CasaOS`);
          }
        }
        
        // Handle different response formats
        let appNames: string[] = [];
        
        if (response.success && response.data && Array.isArray(response.data)) {
          // Standard success response with data array
          appNames = response.data.map((app: any) => app.name || app.id || app.title).filter(Boolean);
        } else if (response.data && Array.isArray(response.data)) {
          // Data array without success field
          appNames = response.data.map((app: any) => app.name || app.id || app.title).filter(Boolean);
        } else if (response.data && typeof response.data === 'object') {
          // Data is an object - extract app names from object keys or values
          if (response.data.apps && Array.isArray(response.data.apps)) {
            // Object with apps array property
            appNames = response.data.apps.map((app: any) => app.name || app.id || app.title).filter(Boolean);
          } else if (response.data.installed && Array.isArray(response.data.installed)) {
            // /v2/app_management/apps format with installed array
            appNames = response.data.installed.map((app: any) => app.name || app.id || app.title).filter(Boolean);
          } else {
            // For /v2/app_management/compose: app names are the object keys themselves!
            const dataKeys = Object.keys(response.data);
            
            // Filter out common API metadata keys
            appNames = dataKeys.filter(key => 
              key !== 'success' && 
              key !== 'message' && 
              key !== 'data' && 
              key !== 'code' &&
              key !== 'timestamp'
            );
          }
        } else if (Array.isArray(response)) {
          // Direct array response
          appNames = response.map((app: any) => app.name || app.id || app.title).filter(Boolean);
        }
        
        if (appNames.length > 0) {
          if (isAppLoggingEnabled()) {
            console.log(`📱 CasaOS installed apps from ${endpoint}: [${appNames.join(', ')}]`);
          }
          return appNames;
        }
        
        if (isAppLoggingEnabled()) {
          console.log(`📱 ${endpoint} returned no apps`);
        }
      } catch (parseError) {
        console.log(`📱 Failed to parse response from ${endpoint}`);
        continue;
      }
    } catch (error) {
      continue;
    }
  }
  
  console.log(`📱 No apps found from any CasaOS endpoint`);
  return [];
}

// Investigate potential installation progress endpoints
export async function checkCasaOSInstallationProgress(appName: string): Promise<{
  isInstalling: boolean;
  progress?: number;
  message?: string;
} | null> {
  // Let's test some potential endpoints that might exist
  const potentialEndpoints = [
    `/v2/app_management/jobs`,
    `/v2/app_management/tasks`,
    `/v2/app_management/progress`,
    `/v2/app_management/status`,
    `/v2/app_management/apps/${appName}/status`,
    `/v2/app_management/install/status`
  ];
  
  for (const endpoint of potentialEndpoints) {
    try {
      const command = `
        docker exec casaos sh -c "
          curl -s 'http://localhost:8080${endpoint}' \\
            -H 'Accept: application/json'
        " 2>&1
      `;
      
      const { stdout } = await execAsync(command);
      
      // Check if we got a valid JSON response (not a 404 or error)
      if (!stdout.includes('404') && !stdout.includes('error') && stdout.trim().startsWith('{')) {
        console.log(`🔍 Found potential progress endpoint: ${endpoint}`);
        console.log(`📋 Response: ${stdout}`);
        
        try {
          const response = JSON.parse(stdout);
          // This endpoint exists and returns JSON - log it for investigation
          return { isInstalling: false, message: `Found endpoint: ${endpoint}` };
        } catch (e) {
          // JSON parse failed, continue
        }
      }
    } catch (error) {
      // Continue to next endpoint
    }
  }
  
  console.log(`❌ No installation progress endpoints found`);
  return null;
}

// A precise check to see if a compose app is registered with CasaOS.
export async function isAppInstalledInCasaOS(appName: string): Promise<boolean> {
  try {
    const command = `
      docker exec casaos sh -c "
        curl -s 'http://localhost:8080/v2/app_management/compose' \
          -H 'Accept: application/json'
      " 2>&1
    `;
    const { stdout } = await execAsync(command);

    if (!stdout || stdout.includes('Connection refused') || stdout.includes('404')) {
      console.error('❌ Could not connect to CasaOS API to verify installation.');
      return false;
    }

    const response = JSON.parse(stdout);

    // The app name should exist as a key in the 'data' object.
    const isInstalled = response.data && typeof response.data === 'object' && response.data.hasOwnProperty(appName);

    if (isInstalled) {
      console.log(`✅ Verification successful: App '${appName}' is installed in CasaOS.`);
    } else {
      console.log(`❌ Verification failed: App '${appName}' is not installed in CasaOS.`);
      // Log the list of actual apps for debugging
      if (response.data) {
        console.log(`ℹ️ Available apps: [${Object.keys(response.data).join(', ')}]`);
      }
    }

    return isInstalled;
  } catch (error) {
    console.error(`❌ Error checking if app ${appName} is installed:`, error);
    return false;
  }
}


export async function getCasaOSAppStatus(appName: string): Promise<{
  isInstalled: boolean;
  isRunning: boolean;
  message: string;
} | null> {
  try {
    // Check compose endpoint first (most reliable for our installed apps)
    const command = `
      docker exec casaos sh -c "
        curl -s 'http://localhost:8080/v2/app_management/compose' \\
          -H 'Accept: application/json'
      " 2>&1
    `;
    
    const { stdout } = await execAsync(command);
    
    if (stdout && !stdout.includes('Connection refused') && !stdout.includes('404')) {
      try {
        const response = JSON.parse(stdout);
        
        if (response.data && typeof response.data === 'object') {
          const appExists = response.data.hasOwnProperty(appName);
          
          if (appExists) {
            const appData = response.data[appName];
            // Try to determine running status from the app data
            let isRunning = false;
            
            if (appData && typeof appData === 'object') {
              // Look for common status indicators
              isRunning = appData.status === 'running' || 
                         appData.state === 'running' ||
                         appData.running === true;
              
              if (isAppLoggingEnabled()) {
                console.log(`🔍 App ${appName} status check:`, {
                  status: appData.status,
                  state: appData.state, 
                  running: appData.running,
                  isRunning
                });
              }
            }
            
            return {
              isInstalled: true,
              isRunning,
              message: `App ${appName} is ${isRunning ? 'running' : 'installed'}`
            };
          }
        }
      } catch (parseError) {
        // Continue to fallback methods
      }
    }
    
    // App not found in compose endpoint
    return {
      isInstalled: false,
      isRunning: false,
      message: `App ${appName} is not installed`
    };
    
  } catch (error) {
    console.error(`❌ Error getting status for ${appName}:`, error);
    return null;
  }
}

export async function verifyCasaOSInstallation(appName: string): Promise<{
  success: boolean;
  isInstalled: boolean;
  isRunning: boolean;
  message: string;
}> {
  try {
    const status = await getCasaOSAppStatus(appName);
    
    if (status) {
      return {
        success: true,
        isInstalled: status.isInstalled,
        isRunning: status.isRunning,
        message: status.message
      };
    }
    
    return {
      success: false,
      isInstalled: false,
      isRunning: false,
      message: `Unable to verify app ${appName} status`
    };
    
  } catch (error) {
    console.error(`❌ Error verifying installation for ${appName}:`, error);
    return {
      success: false,
      isInstalled: false,
      isRunning: false,
      message: `Error checking app status: ${error}`
    };
  }
}

// Perform manual cleanup of app containers, networks, and metadata
async function performManualCleanup(appName: string): Promise<void> {
  console.log(`🧹 Performing manual cleanup for ${appName}`);
  
  try {
    // 1. Stop and remove containers related to the app
    const containerCleanup = `
      # Find and stop all containers related to the app
      CONTAINERS=$(docker ps -aq --filter "name=${appName}")
      if [ ! -z "$CONTAINERS" ]; then
        echo "Stopping containers: $CONTAINERS"
        docker stop $CONTAINERS 2>/dev/null || true
        docker rm -f $CONTAINERS 2>/dev/null || true
      fi
      
      # Also try with compose project name pattern
      COMPOSE_CONTAINERS=$(docker ps -aq --filter "label=com.docker.compose.project=${appName}")
      if [ ! -z "$COMPOSE_CONTAINERS" ]; then
        echo "Stopping compose containers: $COMPOSE_CONTAINERS"
        docker stop $COMPOSE_CONTAINERS 2>/dev/null || true
        docker rm -f $COMPOSE_CONTAINERS 2>/dev/null || true
      fi
    `;
    await execAsync(containerCleanup);
    
    // 2. Remove related networks (but don't fail if they don't exist)
    const networkCleanup = `
      # Remove networks related to the app
      NETWORKS=$(docker network ls --filter "name=${appName}" --format "{{.Name}}")
      for network in $NETWORKS; do
        echo "Removing network: $network"
        docker network rm "$network" 2>/dev/null || true
      done
    `;
    await execAsync(networkCleanup);
    
    // 3. Clean up app metadata directory
    const metadataCleanup = `
      # Remove app metadata directory
      if [ -d "/DATA/AppData/casaos/apps/${appName}" ]; then
        echo "Removing metadata directory: /DATA/AppData/casaos/apps/${appName}"
        rm -rf "/DATA/AppData/casaos/apps/${appName}" 2>/dev/null || true
      fi
    `;
    await execAsync(metadataCleanup);
    
    console.log(`✅ Manual cleanup completed for ${appName}`);
  } catch (error) {
    console.error(`⚠️ Some cleanup operations failed for ${appName}:`, error);
    // Don't throw - cleanup is best effort
  }
}

// Uninstall an app from CasaOS
export async function uninstallCasaOSApp(appName: string, preserveData: boolean = false): Promise<{
  success: boolean;
  message: string;
}> {
  try {
    if (preserveData) {
      console.log(`🛡️ Preserving data - stopping containers for ${appName}`);
      
      // Stop and remove the app containers manually (but preserve data volumes)
      const stopCommand = `
        docker exec casaos sh -c "
          docker-compose -f /DATA/AppData/casaos/apps/${appName}/docker-compose.yml down --remove-orphans 2>/dev/null || 
          (docker stop \\\$(docker ps -q --filter name=${appName}) 2>/dev/null && docker rm \\\$(docker ps -aq --filter name=${appName}) 2>/dev/null) ||
          echo 'No containers found to stop'
        " 2>&1
      `;
      
      await execAsync(stopCommand);
      
      return {
        success: true,
        message: `App ${appName} stopped (data preserved)`
      };
    }
    
    // Normal uninstall - use CasaOS API (will remove data)
    const command = `
      docker exec casaos sh -c "
        curl -s -X DELETE 'http://localhost:8080/v2/app_management/compose/${appName}' \\
          -H 'Accept: application/json'
      " 2>&1
    `;
    
    const { stdout } = await execAsync(command);
    
    if (stdout.includes('Connection refused') || stdout.includes('404')) {
      // Try manual cleanup if CasaOS API is not available
      await performManualCleanup(appName);
      return {
        success: true,
        message: `App ${appName} manually cleaned up (CasaOS API unavailable)`
      };
    }
    
    let apiSuccess = false;
    try {
      const response = JSON.parse(stdout);
      // CasaOS might return different success indicators
      if (response.success !== false && !stdout.includes('error')) {
        apiSuccess = true;
      } else {
        console.log(`⚠️ CasaOS API returned error:`, response);
      }
    } catch (parseError) {
      // If it's not JSON, check if it looks like a success response
      if (stdout.includes('success') || stdout.trim() === '') {
        apiSuccess = true;
      }
    }

    // Perform additional cleanup regardless of API success
    // This ensures residual files and containers are removed
    await performManualCleanup(appName);

    return {
      success: true,
      message: apiSuccess 
        ? `App ${appName} uninstallation completed with cleanup`
        : `App ${appName} manually cleaned up (API response unclear)`
    };
    
  } catch (error) {
    console.error(`❌ Error uninstalling ${appName}:`, error);
    return {
      success: false,
      message: `Error uninstalling app: ${error}`
    };
  }
}

// Start/Stop an app in CasaOS
export async function toggleCasaOSApp(appName: string, start: boolean): Promise<{
  success: boolean;
  message: string;
}> {
  const action = start ? 'start' : 'stop';
  console.log(`🎯 Attempting to ${action} app: ${appName}`);
  
  // Primary method: Use docker-compose directly (most reliable)
  try {
    const dockerAction = start ? 'start' : 'stop';
    const composeCommand = `docker-compose -f /app/uidata/${appName}/docker-compose.yml ${dockerAction} 2>&1`;
    const { stdout: composeOutput } = await execAsync(composeCommand);
    
    console.log(`🐳 Docker-compose ${dockerAction} result:`, composeOutput);
    
    if (!composeOutput.includes('ERROR') && !composeOutput.includes('No such file') && !composeOutput.includes('failed')) {
      return {
        success: true,
        message: `App ${appName} ${dockerAction} via docker-compose`
      };
    } else {
      console.log(`⚠️ Docker-compose ${dockerAction} had issues, trying other methods...`);
    }
  } catch (composeError) {
    console.log(`❌ Docker-compose failed:`, composeError);
  }
  
  // Fallback method: Try CasaOS API
  let casaOSWorked = false;
  try {
    console.log(`🔄 Trying CasaOS API as fallback for ${appName}...`);
    
    const command = `
      docker exec casaos sh -c "
        curl -s -X POST 'http://localhost:8080/v2/app_management/compose/${appName}/${action}' \\
          -H 'Accept: application/json' \\
          -H 'Content-Type: application/json'
      " 2>&1
    `;
    
    const { stdout } = await execAsync(command);
    if (isAppLoggingEnabled()) {
      console.log(`📡 CasaOS ${action} response for ${appName}:`, stdout);
    }
    
    if (stdout.includes('Connection refused') || stdout.includes('404')) {
      console.log(`❌ Failed to connect to CasaOS API`);
    } else {
      // Parse the response - be more strict about what constitutes success
      try {
        const response = JSON.parse(stdout);
        console.log(`📊 Parsed CasaOS response:`, response);
        
        // Check for common failure indicators
        if (response.message && (
            response.message.includes('no matching operation') ||
            response.message.includes('not found') ||
            response.message.includes('error') ||
            response.message.includes('failed')
          )) {
          console.log(`⚠️ CasaOS API returned failure:`, response);
        } else if (response.success !== false && !stdout.includes('error')) {
          casaOSWorked = true;
          return {
            success: true,
            message: `App ${appName} ${action} initiated`
          };
        } else {
          console.log(`⚠️ CasaOS API returned error:`, response);
        }
      } catch (parseError) {
        console.log(`⚠️ Could not parse response as JSON:`, stdout);
        
        // If it's not JSON, check for common success/error indicators
        const lowerOutput = stdout.toLowerCase();
        
        // Common success indicators
        if (lowerOutput.includes('ok') || 
            lowerOutput.includes('success') ||
            (!lowerOutput.includes('error') && 
             !lowerOutput.includes('failed') && 
             !lowerOutput.includes('not found') &&
             !lowerOutput.includes('404'))) {
          casaOSWorked = true;
          return {
            success: true,
            message: `App ${appName} ${action} initiated (non-JSON response)`
          };
        } else {
          console.log(`⚠️ Non-JSON response indicates failure`);
        }
      }
    }
  } catch (error) {
    console.error(`❌ Error with CasaOS API:`, error);
  }

  // If CasaOS API didn't work, try direct Docker methods
  if (!casaOSWorked) {
    console.log(`🔄 CasaOS API failed, trying direct Docker methods...`);
    
    // Strategy 1: Find and control the actual container
    try {
      const dockerAction = start ? 'start' : 'stop';
      
      // First, find all containers that might be related to this app
      const listCommand = `docker ps -a --format "{{.Names}}\t{{.Status}}" | grep -i "${appName}"`;
      const { stdout: containerList } = await execAsync(listCommand);
      console.log(`🔍 Found containers for ${appName}:`, containerList);
      
      if (containerList.trim()) {
        const lines = containerList.trim().split('\n');
        for (const line of lines) {
          const containerName = line.split('\t')[0].trim();
          if (containerName) {
            console.log(`🎯 Attempting ${dockerAction} on container: ${containerName}`);
            
            try {
              const dockerCommand = `docker ${dockerAction} "${containerName}" 2>&1`;
              const { stdout: dockerOutput } = await execAsync(dockerCommand);
              
              console.log(`🐳 Direct Docker ${dockerAction} result for ${containerName}:`, dockerOutput);
              
              if (!dockerOutput.includes('Error') && !dockerOutput.includes('No such container')) {
                return {
                  success: true,
                  message: `Container ${containerName} ${dockerAction} successfully`
                };
              }
            } catch (containerError) {
              console.log(`❌ Failed to ${dockerAction} container ${containerName}:`, containerError);
            }
          }
        }
      } else {
        console.log(`❌ No containers found matching ${appName}`);
      }
    } catch (listError) {
      console.log(`❌ Failed to list containers:`, listError);
    }
  }
  
  // If all methods failed, return error
  return {
    success: false,
    message: `All methods failed to ${start ? 'start' : 'stop'} app ${appName}`
  };
}

export async function verifyDockerImageExists(imageName: string): Promise<boolean> {
  try {
    const command = `docker images --format "{{.Repository}}:{{.Tag}}" | grep -E "^${imageName.replace(':', '\\:')}$"`;
    const { stdout } = await execAsync(command);
    return stdout.trim().length > 0;
  } catch (error) {
    console.error(`❌ Error checking Docker image ${imageName}:`, error);
    return false;
  }
}

export async function getDockerContainerStatus(containerName: string): Promise<{
  exists: boolean;
  isRunning: boolean;
  status: string;
}> {
  try {
    const command = `docker ps -a --format "{{.Names}}\t{{.Status}}" | grep "^${containerName}\t" || echo "not_found"`;
    const { stdout } = await execAsync(command);
    
    if (stdout.trim() === 'not_found') {
      return { exists: false, isRunning: false, status: 'not_found' };
    }
    
    const [, status] = stdout.trim().split('\t');
    const isRunning = status.toLowerCase().includes('up');
    
    return {
      exists: true,
      isRunning,
      status: status
    };
    
  } catch (error) {
    console.error(`❌ Error checking container ${containerName}:`, error);
    return { exists: false, isRunning: false, status: 'error' };
  }
}