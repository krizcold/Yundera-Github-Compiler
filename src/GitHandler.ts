// Temporary interface for compatibility
interface RepoConfig {
  url: string;
  path: string;
  autoUpdate: boolean;
}
import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

export interface GitUpdateInfo {
  hasUpdates: boolean;
  currentCommit: string;
  latestCommit: string;
  commitsBehind: number;
  error?: string;
}

/** Clone if missing, otherwise pull latest */
export function cloneOrUpdateRepo(repo: RepoConfig, baseDir: string): void {
  const repoDir = path.join(baseDir, repo.path);
  
  try {
    if (!fs.existsSync(repoDir)) {
      console.log(`🔀 Cloning ${repo.url}`);
      
      // Set Git to skip SSL verification for this operation if needed
      const gitEnv = { 
        ...process.env,
        GIT_SSL_NO_VERIFY: '1', // This helps with some authentication issues
        GIT_TERMINAL_PROMPT: '0' // Prevent interactive prompts
      };
      
      execSync(`git clone "${repo.url}" "${repoDir}"`, { 
        stdio: "inherit",
        env: gitEnv
      });
    } else {
      console.log(`↻ Pulling latest in ${repoDir}`);
      
      const gitEnv = { 
        ...process.env,
        GIT_SSL_NO_VERIFY: '1',
        GIT_TERMINAL_PROMPT: '0'
      };
      
      execSync(`git -C "${repoDir}" pull`, { 
        stdio: "inherit",
        env: gitEnv
      });
    }
  } catch (error: any) {
    console.error(`❌ Git operation failed for ${repo.url}:`, error.message);
    
    // If authentication failed, provide helpful error message
    if (error.message.includes('Authentication failed') || 
        error.message.includes('Permission denied') ||
        error.message.includes('could not read Username') ||
        error.message.includes('repository not found')) {
      
      console.error(`🔑 Git authentication issue detected. For private repositories:`);
      console.error(`   Use Personal Access Token in URL: https://github_pat_TOKEN@github.com/owner/repo.git`);
    }
    
    throw error;
  }
}


/** Check if repository has remote updates available without pulling */
export function checkForUpdates(repoUrl: string, baseDir: string): GitUpdateInfo {
  const repoPath = repoUrl.replace(/\.git$/, '').split('/').pop() || 'repo';
  const repoDir = path.join(baseDir, repoPath);
  
  try {
    // If repo doesn't exist locally, it needs to be cloned (has updates)
    if (!fs.existsSync(repoDir)) {
      return {
        hasUpdates: true,
        currentCommit: '',
        latestCommit: 'unknown',
        commitsBehind: -1
      };
    }

    // Fetch remote updates without merging
    const gitEnv = { 
      ...process.env,
      GIT_SSL_NO_VERIFY: '1',
      GIT_TERMINAL_PROMPT: '0'
    };
    
    execSync(`git -C "${repoDir}" fetch origin`, { 
      stdio: 'pipe',
      env: gitEnv 
    });
    
    // Get current local commit
    const currentCommit = execSync(`git -C "${repoDir}" rev-parse HEAD`, { 
      encoding: 'utf8', 
      stdio: 'pipe' 
    }).trim();
    
    // Get latest remote commit
    const latestCommit = execSync(`git -C "${repoDir}" rev-parse origin/HEAD`, { 
      encoding: 'utf8', 
      stdio: 'pipe' 
    }).trim();
    
    // Check if we're behind
    const hasUpdates = currentCommit !== latestCommit;
    
    let commitsBehind = 0;
    if (hasUpdates) {
      try {
        const commitCount = execSync(`git -C "${repoDir}" rev-list --count HEAD..origin/HEAD`, { 
          encoding: 'utf8', 
          stdio: 'pipe' 
        }).trim();
        commitsBehind = parseInt(commitCount) || 0;
      } catch (error) {
        commitsBehind = -1; // Unknown
      }
    }
    
    return {
      hasUpdates,
      currentCommit,
      latestCommit,
      commitsBehind
    };
    
  } catch (error: any) {
    console.error(`❌ Error checking updates for ${repoUrl}:`, error.message);
    return {
      hasUpdates: false,
      currentCommit: '',
      latestCommit: '',
      commitsBehind: 0,
      error: error.message
    };
  }
}
