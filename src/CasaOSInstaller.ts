import { spawn } from 'child_process';

export interface CasaOSResult {
  success: boolean;
  message: string;
}


export class CasaOSInstaller {
  static installComposeAppDirectly(composeFilePath: string, repositoryId: string, logCollector?: any, projectName?: string, hasLocalImage?: boolean): Promise<CasaOSResult> {
    return new Promise((resolve) => {
      // Use provided project name or extract from path as fallback
      const finalProjectName = projectName || composeFilePath.split('/').slice(-2, -1)[0];
      if (!finalProjectName) {
        return resolve({ success: false, message: 'Could not determine project name from compose file path.' });
      }

      console.log(`🚀 Spawning Docker Compose process for: ${finalProjectName}`);
      
      const command = 'docker';
      // Don't use --pull=always for local builds to avoid pulling from registry
      const args = ['compose', '-p', finalProjectName, '-f', composeFilePath, 'up', '-d', '--remove-orphans'];
      if (!hasLocalImage) {
        args.push('--pull=always'); // Only pull for non-local images
      }
      
      const child = spawn(command, args);

      const processLog = (data: Buffer) => {
        const message = data.toString();
        const lines = message.split(/[\r\n]+/);
        
        lines.forEach(line => {
          if (!line) return;
          console.log(`[${finalProjectName} log]: ${line}`);
          
          
          // Also send to log collector for terminal display
          if (logCollector) {
            logCollector.addLog(`🐳 ${line}`, 'info');
          }
        });
      };

      child.stdout.on('data', processLog);
      child.stderr.on('data', processLog);

      child.on('close', (code) => {
        if (code === 0) {
          console.log(`✅ Docker Compose process for ${finalProjectName} completed successfully.`);
          resolve({ success: true, message: 'Installation completed successfully.' });
        } else {
          console.error(`❌ Docker Compose process for ${finalProjectName} exited with code ${code}.`);
          const errorMessage = `Installation failed (exit code: ${code})`;
          resolve({ success: false, message: errorMessage });
        }
      });

      child.on('error', (err) => {
        console.error(`❌ Failed to start Docker Compose process for ${finalProjectName}:`, err);
        resolve({ success: false, message: `Failed to start installer: ${err.message}` });
      });

      // Do not resolve here, resolve in close/error handlers
    });
  }
}
