import { execSync } from "child_process";
import express from "express";
import path from "path";
import * as fs from "fs";
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

// Repository Management API endpoints
let managedRepos: any[] = [];
let globalSettings = { globalAutoUpdate: false };

// GET /api/repos - List all managed repositories
app.get("/api/repos", (req, res) => {
  res.json({ repos: managedRepos });
});

// GET /api/settings - Get global settings
app.get("/api/settings", (req, res) => {
  res.json(globalSettings);
});

// PUT /api/settings - Update global settings
app.put("/api/settings", (req, res) => {
  const { globalAutoUpdate } = req.body;
  if (typeof globalAutoUpdate === 'boolean') {
    globalSettings.globalAutoUpdate = globalAutoUpdate;
  }
  res.json({ success: true, settings: globalSettings });
});

// PUT /api/repos/:id - Create or update a repository
app.put("/api/repos/:id", (req, res) => {
  const { id } = req.params;
  const { url, autoUpdate } = req.body;
  
  let repo = managedRepos.find(r => r.id === id);
  
  if (!repo) {
    // Create new repo
    repo = {
      id: id === 'default' ? `repo-${Date.now()}` : id,
      url: url || '',
      autoUpdate: autoUpdate !== undefined ? autoUpdate : true,
      status: 'idle',
      currentVersion: '--',
      latestVersion: '--',
      lastUpdated: null,
      hasCompose: false,
      isInstalled: false
    };
    managedRepos.push(repo);
  } else {
    // Update existing repo
    if (url !== undefined) repo.url = url;
    if (autoUpdate !== undefined) repo.autoUpdate = autoUpdate;
  }
  
  res.json({ success: true, repo });
});

// POST /api/repos/:id/compile - Compile/build a repository
app.post("/api/repos/:id/compile", async (req, res) => {
  const { id } = req.params;
  const repo = managedRepos.find(r => r.id === id);
  
  if (!repo || !repo.url) {
    return res.status(400).json({ success: false, message: "Repository not found or URL not set" });
  }
  
  try {
    // Update repo status
    repo.status = 'building';
    repo.lastUpdated = new Date().toISOString();
    
    // Create a temporary RepoConfig for the existing system
    const repoConfig = {
      url: repo.url,
      path: repo.url.replace(/\.git$/, '').split('/').pop() || 'repo',
      autoUpdate: repo.autoUpdate
    };
    
    // Use the existing processRepo function
    await processRepo(repoConfig, true);
    
    // Update repo status on success
    repo.status = 'success';
    repo.isInstalled = true;
    repo.hasCompose = true; // Assume it has compose if build succeeded
    
    res.json({ success: true, message: "Repository compiled and deployed successfully" });
  } catch (error: any) {
    repo.status = 'error';
    console.error(`Compilation error for ${repo.id}:`, error);
    res.status(500).json({ success: false, message: error.message || "Compilation failed" });
  }
});

// GET /api/repos/:id/compose - Get docker-compose.yml content
app.get("/api/repos/:id/compose", async (req, res) => {
  const { id } = req.params;
  const repo = managedRepos.find(r => r.id === id);
  
  if (!repo || !repo.url) {
    return res.status(400).json({ success: false, message: "Repository not found" });
  }
  
  try {
    // Try to read the compose file from the cloned repo
    const repoPath = repo.url.replace(/\.git$/, '').split('/').pop() || 'repo';
    const composePath = path.join(baseDir, repoPath, "docker-compose.yml");
    
    if (fs.existsSync(composePath)) {
      const yamlContent = fs.readFileSync(composePath, 'utf8');
      res.json({ success: true, yaml: yamlContent });
    } else {
      res.json({ success: true, yaml: "# No docker-compose.yml found\n# Add your Docker Compose configuration here" });
    }
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// PUT /api/repos/:id/compose - Update docker-compose.yml content
app.put("/api/repos/:id/compose", async (req, res) => {
  const { id } = req.params;
  const { yaml } = req.body;
  const repo = managedRepos.find(r => r.id === id);
  
  if (!repo || !repo.url) {
    return res.status(400).json({ success: false, message: "Repository not found" });
  }
  
  try {
    // Write to the cloned repo's compose file
    const repoPath = repo.url.replace(/\.git$/, '').split('/').pop() || 'repo';
    const composePath = path.join(baseDir, repoPath, "docker-compose.yml");
    
    // Ensure directory exists
    const repoDir = path.join(baseDir, repoPath);
    if (!fs.existsSync(repoDir)) {
      fs.mkdirSync(repoDir, { recursive: true });
    }
    
    fs.writeFileSync(composePath, yaml, 'utf8');
    repo.hasCompose = true;
    
    res.json({ success: true, message: "Docker Compose file updated successfully" });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// DELETE /api/repos/:id - Remove a repository
app.delete("/api/repos/:id", (req, res) => {
  const { id } = req.params;
  const index = managedRepos.findIndex(r => r.id === id);
  
  if (index === -1) {
    return res.status(404).json({ success: false, message: "Repository not found" });
  }
  
  managedRepos.splice(index, 1);
  res.json({ success: true, message: "Repository removed successfully" });
});

// POST /api/repos/check-updates - Check for updates on all repositories
app.post("/api/repos/check-updates", async (req, res) => {
  try {
    console.log("🔍 Checking updates for all managed repositories...");
    
    for (const repo of managedRepos) {
      if (repo.url) {
        try {
          // Simple update check - in a real implementation, you'd check git commits
          repo.latestVersion = new Date().toISOString().slice(0, 10); // Use today's date as "latest"
          if (!repo.currentVersion || repo.currentVersion === '--') {
            repo.currentVersion = 'Unknown';
          }
        } catch (error) {
          console.error(`Failed to check updates for ${repo.id}:`, error);
        }
      }
    }
    
    res.json({ success: true, message: "Update check completed" });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /api/system/status - Check system status (Docker, CasaOS, etc.)
app.get("/api/system/status", async (req, res) => {
  const status = {
    docker: false,
    casaos: false,
    errors: [] as string[]
  };

  // Check Docker
  try {
    execSync('docker --version', { stdio: 'pipe' });
    status.docker = true;
  } catch (error) {
    status.errors.push('Docker is not available or not running');
  }

  // Check CasaOS connection
  try {
    const { CasaOSInstaller } = await import('./CasaOSInstaller');
    status.casaos = await CasaOSInstaller.testConnection();
    if (!status.casaos) {
      status.errors.push('CasaOS API is not accessible');
    }
  } catch (error) {
    status.errors.push('Failed to test CasaOS connection');
  }

  res.json({
    success: status.docker && status.casaos,
    status,
    message: status.errors.length > 0 ? status.errors.join(', ') : 'All systems operational'
  });
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
