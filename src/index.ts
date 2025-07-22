import { execSync } from "child_process";
import express from "express";
import path from "path";
import * as fs from "fs";
import axios from "axios"; // Import axios for the backend
import { loadConfig } from "./config";
import { cloneOrUpdateRepo, checkForUpdates, GitUpdateInfo } from "./GitHandler";
import { buildAndDeployRepo } from "./DockerHandler";
import { loadRepositories, saveRepositories, loadSettings, saveSettings, addRepository, updateRepository, removeRepository, getRepository, Repository, GlobalSettings } from "./storage";
import { verifyCasaOSInstallation, isAppInstalledInCasaOS, getCasaOSInstalledApps } from "./casaos-status";
import { buildQueue } from "./build-queue";

const config = loadConfig();
const baseDir = "/app/repos";

// Global state for repository management
let managedRepos: Repository[] = [];
let globalSettings: GlobalSettings = {
  globalApiUpdatesEnabled: true,
  defaultAutoUpdateInterval: 60,
  maxConcurrentBuilds: 2
};

// Repository timers for individual auto-updates
const repoTimers = new Map<string, NodeJS.Timeout>();

// Repository processing is now handled by the build queue system

// Check docker.sock status on startup (passive monitoring)
function checkDockerSockStatus() {
  if (fs.existsSync('/var/run/docker.sock')) {
    console.log('✅ [STARTUP] Docker socket /var/run/docker.sock found and accessible');
    return true;
  } else {
    console.log('❌ [STARTUP] Docker socket /var/run/docker.sock NOT found inside container');
    console.log('🔧 [STARTUP] Docker socket will be mounted automatically');
    return false;
  }
}

// Enhanced startup check with monitoring (but no auto-shutdown)
function performStartupCheck() {
  const dockerSockAvailable = checkDockerSockStatus();
  
  if (!dockerSockAvailable) {
    console.log('⏰ [STARTUP] Starting docker.sock monitoring...');
    console.log('🔧 [STARTUP] Pre-install script should mount docker.sock automatically');
    
    let checkCount = 0;
    
    const checkInterval = setInterval(() => {
      checkCount++;
      
      if (fs.existsSync('/var/run/docker.sock')) {
        console.log(`✅ [STARTUP] Docker socket became available after ${checkCount * 10} seconds`);
        clearInterval(checkInterval);
        return;
      }
      
      // Just log status, don't exit
      if (checkCount % 6 === 0) { // Log every minute (6 * 10 seconds)
        console.log(`⏳ [STARTUP] Still waiting for docker.sock (${checkCount * 10}s elapsed)`);
        console.log('ℹ️ [STARTUP] App continues running - web UI will show loading page until ready');
      }
    }, 10000); // Check every 10 seconds
  }
}

// Initialize storage and load persisted data
(async () => {
  console.log("🚀 Starting Yundera GitHub Compiler...");
  performStartupCheck();
  
  // Load persisted repositories and settings
  managedRepos = loadRepositories();
  globalSettings = loadSettings();
  
  console.log(`📋 Loaded ${managedRepos.length} repositories from storage`);
  
  // Start individual timers for repositories with auto-update enabled
  managedRepos.forEach(repo => {
    if (repo.autoUpdate) {
      startRepoTimer(repo);
    }
  });
  
  // Sync installation status with CasaOS
  await syncWithCasaOS();
  
  console.log("✅ Initialization complete.");
})();

// Function to start individual repository timer
function startRepoTimer(repository: Repository) {
  // Clear existing timer if any
  const existingTimer = repoTimers.get(repository.id);
  if (existingTimer) {
    clearInterval(existingTimer);
  }
  
  // Start new timer
  const intervalMs = repository.autoUpdateInterval * 60 * 1000; // Convert minutes to ms
  const timer = setInterval(async () => {
    console.log(`⏱ Auto-update check for ${repository.name}`);
    const updatedRepo = getRepository(repository.id);
    if (updatedRepo) {
      try {
        await buildQueue.addJob(updatedRepo, false);
      } catch (error) {
        console.error(`❌ Failed to queue auto-update for ${repository.name}:`, error);
      }
    }
  }, intervalMs);
  
  repoTimers.set(repository.id, timer);
  console.log(`⏰ Started auto-update timer for ${repository.name} (${repository.autoUpdateInterval} minutes)`);
}

// Function to stop repository timer
function stopRepoTimer(repositoryId: string) {
  const timer = repoTimers.get(repositoryId);
  if (timer) {
    clearInterval(timer);
    repoTimers.delete(repositoryId);
    console.log(`⏹ Stopped auto-update timer for repository ${repositoryId}`);
  }
}

// Sync repository installation status with CasaOS
async function syncWithCasaOS() {
  console.log("🔄 Syncing repository status with CasaOS...");
  
  try {
    const installedApps = await getCasaOSInstalledApps();
    
    managedRepos.forEach(repo => {
      const isInstalled = installedApps.includes(repo.name);
      if (repo.isInstalled !== isInstalled) {
        updateRepository(repo.id, { isInstalled });
        console.log(`🔄 Updated ${repo.name} installation status: ${isInstalled}`);
      }
    });
    
  } catch (error) {
    console.error("❌ Error syncing with CasaOS:", error);
  }
}

// --- API and UI Server ---
const app = express();
app.use(express.json());

// Reload managed repos from storage periodically to keep in sync
setInterval(() => {
  managedRepos = loadRepositories();
}, 30000); // Every 30 seconds

// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, "public")));
app.use("/main.js", express.static(path.join(__dirname, "public", "main.js")));

// Root serves the loading page (now index.html)
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// Main app interface (redirected from loading page when ready)
app.get("/main", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "main.html"));
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

// GET /api/repos - List all managed repositories
app.get("/api/repos", async (req, res) => {
  // Sync with CasaOS before returning
  await syncWithCasaOS();
  const repositories = loadRepositories();
  res.json({ repos: repositories });
});

// GET /api/settings - Get global settings
app.get("/api/settings", (req, res) => {
  const settings = loadSettings();
  res.json(settings);
});

// PUT /api/settings - Update global settings
app.put("/api/settings", (req, res) => {
  const settings = loadSettings();
  const updates = req.body;
  
  const newSettings = { ...settings, ...updates };
  saveSettings(newSettings);
  globalSettings = newSettings;
  
  res.json({ success: true, settings: newSettings });
});

// POST /api/repos - Add a new repository
app.post("/api/repos", (req, res) => {
  const { name, url, autoUpdate = false, autoUpdateInterval = 60, apiUpdatesEnabled = true } = req.body;
  
  if (!name || !url) {
    return res.status(400).json({ success: false, message: "Name and URL are required" });
  }
  
  try {
    const newRepo = addRepository({
      name,
      url,
      autoUpdate,
      autoUpdateInterval,
      apiUpdatesEnabled,
      status: 'idle'
    });
    
    // Start timer if auto-update is enabled
    if (newRepo.autoUpdate) {
      startRepoTimer(newRepo);
    }
    
    res.json({ success: true, repo: newRepo });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// PUT /api/repos/:id - Update a repository
app.put("/api/repos/:id", (req, res) => {
  const { id } = req.params;
  const updates = req.body;
  
  const repo = getRepository(id);
  if (!repo) {
    return res.status(404).json({ success: false, message: "Repository not found" });
  }
  
  try {
    const updatedRepo = updateRepository(id, updates);
    
    // Handle auto-update timer changes
    if (updates.autoUpdate !== undefined || updates.autoUpdateInterval !== undefined) {
      if (updatedRepo?.autoUpdate) {
        startRepoTimer(updatedRepo);
      } else {
        stopRepoTimer(id);
      }
    }
    
    res.json({ success: true, repo: updatedRepo });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// POST /api/repos/:id/compile - Compile/build a repository
app.post("/api/repos/:id/compile", async (req, res) => {
  const { id } = req.params;
  const repo = getRepository(id);
  
  if (!repo || !repo.url) {
    return res.status(400).json({ success: false, message: "Repository not found or URL not set" });
  }
  
  try {
    const result = await buildQueue.addJob(repo, true);
    
    if (result.success) {
      res.json({ success: true, message: result.message });
    } else {
      res.status(500).json({ success: false, message: result.message });
    }
  } catch (error: any) {
    console.error(`Compilation error for ${repo.id}:`, error);
    res.status(500).json({ success: false, message: error.message || "Compilation failed" });
  }
});

// GET /api/repos/:id/compose - Get docker-compose.yml content
app.get("/api/repos/:id/compose", async (req, res) => {
  const { id } = req.params;
  const repo = getRepository(id);
  
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
  const repo = getRepository(id);
  
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
  
  const success = removeRepository(id);
  if (!success) {
    return res.status(404).json({ success: false, message: "Repository not found" });
  }
  
  // Stop any running timer
  stopRepoTimer(id);
  
  res.json({ success: true, message: "Repository removed successfully" });
});

// GET /api/repos/:id/check-update - Check if a specific repository has updates available
app.get("/api/repos/:id/check-update", async (req, res) => {
  const { id } = req.params;
  const repo = getRepository(id);
  
  if (!repo || !repo.url) {
    return res.status(404).json({ success: false, message: "Repository not found" });
  }
  
  try {
    console.log(`🔍 Checking for updates: ${repo.name}`);
    const updateInfo = checkForUpdates(repo.url, baseDir);
    
    // Update repository with latest check info
    updateRepository(id, {
      lastUpdateCheck: new Date().toISOString(),
      currentVersion: updateInfo.currentCommit.substring(0, 8),
      latestVersion: updateInfo.latestCommit.substring(0, 8)
    });
    
    res.json({
      success: true,
      repository: {
        id: repo.id,
        name: repo.name,
        url: repo.url
      },
      updateInfo: {
        hasUpdates: updateInfo.hasUpdates,
        currentCommit: updateInfo.currentCommit,
        latestCommit: updateInfo.latestCommit,
        currentVersion: updateInfo.currentCommit.substring(0, 8),
        latestVersion: updateInfo.latestCommit.substring(0, 8),
        commitsBehind: updateInfo.commitsBehind,
        lastChecked: new Date().toISOString(),
        error: updateInfo.error
      }
    });
  } catch (error: any) {
    console.error(`❌ Error checking updates for ${repo.name}:`, error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// POST /api/repos/check-updates - Check for updates on all repositories
app.post("/api/repos/check-updates", async (req, res) => {
  try {
    console.log("🔍 Checking updates for all managed repositories...");
    
    // Sync installation status with CasaOS
    await syncWithCasaOS();
    
    const repositories = loadRepositories();
    const results: any[] = [];
    
    for (const repo of repositories) {
      if (repo.url) {
        try {
          const updateInfo = checkForUpdates(repo.url, baseDir);
          
          // Update repository with latest check info
          updateRepository(repo.id, {
            lastUpdateCheck: new Date().toISOString(),
            currentVersion: updateInfo.currentCommit.substring(0, 8),
            latestVersion: updateInfo.latestCommit.substring(0, 8)
          });
          
          results.push({
            repository: {
              id: repo.id,
              name: repo.name,
              url: repo.url
            },
            updateInfo: {
              hasUpdates: updateInfo.hasUpdates,
              currentCommit: updateInfo.currentCommit,
              latestCommit: updateInfo.latestCommit,
              currentVersion: updateInfo.currentCommit.substring(0, 8),
              latestVersion: updateInfo.latestCommit.substring(0, 8),
              commitsBehind: updateInfo.commitsBehind,
              error: updateInfo.error
            }
          });
        } catch (error: any) {
          console.error(`Failed to check updates for ${repo.id}:`, error);
          results.push({
            repository: {
              id: repo.id,
              name: repo.name,
              url: repo.url
            },
            updateInfo: {
              hasUpdates: false,
              error: error.message
            }
          });
        }
      }
    }
    
    const totalWithUpdates = results.filter(r => r.updateInfo.hasUpdates).length;
    
    res.json({ 
      success: true, 
      message: `Update check completed. ${totalWithUpdates} repositories have updates available.`,
      summary: {
        totalChecked: results.length,
        withUpdates: totalWithUpdates,
        lastChecked: new Date().toISOString()
      },
      repositories: results
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /api/build-queue/status - Get build queue status
app.get("/api/build-queue/status", (req, res) => {
  try {
    const status = buildQueue.getQueueStatus();
    res.json({ success: true, data: status });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /api/build-queue/history - Get recent build history
app.get("/api/build-queue/history", (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 10;
    const history = buildQueue.getRecentJobs(limit);
    res.json({ success: true, data: history });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// DELETE /api/build-queue/:repositoryId - Cancel a queued build
app.delete("/api/build-queue/:repositoryId", (req, res) => {
  try {
    const { repositoryId } = req.params;
    const cancelled = buildQueue.cancelQueuedJob(repositoryId);
    
    if (cancelled) {
      res.json({ success: true, message: "Build job cancelled successfully" });
    } else {
      res.status(404).json({ success: false, message: "No queued build job found for this repository" });
    }
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /api/system/ready - Simple readiness check for UI loading (NO docker commands)
app.get("/api/system/ready", (req, res) => {
  const checks = {
    dockerSock: false,
    storageInitialized: false,
    appInitialized: true // This endpoint existing means basic app is running
  };
  
  let readyMessage = 'System is initializing...';
  let errors: string[] = [];
  
  try {
    // Check 1: Docker socket exists (file check only - no docker commands!)
    checks.dockerSock = fs.existsSync('/var/run/docker.sock');
    if (!checks.dockerSock) {
      errors.push('Docker socket not mounted yet');
    }
    
    // Check 2: Storage system initialized (directories exist)
    try {
      const storageDir = '/app/uidata';
      if (fs.existsSync(storageDir)) {
        checks.storageInitialized = true;
      } else {
        errors.push('Storage system not initialized');
      }
    } catch (error) {
      errors.push('Storage check failed');
    }
    
    // Determine overall readiness (ONLY file system checks)
    const isReady = checks.dockerSock && checks.storageInitialized && checks.appInitialized;
    
    if (isReady) {
      readyMessage = 'System is ready for use';
    } else if (!checks.dockerSock) {
      readyMessage = 'Waiting for Docker integration to be configured...';
    } else if (!checks.storageInitialized) {
      readyMessage = 'Storage system is initializing...';
    } else {
      readyMessage = 'System components are initializing...';
    }
    
    res.json({
      ready: isReady,
      message: readyMessage,
      timestamp: new Date().toISOString(),
      checks,
      errors: errors.length > 0 ? errors : undefined
    });
    
  } catch (error: any) {
    res.json({
      ready: false,
      message: 'System readiness check failed',
      timestamp: new Date().toISOString(),
      checks,
      errors: [...errors, error.message]
    });
  }
});

// GET /api/system/status - Check system status (Docker, CasaOS, etc.)
app.get("/api/system/status", async (req, res) => {
  const status = {
    docker: false,
    casaos: false,
    dockerSock: false,
    errors: [] as string[]
  };

  // Check Docker
  try {
    execSync('docker --version', { stdio: 'pipe' });
    status.docker = true;
  } catch (error) {
    status.errors.push('Docker is not available or not running');
  }

  // Check Docker.sock
  try {
    status.dockerSock = fs.existsSync('/var/run/docker.sock');
    if (!status.dockerSock) {
      status.errors.push('Docker socket /var/run/docker.sock not found');
    }
  } catch (error) {
    status.errors.push('Failed to check Docker socket');
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
    success: status.docker && status.casaos && status.dockerSock,
    status,
    message: status.errors.length > 0 ? status.errors.join(', ') : 'All systems operational'
  });
});

// Environment-based force update API has been removed
// Use the web UI or POST /api/repos/:id/compile for manual builds

const port = config.webuiPort;
app.listen(port, () => {
  console.log(`🚀 UI and API listening on :${port}`);
  console.log(`   Access the installer UI at the app's root URL.`);
});
