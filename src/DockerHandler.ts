import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as yaml from "js-yaml";

interface RepoConfig {
  url: string;
  path: string; // This is the repo name
  autoUpdate: boolean;
}

export async function buildImageFromRepo(repo: RepoConfig, baseDir: string, isGitHubRepo: boolean = false): Promise<string | null> {
  const repoDir = path.join(baseDir, repo.path);
  const composeSrc = path.join(repoDir, "docker-compose.yml");
  if (!fs.existsSync(composeSrc)) {
    throw new Error(`No docker-compose.yml found in ${repo.path} to determine what to build.`);
  }

  console.log(`📦 [${repo.path}] Building image from ${isGitHubRepo ? 'GitHub' : 'compose'}-based repo…`);

  const origDoc: any = yaml.load(fs.readFileSync(composeSrc, "utf8"));
  if (!origDoc.services || Object.keys(origDoc.services).length === 0) {
    throw new Error(`Docker Compose file has no services defined in ${repo.path}`);
  }

  // Find the main service to build
  let serviceToBuildKey: string | null = null;
  let serviceToBuild;
  
  if (isGitHubRepo) {
    // For GitHub repos, use the main service from x-casaos
    serviceToBuildKey = origDoc['x-casaos']?.main;
    if (serviceToBuildKey && origDoc.services[serviceToBuildKey]) {
      serviceToBuild = origDoc.services[serviceToBuildKey];
      
      // Check if there's a Dockerfile in the repository root
      const dockerfilePath = path.join(repoDir, 'Dockerfile');
      if (fs.existsSync(dockerfilePath)) {
        console.log(`🔍 [${repo.path}] Found Dockerfile for GitHub repo, will build from source`);
      } else {
        console.log(`⚠️ No Dockerfile found in GitHub repo ${repo.path}. Skipping image build.`);
        return null;
      }
    } else {
      console.log(`⚠️ No main service defined in x-casaos for ${repo.path}. Skipping image build.`);
      return null;
    }
  } else {
    // For compose repos, look for a service with build directive
    for (const key in origDoc.services) {
        if (origDoc.services[key].build) {
            serviceToBuildKey = key;
            serviceToBuild = origDoc.services[key];
            break;
        }
    }
    
    if (!serviceToBuildKey || !serviceToBuild) {
        console.log(`⚠️ No service with a 'build' directive found in ${repo.path}'s docker-compose.yml. Skipping image build.`);
        return null;
    }
  }

  // For GitHub repos, use simple service name. For Compose repos, use original image or service:latest
  const localTag = isGitHubRepo ? serviceToBuildKey : (serviceToBuild.image || `${serviceToBuildKey}:latest`);
  
  console.log(`🐳 [${repo.path}] Building image '${localTag}' from ${repoDir}`);
  
  try {
    // For GitHub repos, build from repo root. For compose repos, use build context
    const buildContext = isGitHubRepo ? repoDir : path.join(repoDir, serviceToBuild.build.context || '.');
    const dockerfile = isGitHubRepo ? 'Dockerfile' : (serviceToBuild.build.dockerfile || 'Dockerfile');
    const dockerfilePath = path.join(buildContext, dockerfile);

    if (!fs.existsSync(dockerfilePath)) {
        throw new Error(`Dockerfile not found at ${dockerfilePath}`);
    }

    // For GitHub repos, use simple build command (Dockerfile is in default location)
    // For compose repos, use -f flag for custom dockerfile paths
    const buildCommand = isGitHubRepo 
      ? `docker build -t "${localTag}" "${buildContext}"`
      : `docker build -t "${localTag}" -f "${dockerfilePath}" "${buildContext}"`;
    
    console.log(`🔄 Executing build: ${buildCommand}`);
    execSync(buildCommand, { stdio: 'pipe' });
    
    console.log(`✅ [${repo.path}] Docker build for image '${localTag}' completed successfully`);
    
    // Return the local image name for GitHub repos so it can be used in compose file
    return isGitHubRepo ? localTag : null;
  } catch (error: any) {
    console.error(`❌ [${repo.path}] Docker build failed:`, error.message);
    if (error.stderr) {
      console.error(`Docker build stderr: ${error.stderr.toString()}`);
    }
    throw new Error(`Docker build failed for ${repo.path}: ${error.message}`);
  }
}
