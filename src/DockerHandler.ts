import { RepoConfig } from "./config";
import { execSync } from "child_process";
import * as path from "path";
import * as fs from "fs";

/** Build & deploy via compose or standalone Dockerfile */
export function buildAndDeployRepo(repo: RepoConfig, baseDir: string) {
  const repoDir = path.join(baseDir, repo.path);

  const composeFile = path.join(repoDir, "docker-compose.yml");
  if (fs.existsSync(composeFile)) {
    console.log(`📦 Deploying compose stack for ${repo.path}`);
    execSync(`docker compose -f ${composeFile} up -d --build`, { stdio: "inherit" });
    return;
  }

  const dockerfile = path.join(repoDir, "Dockerfile");
  if (fs.existsSync(dockerfile)) {
    const imageName = repo.path.toLowerCase();
    console.log(`🐳 Building image ${imageName}`);
    execSync(`docker build -t ${imageName}:latest ${repoDir}`, { stdio: "inherit" });
    // Replace any existing container
    try { execSync(`docker rm -f ${imageName}`, { stdio: "inherit" }); } catch {}
    console.log(`▶️ Running container ${imageName}`);
    execSync(`docker run -d --name ${imageName} ${imageName}:latest`, { stdio: "inherit" });
    return;
  }

  console.warn(`⚠️ No Dockerfile or docker-compose.yml in ${repoDir}, skipping`);
}
