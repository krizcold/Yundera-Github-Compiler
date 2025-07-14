import { execSync } from "child_process";
import express from "express";
import path from "path";
import axios from "axios"; // Import axios for the backend
import { loadConfig } from "./config";
import { cloneOrUpdateRepo } from "./GitHandler";
import { buildAndDeployRepo } from "./DockerHandler";

const config = loadConfig();
const baseDir = "/app/repos";

/** Process one repo: clone/pull + build/deploy */
async function processRepo(
  repoConfig: (typeof config.repos)[0],
  force: boolean = false
) {
  if (!force && !repoConfig.autoUpdate) {
    console.log(`🔕 Auto-update disabled for ${repoConfig.path}`);
    return;
  }
  try {
    cloneOrUpdateRepo(repoConfig, baseDir);
    await buildAndDeployRepo(repoConfig, baseDir);
  } catch (err) {
    console.error(`❌ Error with ${repoConfig.path}:`, err);
  }
}

// Re-enable the initial sync and periodic check
(async () => {
  console.log("🚀 Starting initial repository processing...");
  for (const repo of config.repos) {
    await processRepo(repo, false);
  }
  console.log("✅ Initial processing complete.");
})();

setInterval(async () => {
  console.log("⏱ Checking for updates…");
  for (const repo of config.repos) {
    await processRepo(repo, false);
  }
}, config.updateInterval);

// --- API and UI Server ---
const app = express();
app.use(express.json());

// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, "public")));
app.use("/main.js", express.static(path.join(__dirname, "public", "main.js")));

// Serve the main UI page at the root
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// --- NEW PROXY ENDPOINT ---
app.post("/install-via-proxy", async (req, res) => {
  const yamlContent = req.body.yaml;
  if (!yamlContent) {
    return res
      .status(400)
      .json({ success: false, message: "YAML content is missing." });
  }

  // Use the working CasaOS installer
  console.log(`[Proxy] Using working CasaOS installer for installation`);

  try {
    // Import and use the same installer that DockerHandler uses
    const { CasaOSInstaller } = await import('./CasaOSInstaller');
    
    const installResult = await CasaOSInstaller.installComposeApp(yamlContent);
    
    if (installResult.success) {
      console.log("[Proxy] Installation successful via Yundera API");
      res.status(200).json({ success: true, message: installResult.message });
    } else {
      console.log("[Proxy] Installation failed:", installResult.message);
      res.status(400).json({ success: false, message: installResult.message, errors: installResult.errors });
    }
  } catch (error: any) {
    console.error("[Proxy] Error forwarding request:", error.message);
    if (axios.isAxiosError(error) && error.response) {
      res
        .status(error.response.status)
        .json({ success: false, data: error.response.data });
    } else {
      res
        .status(500)
        .json({ success: false, message: "An internal error occurred." });
    }
  }
});

// Force-update API
if (config.forceUpdateEnabled) {
  app.post("/force-update", async (req, res) => {
    const { repoName } = req.body;
    const target = config.repos.find((r) => r.path === repoName);
    if (!target) return res.status(400).json({ error: "Repo not found" });
    console.log(`🚨 Forced update for ${repoName}`);
    await processRepo(target, true);
    return res.json({ status: "updated", repo: repoName });
  });
} else {
  console.log("🔒 Force-update API disabled");
}

const port = parseInt(process.env.WEBUI_PORT || "3000", 10);
app.listen(port, () => {
  console.log(`🚀 UI and API listening on :${port}`);
  console.log(`   Access the installer UI at the app's root URL.`);
});

function runDiagnosticCommand() {
  const command = process.env.DIAG_COMMAND;

  // Only run if the environment variable is set
  if (command) {
    console.log("====================================");
    console.log("=== RUNNING DIAGNOSTIC COMMAND ===");
    console.log(`➡️  Executing: ${command}`);
    console.log("====================================");

    try {
      const output = execSync(command, { encoding: "utf8" });
      console.log("--- COMMAND OUTPUT START ---");
      console.log(output);
      console.log("--- COMMAND OUTPUT END ---");
    } catch (error: any) {
      console.error("--- COMMAND FAILED ---");
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
