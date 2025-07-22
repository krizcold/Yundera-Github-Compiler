import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// CasaOS status checking using the same docker exec technique
export async function getCasaOSInstalledApps(): Promise<string[]> {
  try {
    const command = `
      docker exec casaos sh -c "
        curl -s 'http://localhost:8080/v2/app_management/apps' \\
          -H 'Accept: application/json'
      " 2>&1
    `;
    
    const { stdout } = await execAsync(command);
    const response = JSON.parse(stdout);
    
    if (response.success && response.data) {
      return response.data.map((app: any) => app.name || app.id);
    }
    
    return [];
  } catch (error) {
    console.error('❌ Error fetching CasaOS installed apps:', error);
    return [];
  }
}

export async function isAppInstalledInCasaOS(appName: string): Promise<boolean> {
  try {
    const installedApps = await getCasaOSInstalledApps();
    return installedApps.includes(appName);
  } catch (error) {
    console.error(`❌ Error checking if app ${appName} is installed:`, error);
    return false;
  }
}

export async function verifyCasaOSInstallation(appName: string): Promise<{
  success: boolean;
  isInstalled: boolean;
  isRunning: boolean;
  message: string;
}> {
  try {
    // First check if app exists in CasaOS
    const isInstalled = await isAppInstalledInCasaOS(appName);
    
    if (!isInstalled) {
      return {
        success: false,
        isInstalled: false,
        isRunning: false,
        message: `App ${appName} is not installed in CasaOS`
      };
    }
    
    // Check if app is running by querying app details
    const command = `
      docker exec casaos sh -c "
        curl -s 'http://localhost:8080/v2/app_management/apps/${appName}' \\
          -H 'Accept: application/json'
      " 2>&1
    `;
    
    const { stdout } = await execAsync(command);
    const response = JSON.parse(stdout);
    
    if (response.success && response.data) {
      const appData = response.data;
      const isRunning = appData.status === 'running' || appData.state === 'running';
      
      return {
        success: true,
        isInstalled: true,
        isRunning,
        message: `App ${appName} is ${isRunning ? 'running' : 'stopped'} in CasaOS`
      };
    }
    
    return {
      success: true,
      isInstalled: true,
      isRunning: false,
      message: `App ${appName} is installed but status unknown`
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