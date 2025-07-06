import { RepoConfig } from "./config";
import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

/** Clone if missing, otherwise pull latest */
export function cloneOrUpdateRepo(repo: RepoConfig, baseDir: string): void {
  const repoDir = path.join(baseDir, repo.path);
  if (!fs.existsSync(repoDir)) {
    console.log(`🔀 Cloning ${repo.url}`);
    execSync(`git clone ${repo.url} ${repoDir}`, { stdio: "inherit" });
  } else {
    console.log(`↻ Pulling latest in ${repoDir}`);
    execSync(`git -C ${repoDir} pull`, { stdio: "inherit" });
  }
}
