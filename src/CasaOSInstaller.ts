/**
 * CasaOS installer using direct localhost access from within container
 * This is the production version that bypasses authentication
 */

import axios from 'axios';
import { exec } from 'child_process';
import { promisify } from 'util';

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

export interface CasaOSInstallResult {
  success: boolean;
  message: string;
  endpoint?: string;
  method?: string;
  errors?: any;
}

export class CasaOSInstaller {
  private static readonly WORKING_ENDPOINT = 'http://localhost:8080/v2/app_management/compose';

  /**
   * Install a Docker Compose application via CasaOS
   * This method bypasses authentication by accessing the service directly from localhost
   */
  static async installComposeApp(composeYaml: string, appName?: string): Promise<CasaOSInstallResult> {
    try {
      console.log('🚀 Installing app via CasaOS using direct localhost access...');
      
      // The endpoint we discovered that works without authentication
      const endpoint = this.WORKING_ENDPOINT;
      
      console.log(`📡 Using endpoint: ${endpoint}`);
      console.log(`📝 Installing compose: ${composeYaml.substring(0, 100)}...`);
      
      // Execute the curl command from within the CasaOS container
      // This bypasses all authentication since we're making the request from localhost
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
      
      console.log('🔄 Executing installation...');
      const { stdout, stderr } = await execAsync(curlCommand);
      
      console.log('📤 Installation response:', stdout);
      if (stderr) {
        console.log('⚠️ stderr:', stderr);
      }
      
      // Parse the response
      try {
        const response = JSON.parse(stdout);
        
        // Check if the response indicates success
        // CasaOS responses:
        // - Success: {"message":"compose app is being installed asynchronously"}
        // - Error: {"message":"request body has an error: ..."}
        if (response.message && response.message.includes('error')) {
          return {
            success: false,
            message: `Installation failed: ${response.message}`,
            endpoint: endpoint,
            method: 'localhost_direct'
          };
        } else if (response.success === false) {
          return {
            success: false,
            message: `Installation failed: ${response.message || 'Unknown error'}`,
            endpoint: endpoint,
            method: 'localhost_direct'
          };
        } else if (response.message && response.message.includes('is being installed asynchronously')) {
          return {
            success: true,
            message: 'App installation started successfully (asynchronous)',
            endpoint: endpoint,
            method: 'localhost_direct'
          };
        } else {
          // No explicit error, consider it successful
          return {
            success: true,
            message: response.message || 'App installed successfully via direct localhost access',
            endpoint: endpoint,
            method: 'localhost_direct'
          };
        }
      } catch (parseError) {
        // If JSON parsing fails, check if the response looks successful
        if (stdout.includes('success') || stdout.includes('installed') || stdout.includes('created')) {
          return {
            success: true,
            message: 'App installed successfully (non-JSON response)',
            endpoint: endpoint,
            method: 'localhost_direct'
          };
        } else if (stdout.includes('error') || stdout.includes('Error') || stdout.includes('fail')) {
          return {
            success: false,
            message: `Installation failed: ${stdout}`,
            endpoint: endpoint,
            method: 'localhost_direct'
          };
        } else {
          return {
            success: false,
            message: `Installation response not parseable: ${stdout}`,
            endpoint: endpoint,
            method: 'localhost_direct'
          };
        }
      }
      
    } catch (error) {
      console.error('❌ Installation error:', (error as Error).message);
      return {
        success: false,
        message: `Installation failed: ${(error as Error).message}`,
        endpoint: this.WORKING_ENDPOINT,
        method: 'localhost_direct'
      };
    }
  }

  /**
   * Test the connection to ensure the endpoint is accessible
   */
  static async testConnection(): Promise<boolean> {
    try {
      console.log('🔍 Testing connection to CasaOS API...');
      
      const testCommand = `
        docker exec casaos sh -c "
          curl -s -f '${this.WORKING_ENDPOINT}' -H 'Accept: application/json'
        " 2>&1
      `;
      
      const { stdout } = await execAsync(testCommand);
      
      // If we get JSON data back, the endpoint is working
      try {
        JSON.parse(stdout);
        console.log('✅ Connection test successful - endpoint is accessible');
        return true;
      } catch {
        // Even if JSON parsing fails, if we get data, it's likely working
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
    try {
      const getCommand = `
        docker exec casaos sh -c "
          curl -s '${this.WORKING_ENDPOINT}' -H 'Accept: application/json'
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