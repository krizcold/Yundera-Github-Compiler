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

export function loadConfig(): AppConfig {
  // 1) collect all REPO_<n> keys
  const repoKeys = Object
    .keys(process.env)
    .filter(k => /^REPO_\d+$/.test(k))
    .sort((a, b) => {
      // ensure numeric order: REPO_0, REPO_1, …
      const na = parseInt(a.split('_')[1], 10);
      const nb = parseInt(b.split('_')[1], 10);
      return na - nb;
    });

  if (repoKeys.length === 0) {
    console.error("❌ No REPO_<n> entries found in environment");
    process.exit(1);
  }

  const repos: RepoConfig[] = repoKeys.map(key => {
    const idx = key.split('_')[1];
    const url = process.env[key] as string;
    // optional per-repo toggle:
    const autoEnv = process.env[`REPO_${idx}_AUTOUPDATE`];
    const autoUpdate = autoEnv ? autoEnv.toLowerCase() === 'true' : true;
    return {
      url,
      path: `${idx}-${getRepoName(url)}`,
      autoUpdate
    };
  });

  // global settings
  const updateInterval = (parseInt(process.env.UPDATE_INTERVAL || "3600", 10) * 1000);
  const forceUpdateEnabled = (process.env.FORCE_UPDATE_GLOBAL || "").toLowerCase() === "true";

  return { repos, updateInterval, forceUpdateEnabled };
}

function getRepoName(url: string): string {
  const parts = url.replace(/\.git$/, '').split('/');
  return parts[parts.length - 1];
}
