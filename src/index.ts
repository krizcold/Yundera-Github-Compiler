import express from "express";
import { loadConfig } from "./config";
import { cloneOrUpdateRepo } from "./GitHandler";
import { buildAndDeployRepo } from "./DockerHandler";

const config = loadConfig();
const baseDir = "/app/repos";

/** Process one repo: clone/pull + build/deploy */
function processRepo(repoConfig: typeof config.repos[0], force: boolean = false) {
  if (!force && !repoConfig.autoUpdate) {
    console.log(`🔕 Auto-update disabled for ${repoConfig.path}`);
    return;
  }
  try {
    cloneOrUpdateRepo(repoConfig, baseDir);
    buildAndDeployRepo(repoConfig, baseDir);
  } catch (err) {
    console.error(`❌ Error with ${repoConfig.path}:`, err);
  }
}

// Initial sync
config.repos.forEach(r => processRepo(r, false));

// Periodic check
setInterval(() => {
  console.log("⏱ Checking for updates…");
  config.repos.forEach(r => processRepo(r, false));
}, config.updateInterval);

// Force-update API
if (config.forceUpdateEnabled) {
  const app = express();
  app.use(express.json());
  app.post("/force-update", (req, res) => {
    const { repoName } = req.body;
    const target = config.repos.find(r => r.path === repoName);
    if (!target) return res.status(400).json({ error: "Repo not found" });
    console.log(`🚨 Forced update for ${repoName}`);
    processRepo(target, true);
    return res.json({ status: "updated", repo: repoName });
  });
  const port = parseInt(process.env.WEBUI_PORT || "3000", 10);
  app.listen(port, () => console.log(`🚀 Force-update API listening on :${port}`));
} else {
  console.log("🔒 Force-update API disabled");
}
