import { spawn } from 'child_process';

export interface CasaOSResult {
  success: boolean;
  message: string;
}


export class CasaOSInstaller {
  static installComposeAppDirectly(composeFilePath: string, repositoryId: string, logCollector?: any): Promise<CasaOSResult> {
    return new Promise((resolve) => {
      const projectName = composeFilePath.split('/').slice(-2, -1)[0];
      if (!projectName) {
        return resolve({ success: false, message: 'Could not determine project name from compose file path.' });
      }

      console.log(`🚀 Spawning Docker Compose process for: ${projectName}`);
      
      const command = 'docker';
      const args = ['compose', '-p', projectName, '-f', composeFilePath, 'up', '-d', '--remove-orphans', '--pull=always'];
      
      const child = spawn(command, args);

      const processLog = (data: Buffer) => {
        const message = data.toString();
        const lines = message.split(/[\r\n]+/);
        
        lines.forEach(line => {
          if (!line) return;
          console.log(`[${projectName} log]: ${line}`);
          
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
          console.log(`✅ Docker Compose process for ${projectName} completed successfully.`);
          resolve({ success: true, message: 'Installation completed successfully.' });
        } else {
          console.error(`❌ Docker Compose process for ${projectName} exited with code ${code}.`);
          const errorMessage = `Installation failed (exit code: ${code})`;
          resolve({ success: false, message: errorMessage });
        }
      });

      child.on('error', (err) => {
        console.error(`❌ Failed to start Docker Compose process for ${projectName}:`, err);
        resolve({ success: false, message: `Failed to start installer: ${err.message}` });
      });

      // Do not resolve here, resolve in close/error handlers
    });
  }
}
