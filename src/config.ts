// src/config.ts
export interface RepoConfig {
  url: string;
  path: string;
  autoUpdate: boolean;
}

export interface AppConfig {
  repos: RepoConfig[];
  updateInterval: number;
  forceUpdateEnabled: boolean;
}

/**
 * Load REPO_<n>, UPDATE_INTERVAL, and FORCE_UPDATE_GLOBAL from env.
 */
export function loadConfig(): AppConfig {
  // Global flags (we calculate these first)
  const updateSeconds = Number(process.env.UPDATE_INTERVAL ?? 3600);
  const updateInterval = updateSeconds * 1000;
  const forceUpdateEnabled = process.env.FORCE_UPDATE_GLOBAL === "true";

  // Find all REPO_0, REPO_1, … keys
  const repoKeys = Object.keys(process.env)
    .filter((k) => /^REPO_\d+$/.test(k))
    .sort((a, b) => {
      const na = Number(a.split("_")[1]);
      const nb = Number(b.split("_")[1]);
      return na - nb;
    });

  if (repoKeys.length === 0) {
    // Instead of exiting, we print a warning and return an empty config.
    // The application will continue to run without any repos to process.
    console.warn("⚠️  No REPO_<n> entries found. Yundera GitHub Compiler will start in idle mode.");
    console.warn("   The API and diagnostic commands will be available.");
    return {
      repos: [], // Return an empty array of repos
      updateInterval,
      forceUpdateEnabled,
    };
  }

  // If we get here, it means repos were found, so we process them normally.
  const repos: RepoConfig[] = repoKeys.map((key) => {
    const idx = key.split("_")[1];
    const url = process.env[key]!;  // we know it exists
    const autoEnv = process.env[`REPO_${idx}_AUTOUPDATE`];
    const autoUpdate = autoEnv?.toLowerCase() === "true";

    return {
      url,
      path: getRepoName(url),
      autoUpdate,
    };
  });

  return { repos, updateInterval, forceUpdateEnabled };
}

/** Strip off a trailing “.git” and return the last path segment */
function getRepoName(url: string): string {
  const clean = url.endsWith(".git") ? url.slice(0, -4) : url;
  const parts = clean.split("/");
  return parts[parts.length - 1];
}
