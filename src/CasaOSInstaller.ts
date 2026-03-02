import { spawn } from 'child_process';

export interface CasaOSResult {
  success: boolean;
  message: string;
}


export class CasaOSInstaller {
  static installComposeAppDirectly(composeFilePath: string, repositoryId: string, logCollector?: any, projectName?: string, hasLocalImage?: boolean, timeoutMs: number = 600000): Promise<CasaOSResult> {
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

      // Set up timeout to prevent indefinite hanging
      const timeout = setTimeout(() => {
        console.log(`⏰ Docker Compose operation timed out after ${timeoutMs}ms for ${finalProjectName}`);
        child.kill('SIGTERM');
        // Give it 5 seconds to clean up, then force kill
        setTimeout(() => {
          if (!child.killed) {
            child.kill('SIGKILL');
          }
        }, 5000);
        resolve({ success: false, message: `Installation timed out after ${Math.round(timeoutMs / 1000)} seconds. This may indicate a network issue or resource constraint.` });
      }, timeoutMs);

      // Regex to detect Docker layer progress lines (download bars, extraction timers, etc.)
      // These get marked as 'progress' so the frontend can update them in-place per layer
      const dockerProgressPattern = /^([a-f0-9]+) (Downloading \[|Extracting \d|Waiting$|Pulling fs layer$|Verifying Checksum$|Download complete$)/;

      const processLog = (data: Buffer) => {
        const message = data.toString();
        // Strip ANSI escape codes (colors, cursor movement, line clearing)
        const clean = message.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');

        // Split on all line separators
        const lines = clean.split(/[\r\n]+/);

        lines.forEach(line => {
          const trimmed = line.trim();
          if (!trimmed) return;

          // Detect Docker layer progress lines and mark them with their layer hash
          // so the frontend can replace-in-place per layer
          const progressMatch = trimmed.match(dockerProgressPattern);
          if (progressMatch) {
            console.log(`[${finalProjectName} log]: ${trimmed}`);
            if (logCollector) {
              logCollector.addLog(`🐳 ${trimmed}`, 'progress');
            }
            return;
          }

          console.log(`[${finalProjectName} log]: ${trimmed}`);
          if (logCollector) {
            logCollector.addLog(`🐳 ${trimmed}`, 'info');
          }
        });
      };

      child.stdout.on('data', processLog);
      child.stderr.on('data', processLog);

      child.on('close', (code) => {
        clearTimeout(timeout); // Clear timeout on completion

        // Clean up listeners to prevent memory leaks
        child.stdout.removeAllListeners();
        child.stderr.removeAllListeners();
        child.removeAllListeners();

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
        clearTimeout(timeout); // Clear timeout on error

        // Clean up listeners to prevent memory leaks
        child.stdout.removeAllListeners();
        child.stderr.removeAllListeners();
        child.removeAllListeners();

        console.error(`❌ Failed to start Docker Compose process for ${finalProjectName}:`, err);
        resolve({ success: false, message: `Failed to start installer: ${err.message}` });
      });

      // Do not resolve here, resolve in close/error handlers
    });
  }
}
