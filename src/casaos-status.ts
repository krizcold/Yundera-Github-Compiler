import { exec } from 'child_process';
import { promisify } from 'util';

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
        
        // Only log when apps are found (remove verbose debugging)
        if (response.data && typeof response.data === 'object' && !Array.isArray(response.data)) {
          const keys = Object.keys(response.data);
          if (keys.length > 0) {
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
          console.log(`📱 CasaOS installed apps from ${endpoint}: [${appNames.join(', ')}]`);
          return appNames;
        }
        
        console.log(`📱 ${endpoint} returned no apps`);
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

export async function isAppInstalledInCasaOS(appName: string): Promise<boolean> {
  try {
    const installedApps = await getCasaOSInstalledApps();
    
    // Exact match first
    if (installedApps.includes(appName)) {
      return true;
    }
    
    // Try fuzzy matching - check if any installed app contains the repo name or vice versa
    const normalizedAppName = appName.toLowerCase().replace(/[-_]/g, '');
    for (const installedApp of installedApps) {
      const normalizedInstalled = installedApp.toLowerCase().replace(/[-_]/g, '');
      
      // Check if either name contains the other (accounting for common naming patterns)
      if (normalizedAppName.includes(normalizedInstalled) || 
          normalizedInstalled.includes(normalizedAppName) ||
          normalizedAppName.replace('mirror', '') === normalizedInstalled ||
          normalizedInstalled === normalizedAppName.replace('mirror', '')) {
        console.log(`🔍 Found potential match: "${appName}" ≈ "${installedApp}"`);
        return true;
      }
    }
    
    return false;
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

// Uninstall an app from CasaOS
export async function uninstallCasaOSApp(appName: string): Promise<{
  success: boolean;
  message: string;
}> {
  try {
    const command = `
      docker exec casaos sh -c "
        curl -s -X DELETE 'http://localhost:8080/v2/app_management/compose/${appName}' \\
          -H 'Accept: application/json'
      " 2>&1
    `;
    
    const { stdout } = await execAsync(command);
    
    if (stdout.includes('Connection refused') || stdout.includes('404')) {
      return {
        success: false,
        message: `Failed to connect to CasaOS API for uninstall`
      };
    }
    
    try {
      const response = JSON.parse(stdout);
      // CasaOS might return different success indicators
      if (response.success !== false && !stdout.includes('error')) {
        return {
          success: true,
          message: `App ${appName} uninstallation initiated`
        };
      } else {
        return {
          success: false,
          message: response.message || `Failed to uninstall ${appName}`
        };
      }
    } catch (parseError) {
      // If it's not JSON, check if it looks like a success response
      if (stdout.includes('success') || stdout.trim() === '') {
        return {
          success: true,
          message: `App ${appName} uninstallation initiated`
        };
      } else {
        return {
          success: false,
          message: `Uninstall response unclear: ${stdout}`
        };
      }
    }
    
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
  try {
    const action = start ? 'start' : 'stop';
    const command = `
      docker exec casaos sh -c "
        curl -s -X POST 'http://localhost:8080/v2/app_management/compose/${appName}/${action}' \\
          -H 'Accept: application/json'
      " 2>&1
    `;
    
    const { stdout } = await execAsync(command);
    
    if (stdout.includes('Connection refused') || stdout.includes('404')) {
      return {
        success: false,
        message: `Failed to connect to CasaOS API for ${action}`
      };
    }
    
    try {
      const response = JSON.parse(stdout);
      if (response.success !== false && !stdout.includes('error')) {
        return {
          success: true,
          message: `App ${appName} ${action} initiated`
        };
      } else {
        return {
          success: false,
          message: response.message || `Failed to ${action} ${appName}`
        };
      }
    } catch (parseError) {
      // If it's not JSON, assume success if no error indicators
      if (!stdout.includes('error') && !stdout.includes('failed')) {
        return {
          success: true,
          message: `App ${appName} ${action} initiated`
        };
      } else {
        return {
          success: false,
          message: `${action} response unclear: ${stdout}`
        };
      }
    }
    
  } catch (error) {
    console.error(`❌ Error ${start ? 'starting' : 'stopping'} ${appName}:`, error);
    return {
      success: false,
      message: `Error ${start ? 'starting' : 'stopping'} app: ${error}`
    };
  }
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