import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as yaml from "js-yaml";

interface RepoConfig {
  url: string;
  path: string; // This is the repo name
  autoUpdate: boolean;
}

export async function buildImageFromRepo(repo: RepoConfig, baseDir: string): Promise<void> {
  const repoDir = path.join(baseDir, repo.path);
  const composeSrc = path.join(repoDir, "docker-compose.yml");
  if (!fs.existsSync(composeSrc)) {
    throw new Error(`No docker-compose.yml found in ${repo.path} to determine what to build.`);
  }

  console.log(`📦 [${repo.path}] Building image from compose-based repo…`);

  const origDoc: any = yaml.load(fs.readFileSync(composeSrc, "utf8"));
  if (!origDoc.services || Object.keys(origDoc.services).length === 0) {
    throw new Error(`Docker Compose file has no services defined in ${repo.path}`);
  }

  // Find the main service to build. Assume it's the one with a `build` context.
  let serviceToBuildKey: string | null = null;
  let serviceToBuild;
  for (const key in origDoc.services) {
      if (origDoc.services[key].build) {
          serviceToBuildKey = key;
          serviceToBuild = origDoc.services[key];
          break;
      }
  }

  if (!serviceToBuildKey || !serviceToBuild) {
      console.log(`⚠️ No service with a 'build' directive found in ${repo.path}'s docker-compose.yml. Skipping image build.`);
      return;
  }

  const localTag = serviceToBuild.image || `${serviceToBuildKey}:latest`;
  
  console.log(`🐳 [${repo.path}] Building image '${localTag}' from ${repoDir}`);
  
  try {
    const buildContext = path.join(repoDir, serviceToBuild.build.context || '.');
    const dockerfile = serviceToBuild.build.dockerfile || 'Dockerfile';
    const dockerfilePath = path.join(buildContext, dockerfile);

    if (!fs.existsSync(dockerfilePath)) {
        throw new Error(`Dockerfile not found at ${dockerfilePath}`);
    }

    const buildCommand = `docker build -t "${localTag}" -f "${dockerfilePath}" "${buildContext}"`;
    
    console.log(`🔄 Executing build: ${buildCommand}`);
    execSync(buildCommand, { stdio: 'pipe' });
    
    console.log(`✅ [${repo.path}] Docker build for image '${localTag}' completed successfully`);
  } catch (error: any) {
    console.error(`❌ [${repo.path}] Docker build failed:`, error.message);
    if (error.stderr) {
      console.error(`Docker build stderr: ${error.stderr.toString()}`);
    }
    throw new Error(`Docker build failed for ${repo.path}: ${error.message}`);
  }
}
