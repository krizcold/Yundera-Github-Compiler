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
    console.warn(`⚠️  [${repo.path}] No docker-compose.yml – skipping`);
    return;
  }

  console.log(`📦 [${repo.path}] Processing compose-based repo…`);

  const origDoc: any = yaml.load(fs.readFileSync(composeSrc, "utf8"));
  if (!origDoc.services || Object.keys(origDoc.services).length === 0) {
    console.warn(`⚠️  [${repo.path}] compose.yml has no services – skipping`);
    return;
  }

  const origSlug =
    typeof origDoc.name === "string" && origDoc.name.trim()
      ? origDoc.name.trim()
      : repo.path;

  const svcKey = Object.keys(origDoc.services)[0];
  const origSvc = origDoc.services[svcKey];

  const localTag = `${svcKey}:latest`;
  console.log(`🐳 [${origSlug}] Building image '${localTag}' from ${repoDir}`);
  execSync(`docker build -t ${localTag} ${repoDir}`, { stdio: "inherit" });

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
  }

  try {
    console.log(`🧹 [${origSlug}] Cleaning up source directory: ${repoDir}`);
    fs.rmSync(repoDir, { recursive: true, force: true });
    console.log(`✅ [${origSlug}] Cleanup complete.`);
  } catch (err) {
    console.error(`❌ [${origSlug}] Failed to clean up repo directory:`, err);
  }
}
