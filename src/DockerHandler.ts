import { execSync, spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as yaml from "js-yaml";

// Check if Docker buildx is available for BuildKit support
function isBuildxAvailable(): boolean {
  try {
    execSync('docker buildx version', { stdio: 'pipe', timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

interface RepoConfig {
  url: string;
  path: string; // This is the repo name
  autoUpdate: boolean;
}

export async function buildImageFromRepo(repo: RepoConfig, baseDir: string, isGitHubRepo: boolean = false, logCollector?: any): Promise<{ imageName: string; serviceName: string } | null> {
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
    serviceToBuildKey = origDoc['x-casaos']?.build || origDoc['x-casaos']?.main;
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
      console.log(`⚠️ No build or main service defined in x-casaos for ${repo.path}. Skipping image build.`);
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

  // Generate proper image tag for GitHub repos
  let localTag: string;
  if (isGitHubRepo) {
    // Try to get git commit hash for more specific tagging
    let gitTag = 'latest';
    try {
      const gitHash = execSync('git rev-parse --short HEAD', {
        cwd: repoDir,
        encoding: 'utf8',
        stdio: 'pipe',
        timeout: 5000
      }).trim();
      if (gitHash) {
        gitTag = `git-${gitHash}`;
        console.log(`📋 [${repo.path}] Using git hash ${gitHash} for image tag`);
      }
    } catch (error) {
      console.log(`📋 [${repo.path}] Could not determine git hash, using 'latest' tag`);
    }

    // Use format: servicename:git-abc123 or servicename:latest
    localTag = `${serviceToBuildKey}:${gitTag}`;
  } else {
    // For Compose repos, use original image or service:latest
    localTag = serviceToBuild.image || `${serviceToBuildKey}:latest`;
  }
  
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
    const buildArgs = isGitHubRepo 
      ? ['build', '-t', localTag, buildContext]
      : ['build', '-t', localTag, '-f', dockerfilePath, buildContext];
    
    console.log(`🔄 Executing build: docker ${buildArgs.join(' ')}`);
    
    // Use spawn to stream progress like CasaOSInstaller does
    return new Promise<{ imageName: string; serviceName: string } | null>((resolve, reject) => {
      // Only enable BuildKit if buildx is available
      const env = { ...process.env };
      if (isBuildxAvailable()) {
        env.DOCKER_BUILDKIT = '1';
        console.log(`🔧 BuildKit enabled (buildx available)`);
      } else {
        console.log(`⚠️ BuildKit disabled (buildx not available, using legacy builder)`);
      }
      
      const child = spawn('docker', buildArgs, { env });

      const processLog = (data: Buffer) => {
        const message = data.toString();
        const lines = message.split(/[\r\n]+/);
        
        lines.forEach(line => {
          if (!line.trim()) return;
          console.log(`🐳 [${repo.path}]: ${line}`);
          
          // Stream to UI with whale icon (like CasaOSInstaller)
          if (logCollector) {
            logCollector.addLog(`🐳 ${line}`, 'info');
          }
        });
      };

      child.stdout.on('data', processLog);
      child.stderr.on('data', processLog);

      child.on('close', (code) => {
        // Clean up listeners to prevent memory leaks
        child.stdout.removeAllListeners();
        child.stderr.removeAllListeners();
        child.removeAllListeners();

        if (code === 0) {
          console.log(`✅ [${repo.path}] Docker build for image '${localTag}' completed successfully`);
          resolve(isGitHubRepo ? { imageName: localTag, serviceName: serviceToBuildKey! } : null);
        } else {
          console.error(`❌ [${repo.path}] Docker build exited with code ${code}`);
          reject(new Error(`Docker build failed for ${repo.path}: exit code ${code}`));
        }
      });

      child.on('error', (err) => {
        // Clean up listeners to prevent memory leaks
        child.stdout.removeAllListeners();
        child.stderr.removeAllListeners();
        child.removeAllListeners();

        console.error(`❌ [${repo.path}] Docker build process failed:`, err);
        reject(new Error(`Docker build failed for ${repo.path}: ${err.message}`));
      });
    });
  } catch (error: any) {
    console.error(`❌ [${repo.path}] Docker build failed:`, error.message);
    if (error.stderr) {
      console.error(`Docker build stderr: ${error.stderr.toString()}`);
    }
    throw new Error(`Docker build failed for ${repo.path}: ${error.message}`);
  }
}
