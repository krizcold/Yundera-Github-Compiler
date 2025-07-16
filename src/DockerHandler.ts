import { RepoConfig } from "./config";
import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as yaml from "js-yaml";
import { CasaOSInstaller, DockerComposeSpec } from "./CasaOSInstaller";

export async function buildAndDeployRepo(repo: RepoConfig, baseDir: string) {
  const repoDir = path.join(baseDir, repo.path);
  const composeSrc = path.join(repoDir, "docker-compose.yml");
  if (!fs.existsSync(composeSrc)) {
    throw new Error(`No docker-compose.yml found in ${repo.path}`);
  }

  // Check docker.sock status (passive monitoring)
  if (!fs.existsSync('/var/run/docker.sock')) {
    console.log('❌ [DOCKER.SOCK] Docker socket /var/run/docker.sock NOT found inside container');
    console.log('🔧 [DOCKER.SOCK] This should be fixed by the watcher script');
    console.log('⏳ [DOCKER.SOCK] Skipping repository processing until docker.sock is available');
    return; // Don't crash the app, just skip this repo
  } else {
    console.log('✅ [DOCKER.SOCK] Docker socket /var/run/docker.sock found and accessible');
  }

  console.log(`📦 [${repo.path}] Processing compose-based repo…`);

  const origDoc: any = yaml.load(fs.readFileSync(composeSrc, "utf8"));
  if (!origDoc.services || Object.keys(origDoc.services).length === 0) {
    throw new Error(`Docker Compose file has no services defined in ${repo.path}`);
  }

  const origSlug =
    typeof origDoc.name === "string" && origDoc.name.trim()
      ? origDoc.name.trim()
      : repo.path;

  const svcKey = Object.keys(origDoc.services)[0];
  const origSvc = origDoc.services[svcKey];

  const localTag = `${svcKey}:latest`;
  console.log(`🐳 [${origSlug}] Building image '${localTag}' from ${repoDir}`);
  
  try {
    const buildCommand = `docker build -t ${localTag} ${repoDir}`;
    
    console.log(`🔄 Executing direct build: ${buildCommand}`);
    const buildOutput = execSync(buildCommand, { 
      stdio: 'pipe',
      encoding: 'utf8'
    });
    
    console.log(`✅ [${origSlug}] Docker build completed successfully`);
    console.log(`📋 Build output: ${buildOutput.slice(-200)}...`);
  } catch (error: any) {
    console.error(`❌ [${origSlug}] Docker build failed:`, error.message);
    if (error.stderr) {
      console.error(`Docker build stderr: ${error.stderr}`);
    }
    throw new Error(`Docker build failed for ${origSlug}: ${error.message}`);
  }

  const serviceDefinition: any = {
    cpu_shares: 90,
    command: [],
    container_name: svcKey,
    deploy: {
      resources: {
        limits: {
          memory: "14603517952",
        },
      },
    },
    hostname: svcKey,
    image: localTag,
    labels: {
      icon: origDoc["x-casaos"]?.icon || "",
    },
    network_mode: "bridge",
    restart: "unless-stopped",
  };

  if (origSvc.environment) {
    serviceDefinition.environment = origSvc.environment;
  }

  if (origSvc.expose) {
    serviceDefinition.expose = origSvc.expose;
  }

  if (origSvc.volumes) {
    const correctedVolumes = JSON.parse(
      JSON.stringify(origSvc.volumes).replace(/\$AppID/g, origSlug)
    );
    serviceDefinition.volumes = correctedVolumes;
  }

  if (origSvc["x-casaos"]?.volumes) {
    serviceDefinition["x-casaos"] = {
      volumes: origSvc["x-casaos"].volumes,
    };
  }

  const finalCompose: DockerComposeSpec = {
    name: origSlug,
    services: {
      [svcKey]: serviceDefinition,
    },
    networks: {
      default: {
        name: `${origSlug}_default`,
      },
    },
    "x-casaos": {
      architectures: ["amd64", "arm64"],
      author: origDoc["x-casaos"]?.author || "unknown",
      category: origDoc["x-casaos"]?.category || "",
      description: {
        en_us: origDoc["x-casaos"]?.description?.en_us || "",
      },
      developer: origDoc["x-casaos"]?.developer || "unknown",
      hostname: "",
      icon: origDoc["x-casaos"]?.icon || "",
      index: "/",
      is_uncontrolled: false,
      main: svcKey,
      port_map: origDoc["x-casaos"]?.port_map || "",
      scheme: "http",
      store_app_id: origSlug,
      tagline: {
        en_us: origDoc["x-casaos"]?.tagline?.en_us || "",
      },
      title: {
        custom: "",
        en_us: origDoc["x-casaos"]?.title?.en_us || svcKey,
      },
      webui_port: origDoc["x-casaos"]?.webui_port || 80,
    },
  };

  console.log(
    `🚀 [${origSlug}] Sending app to CasaOS for installation via API...`
  );
  const result = await CasaOSInstaller.installComposeApp(yaml.dump(finalCompose), origSlug);

  if (result.success) {
    console.log(
      `🎉 [${origSlug}] App installation started successfully! Check your CasaOS dashboard.`
    );
  } else {
    console.error(
      `❌ [${origSlug}] Failed to install app via API: ${result.message}`
    );
    throw new Error(`CasaOS installation failed for ${origSlug}: ${result.message}`);
  }

  try {
    console.log(`🧹 [${origSlug}] Cleaning up source directory: ${repoDir}`);
    fs.rmSync(repoDir, { recursive: true, force: true });
    console.log(`✅ [${origSlug}] Cleanup complete.`);
  } catch (err) {
    console.error(`❌ [${origSlug}] Failed to clean up repo directory:`, err);
  }
}
