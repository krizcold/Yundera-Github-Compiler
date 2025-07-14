import * as fs from 'fs';
import * as yaml from 'js-yaml';
import { exec } from 'child_process';

const COMPOSE_FILE_PATH = '/app/casaos-config/docker-compose.yml';
const SERVICE_NAME = 'yunderagithubcompiler';
const DOCKER_SOCKET_PATH = '/var/run/docker.sock';

interface DockerCompose {
  services: {
    [key: string]: {
      volumes?: { source: string; target: string; type: string }[];
      [key: string]: any;
    };
  };
  [key: string]: any;
}

const run = async () => {
  console.log('🚀 (Node Setup) Starting intelligent setup script...');

  try {
    // 1. Read and parse the docker-compose.yml file.
    const fileContents = fs.readFileSync(COMPOSE_FILE_PATH, 'utf8');
    const composeFile = yaml.load(fileContents) as DockerCompose;

    // 2. Safely navigate to the service and its volumes.
    const service = composeFile.services?.[SERVICE_NAME];
    if (!service) {
      console.error(`❌ Service '${SERVICE_NAME}' not found in compose file. Cannot proceed.`);
      process.exit(1);
    }
    
    // Ensure the volumes array exists.
    if (!service.volumes) {
      service.volumes = [];
    }

    // 3. Check if the Docker socket volume is already present.
    const socketVolumeExists = service.volumes.some(
      (volume) => volume.source === DOCKER_SOCKET_PATH
    );

    if (socketVolumeExists) {
      console.log('✅ Docker socket mount is already present.');
      // 4a. If it exists, start the main application.
      startMainApp();
    } else {
      console.log('📝 Docker socket mount not found. Adding it now...');

      // 4b. If it doesn't exist, add it to the volumes array.
      service.volumes.push({
        type: 'bind',
        source: DOCKER_SOCKET_PATH,
        target: DOCKER_SOCKET_PATH,
      });

      // 5. Convert the object back to YAML and write it to the file.
      // The `indent: 2` option ensures clean formatting.
      const newYaml = yaml.dump(composeFile, { indent: 2 });
      fs.writeFileSync(COMPOSE_FILE_PATH, newYaml, 'utf8');

      console.log('✅ Docker socket mount added successfully.');
      console.log('🔄 Exiting to allow Docker to restart the container with the new volume.');
      
      // 6. Exit cleanly. The 'restart: unless-stopped' policy will handle the rest.
      process.exit(0);
    }
  } catch (error) {
    console.error('❌ An error occurred during the setup process:', error);
    // Exit with an error code so the container doesn't get stuck in a restart loop.
    process.exit(1);
  }
};

const startMainApp = () => {
  console.log('🚀 Handing over to the main application...');
  // Use exec to run the main 'npm start' command.
  // We pipe the output to our own stdout/stderr to see the logs.
  const mainProcess = exec('npm run start');
  mainProcess.stdout?.pipe(process.stdout);
  mainProcess.stderr?.pipe(process.stderr);
};

run();
