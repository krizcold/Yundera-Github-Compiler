import { RepoConfig } from "./config";
import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as yaml from "js-yaml";
import { renderTemplate } from "./TemplateEngine";

const TEMPLATE_PATH = "/app/templates/docker-compose.template.yml";

/** Build & deploy via compose or standalone Dockerfile */
export function buildAndDeployRepo(repo: RepoConfig, baseDir: string) {
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

  const origSlug = typeof origDoc.name === "string" && origDoc.name.trim()
    ? origDoc.name.trim()
    : repo.path;

  const svcKey = Object.keys(origDoc.services)[0];
  const origSvc = origDoc.services[svcKey];

  const localTag = `${svcKey}:latest`;
  console.log(`🐳 [${origSlug}] Building image '${localTag}' from ${repoDir}`);
  execSync(`docker build -t ${localTag} ${repoDir}`, { stdio: "inherit" });

  const envBlock = origSvc.environment
    ? "    environment:\n" + indentYaml(origSvc.environment, 6)
    : "";
  
  let volBlock = "";
  if (origSvc.volumes) {
    const originalVolumeYaml = indentYaml(origSvc.volumes, 6);
    // This correction handles the $AppID placeholder if it exists, otherwise does nothing.
    const correctedVolumeYaml = originalVolumeYaml.replace(/\$AppID/g, origSlug);
    volBlock = "    volumes:\n" + correctedVolumeYaml;
  }

  const exposeBlock = origSvc.expose
    ? "    expose:\n" + indentYaml(origSvc.expose, 6)
    : "";
  const xCasaVolBlock = origSvc["x-casaos"]?.volumes
    ? "      volumes:\n" + indentYaml(origSvc["x-casaos"].volumes, 8)
    : "      volumes: {}\n";

  const rendered = renderTemplate(TEMPLATE_PATH, {
    APP_SLUG: origSlug,
    SERVICE_KEY: svcKey,
    IMAGE_TAG: localTag,
    ICON_URL: origDoc["x-casaos"]?.icon || "",
    AUTHOR: origDoc["x-casaos"]?.author || "unknown",
    DEVELOPER: origDoc["x-casaos"]?.developer || "unknown",
    TAGLINE: origDoc["x-casaos"]?.tagline?.en_us || "",
    CATEGORY: origDoc["x-casaos"]?.category || "",
    DESCRIPTION: origDoc["x-casaos"]?.description?.en_us || "",
    TITLE: origDoc["x-casaos"]?.title?.en_us || svcKey,
    PORT_MAP: origDoc["x-casaos"]?.port_map || "",
    INDEX_PATH: origDoc["x-casaos"]?.index || "/",
    WEBUI_PORT: String(origDoc["x-casaos"]?.webui_port || 80),
    ENV_BLOCK: envBlock,
    VOLUME_BLOCK: volBlock,
    EXPOSE_BLOCK: exposeBlock,
    X_CASAOS_VOLUME_BLOCK: xCasaVolBlock
  });

  const targetDir = path.join("/casaos/apps", origSlug);
  fs.mkdirSync(targetDir, { recursive: true });
  const composeDst = path.join(targetDir, "docker-compose.yml");
  fs.writeFileSync(composeDst, rendered, "utf8");
  console.log(`✅ [${origSlug}] Wrote CasaOS compose → ${composeDst}`);

  try {
    console.log(`🔒 [${origSlug}] Setting permissions for CasaOS...`);
    execSync(`chmod -R 777 '${targetDir}'`); // Using quotes to handle special characters
    console.log(`✅ [${origSlug}] Permissions set successfully.`);
  } catch(err) {
    console.error(`❌ [${origSlug}] Failed to set permissions:`, err);
  }
  
  // We keep this commented out to let CasaOS handle the deployment for now.
  // console.log(`🚀 [${origSlug}] Launching with 'docker compose up -d'`);
  console.log(`🎉 [${origSlug}] App file created. CasaOS should now deploy it automatically.`);
  
  try {
    console.log(`🧹 [${origSlug}] Cleaning up source directory: ${repoDir}`);
    fs.rmSync(repoDir, { recursive: true, force: true });
    console.log(`✅ [${origSlug}] Cleanup complete.`);
  } catch (err) {
    console.error(`❌ [${origSlug}] Failed to clean up repo directory:`, err);
  }
  // ====================================================================
}

/** Helper: dump object/array to YAML and indent each line */
function indentYaml(obj: any, spaces: number): string {
  const pad = " ".repeat(spaces);
  return yaml.dump(obj, { noRefs: true, indent: 2 })
    .trimEnd()
    .split("\n")
    .map(line => pad + line)
    .join("\n") + "\n";
}
