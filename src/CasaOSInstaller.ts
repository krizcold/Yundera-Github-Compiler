/**
 * CasaOS installer using direct localhost access from within container
 * This is the production version that bypasses authentication
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import axios from 'axios';

// Type definitions
export interface DockerComposeSpec {
  name?: string;
  version?: string;
  services: Record<string, any>;
  volumes?: Record<string, any>;
  networks?: Record<string, any>;
  "x-casaos"?: {
    main: string;
    architectures?: string[];
    author?: string;
    category?: string;
    description?: Record<string, string>;
    developer?: string;
    icon?: string;
    screenshot_link?: string[];
    tagline?: Record<string, string>;
    thumbnail?: string;
    tips?: Record<string, any>;
    title?: Record<string, string>;
    index?: string;
    port_map?: string;
    scheme?: string;
    store_app_id?: string;
    is_uncontrolled?: boolean;
    webui_port?: number;
    hostname?: string;
  };
}

const execAsync = promisify(exec);

export interface CasaOSResult {
  success: boolean;
  message: string;
  endpoint?: string;
  method?: string;
  errors?: any;
}

export class CasaOSInstaller {
  private static readonly BASE_ENDPOINT = 'http://localhost:8080/v2/app_management';
  
  /**
   * Install a Docker Compose application via CasaOS
   */
  static async installComposeApp(composeYaml: string, appName?: string): Promise<CasaOSResult> {
    const endpoint = `${this.BASE_ENDPOINT}/compose`;
    try {
      console.log('🚀 Installing app via CasaOS API...');
      
      const curlCommand = `
        docker exec casaos sh -c "
          curl -s -X POST '${endpoint}' \\
            -H 'Content-Type: application/yaml' \\
            -H 'Accept: application/json' \\
            --data-binary @- <<'EOF'
${composeYaml}
EOF
        " 2>&1
      `;
      
      const { stdout } = await execAsync(curlCommand);
      console.log('📤 Installation response:', stdout);
      
      if (stdout.includes("error") || stdout.includes("fail")) {
        return { success: false, message: `Installation failed: ${stdout}` };
      }
      return { success: true, message: `Installation command sent. Response: ${stdout}` };
      
    } catch (error) {
      console.error('❌ Installation error:', (error as Error).message);
      return { success: false, message: `Installation failed: ${(error as Error).message}` };
    }
  }

  /**
   * Get the actual app name from CasaOS to ensure we're using the correct identifier
   */
  static async getActualAppName(searchTerm: string = 'yundera'): Promise<string> {
    try {
      const apps = await this.getInstalledApps();
      if (apps && apps.data) {
        const foundApp = apps.data.find((app: any) => 
          app.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
          app.name?.toLowerCase().includes('github') ||
          app.name?.toLowerCase().includes('compiler')
        );
        
        if (foundApp) {
          console.log(`✅ Found app with name: ${foundApp.name}`);
          return foundApp.name;
        }
      }
      
      console.log(`⚠️  App not found, using default: ${searchTerm}`);
      return searchTerm;
    } catch (error) {
      console.log(`⚠️  Error getting app name: ${(error as Error).message}`);
      return searchTerm;
    }
  }

  /**
   * Restarts a compose app by updating the compose file.
   * The background handler monitors the file for docker.sock changes and triggers restart.
   */
  static async restartApp(appName: string): Promise<CasaOSResult> {
    try {
      console.log(`🚀 Docker-compose file updated with docker.sock mount.`);
      console.log(`📡 Background handler should detect the change and trigger restart automatically.`);
      console.log(`🔍 You can check the handler log at: /tmp/yundera-restart.log (on host system)`);
      
      // The setup.ts script has already updated the docker-compose.yml file
      // The background handler will detect the docker.sock mount and trigger restart
      return {
        success: true,
        message: "Docker-compose file updated. Background handler will trigger restart automatically.",
        endpoint: 'file-monitoring',
        method: 'file-watch'
      };
      
    } catch (error: any) {
      console.error(`❌ Failed to signal restart: ${error.message}`);
      return {
        success: false,
        message: `Failed to signal restart: ${error.message}`,
        endpoint: 'file-monitoring',
        method: 'file-watch'
      };
    }
  }

  /**
   * Test the connection to ensure the endpoint is accessible
   */
  static async testConnection(): Promise<boolean> {
    const endpoint = `${this.BASE_ENDPOINT}/compose`;
    try {
      console.log('🔍 Testing connection to CasaOS API...');
      
      const testCommand = `
        docker exec casaos sh -c "
          curl -s -f '${endpoint}' -H 'Accept: application/json'
        " 2>&1
      `;
      
      const { stdout } = await execAsync(testCommand);
      
      try {
        JSON.parse(stdout);
        console.log('✅ Connection test successful - endpoint is accessible');
        return true;
      } catch {
        if (stdout && stdout.length > 10 && !stdout.includes('Connection refused')) {
          console.log('✅ Connection test successful - endpoint responds');
          return true;
        }
        return false;
      }
      
    } catch (error) {
      console.error('❌ Connection test failed:', (error as Error).message);
      return false;
    }
  }

  /**
   * Get current compose apps from CasaOS
   */
  static async getInstalledApps(): Promise<any> {
    const endpoint = `${this.BASE_ENDPOINT}/compose`;
    try {
      const getCommand = `
        docker exec casaos sh -c "
          curl -s '${endpoint}' -H 'Accept: application/json'
        " 2>&1
      `;
      
      const { stdout } = await execAsync(getCommand);
      return JSON.parse(stdout);
      
    } catch (error) {
      console.error('❌ Failed to get installed apps:', (error as Error).message);
      return null;
    }
  }
}