import { spawn } from 'child_process';
import { EventEmitter } from 'events';

// This emitter will be used to send progress updates to the UI
export const installerEmitter = new EventEmitter();

export interface CasaOSResult {
  success: boolean;
  message: string;
}

export class CasaOSInstaller {
  /**
   * Installs a compose app by spawning a `docker compose` process and capturing its output.
   * This is the definitive method that allows for rich progress tracking.
   * @param composeFilePath The absolute path to the docker-compose.yml file on the host.
   * @param repositoryId The ID of the repository being installed, for event tracking.
   */
  static installComposeAppDirectly(composeFilePath: string, repositoryId: string): Promise<CasaOSResult> {
    return new Promise((resolve) => {
      const projectName = composeFilePath.split('/').slice(-2, -1)[0];
      if (!projectName) {
        return resolve({ success: false, message: 'Could not determine project name from compose file path.' });
      }

      console.log(`🚀 Spawning Docker Compose process for: ${projectName}`);
      
      const command = 'docker';
      const args = ['compose', '-p', projectName, '-f', composeFilePath, 'up', '-d', '--remove-orphans'];
      
      const options = {
        env: { ...process.env, AppID: projectName }
      };

      const child = spawn(command, args, options);

      // Listen to stdout
      child.stdout.on('data', (data) => {
        const message = data.toString();
        console.log(`[${projectName} stdout]: ${message}`);
        installerEmitter.emit('progress', { repositoryId, message });
      });

      // Listen to stderr
      child.stderr.on('data', (data) => {
        const message = data.toString();
        console.warn(`[${projectName} stderr]: ${message}`);
        installerEmitter.emit('progress', { repositoryId, message });
      });

      // Handle process exit
      child.on('close', (code) => {
        if (code === 0) {
          console.log(`✅ Docker Compose process for ${projectName} completed successfully.`);
          installerEmitter.emit('finished', { repositoryId, success: true });
        } else {
          console.error(`❌ Docker Compose process for ${projectName} exited with code ${code}.`);
          installerEmitter.emit('finished', { repositoryId, success: false, message: `Process exited with code ${code}` });
        }
      });

      child.on('error', (err) => {
        console.error(`❌ Failed to start Docker Compose process for ${projectName}:`, err);
        installerEmitter.emit('finished', { repositoryId, success: false, message: err.message });
      });

      // Immediately resolve, as the process has been started.
      // The UI will now listen to the emitter for progress.
      resolve({ success: true, message: 'Installation process initiated.' });
    });
  }
}
