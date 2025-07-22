import * as fs from 'fs';
import { exec } from 'child_process';

const DOCKER_SOCKET_PATH = '/var/run/docker.sock';

const run = async () => {
  console.log('🚀 (Node Setup) Starting simplified setup script...');

  try {
    // Fix Git ownership issues for repo directories
    console.log('🔧 Fixing Git repository ownership...');
    exec('git config --global --add safe.directory "*"', (error) => {
      if (error) {
        console.log('⚠️  Could not set Git safe directory config:', error.message);
      } else {
        console.log('✅ Git safe directory config applied');
      }
    });

    // Fix ownership of repos directory
    if (fs.existsSync('/app/repos')) {
      exec('chown -R root:root /app/repos', (error) => {
        if (error) {
          console.log('⚠️  Could not fix /app/repos ownership:', error.message);
        } else {
          console.log('✅ Fixed /app/repos ownership');
        }
      });
    }

    // Setup Docker group membership if DOCKER_GID is provided
    const dockerGid = process.env.DOCKER_GID;
    if (dockerGid) {
      console.log(`🐳 Setting up Docker group with GID: ${dockerGid}`);
      exec(`groupadd -g ${dockerGid} docker || true`, (error) => {
        if (error) {
          console.log('⚠️  Could not create docker group:', error.message);
        } else {
          console.log('✅ Docker group created/exists');
        }
      });
      
      exec(`usermod -aG docker root || true`, (error) => {
        if (error) {
          console.log('⚠️  Could not add root to docker group:', error.message);
        } else {
          console.log('✅ Root user added to docker group');
        }
      });
    }

    // Check if docker.sock is available (passive monitoring)
    if (fs.existsSync(DOCKER_SOCKET_PATH)) {
      console.log(`✅ Docker socket found at ${DOCKER_SOCKET_PATH}`);
      console.log('🚀 Starting main app with Docker access...');
    } else {
      console.log(`❌ Docker socket NOT found at ${DOCKER_SOCKET_PATH}`);
      console.log('🔧 Docker socket will be mounted automatically');
      console.log('🚀 Starting main app anyway (will skip repo processing until docker.sock is available)...');
    }
    
    startMainApp();
  } catch (error) {
    console.error('❌ An error occurred during the setup process:', error);
    process.exit(1);
  }
};

const startMainApp = () => {
  console.log('🚀 Handing over to the main application...');
  const mainProcess = exec('npm run start');
  mainProcess.stdout?.pipe(process.stdout);
  mainProcess.stderr?.pipe(process.stderr);
  
  // Wait for the main process and exit with its exit code
  mainProcess.on('exit', (code) => {
    console.log(`🏁 Main application exited with code ${code}`);
    process.exit(code || 0);
  });
  
  // Handle setup script termination
  process.on('SIGTERM', () => {
    console.log('📡 Setup script received SIGTERM, terminating main process...');
    mainProcess.kill('SIGTERM');
  });
  
  process.on('SIGINT', () => {
    console.log('📡 Setup script received SIGINT, terminating main process...');
    mainProcess.kill('SIGINT');
  });
};

run();
