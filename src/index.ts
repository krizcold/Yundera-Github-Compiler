import { execSync } from "child_process";
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
  } catch (err)
  {
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

function runDiagnosticCommand() {
  const command = process.env.DIAG_COMMAND;

  // Only run if the environment variable is set
  if (command) {
    console.log("====================================");
    console.log("=== RUNNING DIAGNOSTIC COMMAND ===");
    console.log(`➡️  Executing: ${command}`);
    console.log("====================================");
    
    try {
      // Execute the command synchronously and capture its output
      const output = execSync(command, { encoding: 'utf8' });
      
      console.log("--- COMMAND OUTPUT START ---");
      console.log(output);
      console.log("--- COMMAND OUTPUT END ---");

    } catch (error: any) {
      // If the command fails, log the error details
      console.error("--- COMMAND FAILED ---");
      // The actual output and error messages from the failed command are often here
      console.error("STDOUT from failed command:", error.stdout);
      console.error("STDERR from failed command:", error.stderr);
      console.error("----------------------");
    }
    
    console.log("✅ Diagnostic command finished.");
    console.log("====================================");
  }
}

// Run the function on startup
runDiagnosticCommand();
