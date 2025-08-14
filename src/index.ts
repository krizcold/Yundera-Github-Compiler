import { execSync } from "child_process";
import express from "express";
import path from "path";
import * as fs from "fs";
import * as crypto from "crypto";
import axios from "axios"; // Import axios for the backend
import { loadConfig, isAppLoggingEnabled } from "./config";
import { cloneOrUpdateRepo, checkForUpdates, GitUpdateInfo } from "./GitHandler";
import { loadRepositories, saveRepositories, loadSettings, saveSettings, addRepository, updateRepository, removeRepository, getRepository, Repository, GlobalSettings } from "./storage";
import { verifyCasaOSInstallation, isAppInstalledInCasaOS, getCasaOSInstalledApps, uninstallCasaOSApp, toggleCasaOSApp } from "./casaos-status";
import { buildQueue } from "./build-queue";
import { validateAuthHash, protectWebUI } from "./auth-middleware";


const config = loadConfig();
const baseDir = "/app/repos";

// Global state for repository management
let managedRepos: Repository[] = [];


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
  loadSettings(); // This ensures settings file is created with defaults if it doesn't exist
  
  if (isAppLoggingEnabled()) {
    console.log(`📋 Loaded ${managedRepos.length} repositories from storage`);
  }
  
  // Start individual timers for repositories with auto-update enabled
  managedRepos.forEach(repo => {
    if (repo.autoUpdate) {
      startRepoTimer(repo);
    }
  });
  
  // Docker exec approach is used for pre-install commands
  
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

// Poll uninstall status until completion
async function pollUninstallStatus(repositoryId: string, appName: string, attempt: number) {
  const maxAttempts = 30; // 5 minutes max (10s intervals)
  const pollInterval = 10000; // 10 seconds
  
  if (attempt >= maxAttempts) {
    console.log(`⏰ Uninstall polling timeout for ${appName} after ${maxAttempts} attempts`);
    const repo = getRepository(repositoryId);
    if (repo) {
      updateRepository(repositoryId, { 
        status: 'error',
        isInstalled: false // Assume it worked even if we can't verify
      });
    }
    return;
  }
  
  try {
    // Use force refresh to bypass any CasaOS caching
    const installedApps = await getCasaOSInstalledApps(true);
    const stillInstalled = installedApps.includes(appName);
    
    if (!stillInstalled) {
      // Uninstall completed successfully
      console.log(`✅ Uninstall completed for ${appName} after ${attempt + 1} attempts`);
      updateRepository(repositoryId, { 
        status: 'idle',
        isInstalled: false,
        isRunning: false,
        installMismatch: false
      });
      
      // Trigger full sync to update other repos
      setTimeout(() => syncWithCasaOS(), 1000);
      return;
    }
    
    // Still installed, continue polling
    console.log(`⏳ Uninstall in progress for ${appName} (attempt ${attempt + 1}/${maxAttempts})`);
    setTimeout(() => pollUninstallStatus(repositoryId, appName, attempt + 1), pollInterval);
    
  } catch (error) {
    console.error(`❌ Error polling uninstall status for ${appName}:`, error);
    // Continue polling despite error
    setTimeout(() => pollUninstallStatus(repositoryId, appName, attempt + 1), pollInterval);
  }
}

// Poll toggle status and respond to the original HTTP request when complete
async function pollToggleStatusAndRespond(res: any, repositoryId: string, appName: string, expectedRunning: boolean, attempt: number) {
  const maxAttempts = 10; // Reduced from 15 - don't make users wait too long
  const pollInterval = 3000; // 3 seconds
  
  if (attempt >= maxAttempts) {
    console.log(`⏰ Toggle verification timeout for ${appName} after ${maxAttempts} attempts`);
    // Get current repository to preserve isInstalled status
    const currentRepo = getRepository(repositoryId);
    updateRepository(repositoryId, { 
      status: 'success',
      isInstalled: currentRepo?.isInstalled || true  // Preserve installation status
    });
    res.status(500).json({ 
      success: false, 
      message: `Operation timed out - could not verify ${expectedRunning ? 'start' : 'stop'} completed` 
    });
    return;
  }
  
  try {
    const { getCasaOSAppStatus } = await import('./casaos-status');
    const status = await getCasaOSAppStatus(appName);
    
    if (status && status.isRunning === expectedRunning) {
      // Toggle completed successfully
      const action = expectedRunning ? 'started' : 'stopped';
      console.log(`✅ ${action} verified for ${appName} after ${attempt + 1} attempts`);
      
      // Get current repository to preserve isInstalled status
      const currentRepo = getRepository(repositoryId);
      updateRepository(repositoryId, { 
        status: 'success',
        isRunning: expectedRunning,
        isInstalled: currentRepo?.isInstalled || true  // Preserve current value, default to true since toggle succeeded
      });
      res.json({ 
        success: true, 
        message: `Application ${action} successfully` 
      });
      return;
    }
    
    // Status hasn't changed yet, continue polling
    const action = expectedRunning ? 'start' : 'stop';
    console.log(`⏳ Waiting for ${action} to complete for ${appName} (attempt ${attempt + 1}/${maxAttempts})`);
    setTimeout(() => pollToggleStatusAndRespond(res, repositoryId, appName, expectedRunning, attempt + 1), pollInterval);
    
  } catch (error) {
    console.error(`❌ Error verifying toggle status for ${appName}:`, error);
    // Continue polling despite error
    setTimeout(() => pollToggleStatusAndRespond(res, repositoryId, appName, expectedRunning, attempt + 1), pollInterval);
  }
}

// Poll toggle status until completion (for background operations)
async function pollToggleStatus(repositoryId: string, appName: string, expectedRunning: boolean, attempt: number) {
  const maxAttempts = 15; // 2.5 minutes max (10s intervals)
  const pollInterval = 10000; // 10 seconds
  
  if (attempt >= maxAttempts) {
    console.log(`⏰ Toggle polling timeout for ${appName} after ${maxAttempts} attempts`);
    const repo = getRepository(repositoryId);
    if (repo) {
      updateRepository(repositoryId, { 
        status: 'success',
        isRunning: expectedRunning // Assume it worked
      });
    }
    return;
  }
  
  try {
    const { getCasaOSAppStatus } = await import('./casaos-status');
    const status = await getCasaOSAppStatus(appName);
    
    if (status && status.isRunning === expectedRunning) {
      // Toggle completed successfully
      const action = expectedRunning ? 'start' : 'stop';
      console.log(`✅ ${action} completed for ${appName} after ${attempt + 1} attempts`);
      updateRepository(repositoryId, { 
        status: 'success',
        isRunning: expectedRunning
      });
      return;
    }
    
    // Status hasn't changed yet, continue polling
    const action = expectedRunning ? 'start' : 'stop';
    console.log(`⏳ ${action} in progress for ${appName} (attempt ${attempt + 1}/${maxAttempts})`);
    setTimeout(() => pollToggleStatus(repositoryId, appName, expectedRunning, attempt + 1), pollInterval);
    
  } catch (error) {
    console.error(`❌ Error polling toggle status for ${appName}:`, error);
    // Continue polling despite error
    setTimeout(() => pollToggleStatus(repositoryId, appName, expectedRunning, attempt + 1), pollInterval);
  }
}

// Sync repository installation status with CasaOS
export async function syncWithCasaOS() {
  
  try {
    const installedApps = await getCasaOSInstalledApps();
    
    for (const repo of managedRepos) {
      // Try to get actual app name from docker-compose.yml
      let appNameToCheck = repo.name;
      const composePath = path.join('/app/uidata', repo.name, 'docker-compose.yml');
      
      if (fs.existsSync(composePath)) {
        try {
          const yaml = require('yaml');
          const composeContent = fs.readFileSync(composePath, 'utf8');
          const composeData = yaml.parse(composeContent);
          
          if (composeData.services && Object.keys(composeData.services).length > 0) {
            appNameToCheck = Object.keys(composeData.services)[0];
          }
        } catch (error) {
          // If we can't parse, fall back to repo name
        }
      }
      
      const isInstalledInCasaOS = installedApps.includes(appNameToCheck);
      
      // Get detailed status including running state
      let isRunning = false;
      if (isInstalledInCasaOS) {
        try {
          const { getCasaOSAppStatus } = await import('./casaos-status');
          const status = await getCasaOSAppStatus(appNameToCheck);
          isRunning = status?.isRunning || false;
        } catch (error) {
          console.log(`⚠️ Could not get running status for ${appNameToCheck}`);
        }
      }
      
      // Don't sync if we're in an intermediate state (let polling handle it)
      const isInIntermediateState = 
        repo.status === 'uninstalling' ||
        repo.status === 'starting' ||
        repo.status === 'stopping';
      
      // Check for changes that need syncing (but respect intermediate states)
      const needsUpdate = !isInIntermediateState && (
        repo.isInstalled !== isInstalledInCasaOS ||
        repo.isRunning !== isRunning ||
        repo.installMismatch
      );
      
      if (needsUpdate) {
        const updates: any = {
          isInstalled: isInstalledInCasaOS,
          isRunning: isRunning,
          installMismatch: false
        };
        
        updateRepository(repo.id, updates);
        
        if (repo.isInstalled !== isInstalledInCasaOS) {
          console.log(`🔄 Updated ${repo.name} installation status: ${isInstalledInCasaOS}`);
        }
      }
    }
    
  } catch (error) {
    console.error("❌ Error syncing with CasaOS:", error);
  }
}

// --- API and UI Server ---
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true })); // Parse URL-encoded query parameters



// Session storage (in production, use Redis or database)
const activeSessions = new Map<string, { timestamp: number; authenticated: boolean }>();
const SESSION_DURATION = 24 * 60 * 60 * 1000; // 24 hours

// Make session storage globally accessible for auth middleware
(global as any).activeSessions = activeSessions;
(global as any).SESSION_DURATION = SESSION_DURATION;

// Cookie parser middleware
app.use((req, res, next) => {
  // Parse cookies manually (simple implementation)
  const cookies: Record<string, string> = {};
  const cookieHeader = req.headers.cookie;
  
  if (cookieHeader) {
    cookieHeader.split(';').forEach(cookie => {
      const [name, value] = cookie.trim().split('=');
      if (name && value) {
        cookies[name] = decodeURIComponent(value);
      }
    });
  }
  
  (req as any).cookies = cookies;
  next();
});

// Basic request logging (controlled by beacon)
app.use((req, res, next) => {
  // Only log non-static requests and only when beacon is enabled
  if (isAppLoggingEnabled() && !req.path.match(/\.(js|css|png|jpg|jpeg|gif|ico|svg)$/)) {
    console.log(`📡 ${req.method} ${req.originalUrl}`);
  }
  next();
});

// Reload managed repos from storage periodically to keep in sync
setInterval(() => {
  managedRepos = loadRepositories();
}, 30000); // Every 30 seconds

// More frequent sync with CasaOS to catch manual changes
setInterval(async () => {
  await syncWithCasaOS();
}, 15000); // Every 15 seconds

// Protected routes MUST come before static middleware
// Root serves the loading page (now index.html) - protected with auth
app.get("/", protectWebUI, (req, res) => {
  console.log(`✅ Serving index.html after authentication`);
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// Main app interface (redirected from loading page when ready) - protected with auth
app.get("/main", protectWebUI, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "main.html"));
});

// Serve static files from the 'public' directory (after protected routes)
// Only serve non-HTML static files to avoid conflicts with protected routes
app.use("/public", express.static(path.join(__dirname, "public"), {
  index: false, // Don't serve index.html automatically
  setHeaders: (res, filePath) => {
    // Block direct access to protected HTML files
    if (filePath.endsWith('index.html') || filePath.endsWith('main.html')) {
      res.status(403).send('Access denied');
      return;
    }
  }
}));

// Explicitly serve specific static assets that are safe
app.get("/main.js", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "main.js"));
});

app.get("/style.css", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "style.css"));
});

// Helper function to extract app name from compose
function getAppNameFromCompose(yamlContent: string): string {
  try {
    const yaml = require('yaml');
    const composeData = yaml.parse(yamlContent);
    
    // Priority: x-casaos.store_app_id
    if (composeData['x-casaos'] && composeData['x-casaos'].store_app_id) {
        return composeData['x-casaos'].store_app_id;
    }
    
    // Fallback: x-casaos.main service name
    if (composeData['x-casaos'] && composeData['x-casaos'].main && composeData.services && composeData.services[composeData['x-casaos'].main]) {
        return composeData['x-casaos'].main;
    }

    // Fallback: first service name
    if (composeData.services && Object.keys(composeData.services).length > 0) {
        return Object.keys(composeData.services)[0];
    }

    throw new Error("Could not determine application name from docker-compose.yml");
  } catch (error) {
    console.error("Error parsing YAML to get app name:", error);
    throw new Error("Invalid docker-compose.yml format.");
  }
}

// Repository Management API endpoints

// GET /api/repos - List all managed repositories
app.get("/api/repos", validateAuthHash, async (req, res) => {
  // Sync with CasaOS before returning
  await syncWithCasaOS();
  const repositories = loadRepositories();
  res.json({ repos: repositories });
});

// GET /api/settings - Get global settings
app.get("/api/settings", validateAuthHash, (req, res) => {
  const settings = loadSettings();
  res.json(settings);
});

// PUT /api/settings - Update global settings
app.put("/api/settings", validateAuthHash, (req, res) => {
  const settings = loadSettings();
  const updates = req.body;
  
  const newSettings = { ...settings, ...updates };
  saveSettings(newSettings);
  
  res.json({ success: true, settings: newSettings });
});

// POST /api/repos/create-from-compose - Create a new Docker Compose repository
app.post("/api/repos/create-from-compose", validateAuthHash, async (req, res) => {
  const { yaml } = req.body;
  if (!yaml) {
    return res.status(400).json({ success: false, message: "YAML content is required" });
  }

  try {
    const appName = getAppNameFromCompose(yaml);

    // Check if a repo with this name already exists
    const existingRepos = loadRepositories();
    if (existingRepos.some(r => r.name.toLowerCase() === appName.toLowerCase())) {
      return res.status(409).json({ success: false, message: `An application named '${appName}' already exists.` });
    }

    const newRepo = addRepository({
      name: appName,
      type: 'compose',
      autoUpdate: false,
      autoUpdateInterval: 60,
      apiUpdatesEnabled: true,
      status: 'imported'
    });

    // Save the docker-compose.yml to persistent storage
    const targetDir = path.join('/app/uidata', newRepo.name);
    const targetPath = path.join(targetDir, "docker-compose.yml");
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }
    fs.writeFileSync(targetPath, yaml, 'utf8');

    res.status(201).json({ success: true, repo: newRepo });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});


// PUT /api/repos/:id - Update a repository
app.put("/api/repos/:id", validateAuthHash, (req, res) => {
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

// POST /api/repos/:id/import - Import repository from GitHub (clone and analyze)
app.post("/api/repos/:id/import", validateAuthHash, async (req, res) => {
  const { id } = req.params;
  const repo = getRepository(id);
  
  if (!repo || !repo.url) {
    return res.status(400).json({ success: false, message: "Repository not found or URL not set" });
  }
  
  try {
    // Update status to importing
    updateRepository(id, { status: 'importing' });
    
    console.log(`🔽 Starting import for ${repo.name}...`);
    
    // Clone the repository to /app/repos/
    const repoPath = repo.url.replace(/\.git$/, '').split('/').pop() || 'repo';
    const repoConfig = {
      url: repo.url,
      path: repoPath,
      autoUpdate: repo.autoUpdate
    };
    
    // Clone/update the repository
    cloneOrUpdateRepo(repoConfig, baseDir);
    
    // Copy docker-compose.yml to persistent storage
    const sourcePath = path.join(baseDir, repoPath, "docker-compose.yml");
    const targetDir = path.join('/app/uidata', repo.name);
    const targetPath = path.join(targetDir, "docker-compose.yml");
    
    // Ensure target directory exists
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }
    
    // Copy docker-compose.yml if it exists
    let hasCompose = false;
    let icon = '';
    
    if (fs.existsSync(sourcePath)) {
      fs.copyFileSync(sourcePath, targetPath);
      hasCompose = true;
      console.log(`📋 Copied docker-compose.yml to ${targetPath}`);
      
      // Analyze docker-compose.yml for icon
      try {
        const yaml = await import('yaml');
        const composeContent = fs.readFileSync(targetPath, 'utf8');
        const composeData = yaml.parse(composeContent);
        
        // Look for icon in x-casaos section
        if (composeData['x-casaos'] && composeData['x-casaos'].icon) {
          icon = composeData['x-casaos'].icon;
          // Icon found and stored
        }
      } catch (error: any) {
        console.log(`⚠️ Could not parse docker-compose.yml for icon: ${error.message}`);
      }
    } else {
      console.log(`⚠️ No docker-compose.yml found in ${sourcePath}`);
    }
    
    // Update repository status to imported
    updateRepository(id, { 
      status: 'imported',
      hasCompose,
      icon: icon || undefined
    });
    
    console.log(`✅ Import completed for ${repo.name}`);
    
    res.json({ 
      success: true, 
      message: hasCompose ? 
        'Repository imported successfully with docker-compose.yml' : 
        'Repository imported successfully (no docker-compose.yml found)',
      hasCompose,
      icon
    });
    
  } catch (error: any) {
    console.error(`❌ Import failed for ${repo.name}:`, error);
    updateRepository(id, { status: 'error' });
    res.status(500).json({ success: false, message: error.message || "Import failed" });
  }
});

// POST /api/repos/:id/compile - Compile/build a repository
app.post("/api/repos/:id/compile", validateAuthHash, async (req, res) => {
  const { id } = req.params;
  const { runAsUser } = req.body;
  const repo = getRepository(id);
  
  if (!repo) {
    return res.status(404).json({ success: false, message: "Repository not found" });
  }

  if (repo.type === 'github' && !repo.url) {
    return res.status(400).json({ success: false, message: "Repository URL not set for GitHub type." });
  }
  
  try {
    const result = await buildQueue.addJob(repo, true, runAsUser);
    
    if (result.success) {
      res.json({ success: true, message: result.message });
      // Trigger immediate sync after successful build
      setTimeout(async () => {
        await syncWithCasaOS();
      }, 2000);
    } else {
      res.status(500).json({ success: false, message: result.message });
    }
  } catch (error: any) {
    console.error(`Compilation error for ${repo.id}:`, error);
    res.status(500).json({ success: false, message: error.message || "Compilation failed" });
  }
});

// GET /api/repos/:id/compose - Get docker-compose.yml content
app.get("/api/repos/:id/compose", validateAuthHash, async (req, res) => {
  const { id } = req.params;
  const repo = getRepository(id);
  
  if (!repo) {
    return res.status(400).json({ success: false, message: "Repository not found" });
  }
  
  try {
    // First try to read from persistent storage (/app/uidata/)
    const persistentComposePath = path.join('/app/uidata', repo.name, "docker-compose.yml");
    
    if (fs.existsSync(persistentComposePath)) {
      const yamlContent = fs.readFileSync(persistentComposePath, 'utf8');
      res.json({ success: true, yaml: yamlContent });
      return;
    }
    
    // Fallback: try to read from cloned repo (if repo has URL)
    if (repo.url) {
      const repoPath = repo.url.replace(/\.git$/, '').split('/').pop() || 'repo';
      const clonedComposePath = path.join(baseDir, repoPath, "docker-compose.yml");
      
      if (fs.existsSync(clonedComposePath)) {
        const yamlContent = fs.readFileSync(clonedComposePath, 'utf8');
        res.json({ success: true, yaml: yamlContent });
        return;
      }
    }
    
    // No compose file found
    res.json({ success: true, yaml: "# No docker-compose.yml found\n# Add your Docker Compose configuration here" });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// PUT /api/repos/:id/compose - Update docker-compose.yml content
app.put("/api/repos/:id/compose", validateAuthHash, async (req, res) => {
  const { id } = req.params;
  const { yaml } = req.body;
  const repo = getRepository(id);
  
  if (!repo) {
    return res.status(400).json({ success: false, message: "Repository not found" });
  }
  
  if (!yaml) {
    return res.status(400).json({ success: false, message: "YAML content is required" });
  }
  
  try {
    // Write to persistent storage first (/app/uidata/)
    const persistentDir = path.join('/app/uidata', repo.name);
    const persistentComposePath = path.join(persistentDir, "docker-compose.yml");
    
    // Ensure persistent directory exists
    if (!fs.existsSync(persistentDir)) {
      fs.mkdirSync(persistentDir, { recursive: true });
    }
    
    fs.writeFileSync(persistentComposePath, yaml, 'utf8');
    
    // Also write to cloned repo if it exists and repo has URL
    if (repo.url) {
      const repoPath = repo.url.replace(/\.git$/, '').split('/').pop() || 'repo';
      const clonedDir = path.join(baseDir, repoPath);
      const clonedComposePath = path.join(clonedDir, "docker-compose.yml");
      
      if (fs.existsSync(clonedDir)) {
        fs.writeFileSync(clonedComposePath, yaml, 'utf8');
      }
    }
    
    // Update repository metadata
    updateRepository(id, { hasCompose: true });
    
    res.json({ success: true, message: "Docker Compose file updated successfully" });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// DELETE /api/repos/:id - Remove a repository (and uninstall app if installed)
app.delete("/api/repos/:id", validateAuthHash, async (req, res) => {
  const { id } = req.params;
  
  // Get repository info before removing it
  const repo = getRepository(id);
  if (!repo) {
    return res.status(404).json({ success: false, message: "Repository not found" });
  }
  
  try {
    // First, uninstall the app from CasaOS if it's installed
    if (repo.isInstalled) {
      // Get app name from docker-compose.yml
      let appNameToUninstall = repo.name;
      const composePath = path.join('/app/uidata', repo.name, 'docker-compose.yml');
      
      if (fs.existsSync(composePath)) {
        try {
          const yaml = require('yaml');
          const composeContent = fs.readFileSync(composePath, 'utf8');
          const composeData = yaml.parse(composeContent);
          
          if (composeData.services && Object.keys(composeData.services).length > 0) {
            appNameToUninstall = Object.keys(composeData.services)[0];
          }
        } catch (error) {
          console.log(`⚠️ Could not parse docker-compose.yml, using repo name: ${repo.name}`);
        }
      }
      
      console.log(`🗑️ Uninstalling ${appNameToUninstall} from CasaOS before removing repository...`);
      const result = await uninstallCasaOSApp(appNameToUninstall);
      
      if (result.success) {
        console.log(`✅ App ${appNameToUninstall} uninstall initiated - waiting for completion...`);
        
        // Wait for actual uninstall completion (up to 30 seconds)
        let attempts = 0;
        const maxAttempts = 6; // 30 seconds total (5s intervals)
        let uninstallComplete = false;
        
        while (attempts < maxAttempts && !uninstallComplete) {
          await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5 seconds
          attempts++;
          
          try {
            const installedApps = await getCasaOSInstalledApps(true);
            uninstallComplete = !installedApps.includes(appNameToUninstall);
            
            if (uninstallComplete) {
              console.log(`✅ App ${appNameToUninstall} successfully uninstalled after ${attempts * 5}s`);
            } else {
              console.log(`⏳ Waiting for ${appNameToUninstall} uninstall completion (${attempts}/${maxAttempts})`);
            }
          } catch (error) {
            console.log(`⚠️ Error checking uninstall status: ${error}`);
          }
        }
        
        if (!uninstallComplete) {
          console.log(`⏰ Uninstall verification timeout for ${appNameToUninstall} - proceeding with repository removal`);
        }
      } else {
        console.log(`⚠️ Failed to uninstall ${appNameToUninstall}: ${result.message}`);
        // Continue with repository removal even if uninstall failed
      }
    }
    
    // Now remove the repository from storage
    const success = removeRepository(id);
    if (!success) {
      return res.status(404).json({ success: false, message: "Repository not found" });
    }
    
    // Stop any running timer
    stopRepoTimer(id);
    
    // Clean up persistent storage directory
    if (repo && repo.name) {
      const persistentDir = path.join('/app/uidata', repo.name);
      try {
        if (fs.existsSync(persistentDir)) {
          fs.rmSync(persistentDir, { recursive: true, force: true });
          console.log(`🧹 Cleaned up persistent storage: ${persistentDir}`);
        }
      } catch (error: any) {
        console.error(`⚠️ Failed to clean up persistent storage for ${repo.name}:`, error.message);
      }
      
      // Also clean up cloned repo directory if it exists
      if (repo.url) {
        const repoPath = repo.url.replace(/\.git$/, '').split('/').pop() || 'repo';
        const clonedDir = path.join(baseDir, repoPath);
        try {
          if (fs.existsSync(clonedDir)) {
            fs.rmSync(clonedDir, { recursive: true, force: true });
            console.log(`🧹 Cleaned up cloned repository: ${clonedDir}`);
          }
        } catch (error: any) {
          console.error(`⚠️ Failed to clean up cloned repository for ${repo.name}:`, error.message);
        }
      }
    }
    
    const message = repo.isInstalled 
      ? "Repository removed and app uninstalled from CasaOS"
      : "Repository and associated files removed successfully";
      
    res.json({ success: true, message });
    
  } catch (error: any) {
    console.error(`❌ Error removing repository ${repo.name}:`, error);
    res.status(500).json({ success: false, message: error.message || "Repository removal failed" });
  }
});

// GET /api/repos/:id/check-update - Check if a specific repository has updates available
app.get("/api/repos/:id/check-update", validateAuthHash, async (req, res) => {
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
app.post("/api/repos/check-updates", validateAuthHash, async (req, res) => {
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
app.get("/api/build-queue/status", validateAuthHash, (req, res) => {
  try {
    const status = buildQueue.getQueueStatus();
    res.json({ success: true, data: status });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /api/build-queue/history - Get recent build history
app.get("/api/build-queue/history", validateAuthHash, (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 10;
    const history = buildQueue.getRecentJobs(limit);
    res.json({ success: true, data: history });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// DELETE /api/build-queue/:repositoryId - Cancel a queued build
app.delete("/api/build-queue/:repositoryId", validateAuthHash, (req, res) => {
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
app.get("/api/system/ready", validateAuthHash, (req, res) => {
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
app.get("/api/system/status", validateAuthHash, async (req, res) => {
  const status = {
    docker: false,
    casaos: true, // Assume true since we are not calling it anymore
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

  res.json({
    success: status.docker && status.casaos && status.dockerSock,
    status,
    message: status.errors.length > 0 ? status.errors.join(', ') : 'All systems operational'
  });
});


// POST /api/repos/:id/uninstall - Uninstall app from CasaOS
app.post("/api/repos/:id/uninstall", validateAuthHash, async (req, res) => {
  const { id } = req.params;
  const repo = getRepository(id);
  
  if (!repo) {
    return res.status(404).json({ success: false, message: "Repository not found" });
  }
  
  try {
    // Get app name from docker-compose.yml
    let appNameToUninstall = repo.name;
    const composePath = path.join('/app/uidata', repo.name, 'docker-compose.yml');
    
    if (fs.existsSync(composePath)) {
      try {
        const yaml = require('yaml');
        const composeContent = fs.readFileSync(composePath, 'utf8');
        const composeData = yaml.parse(composeContent);
        
        if (composeData.services && Object.keys(composeData.services).length > 0) {
          appNameToUninstall = Object.keys(composeData.services)[0];
        }
      } catch (error) {
        console.log(`⚠️ Could not parse docker-compose.yml, using repo name: ${repo.name}`);
      }
    }
    
    // Set status to uninstalling immediately
    updateRepository(id, { 
      status: 'uninstalling',
      isRunning: false
    });
    
    console.log(`🗑️ Uninstalling ${appNameToUninstall} from CasaOS...`);
    const result = await uninstallCasaOSApp(appNameToUninstall);
    
    if (result.success) {
      console.log(`✅ Successfully initiated uninstall for ${appNameToUninstall}`);
      res.json({ success: true, message: result.message });
      
      // Start polling to verify uninstall completion
      pollUninstallStatus(id, appNameToUninstall, 0);
    } else {
      console.log(`❌ Failed to uninstall ${appNameToUninstall}: ${result.message}`);
      // Revert status on failure
      updateRepository(id, { status: 'success' });
      res.status(500).json({ success: false, message: result.message });
    }
    
  } catch (error: any) {
    console.error(`❌ Uninstall error for ${repo.name}:`, error);
    res.status(500).json({ success: false, message: error.message || "Uninstall failed" });
  }
});

// POST /api/repos/:id/toggle - Start/Stop app in CasaOS
app.post("/api/repos/:id/toggle", validateAuthHash, async (req, res) => {
  const { id } = req.params;
  const { start } = req.body; // true to start, false to stop
  const repo = getRepository(id);
  
  if (!repo) {
    return res.status(404).json({ success: false, message: "Repository not found" });
  }
  
  if (!repo.isInstalled) {
    return res.status(400).json({ success: false, message: "App is not installed" });
  }
  
  try {
    // Get app name from docker-compose.yml
    let appNameToToggle = repo.name;
    const composePath = path.join('/app/uidata', repo.name, 'docker-compose.yml');
    
    if (fs.existsSync(composePath)) {
      try {
        const yaml = require('yaml');
        const composeContent = fs.readFileSync(composePath, 'utf8');
        const composeData = yaml.parse(composeContent);
        
        if (composeData.services && Object.keys(composeData.services).length > 0) {
          appNameToToggle = Object.keys(composeData.services)[0];
        }
      } catch (error) {
        console.log(`⚠️ Could not parse docker-compose.yml, using repo name: ${repo.name}`);
      }
    }
    
    const action = start ? 'start' : 'stop';
    
    // Set intermediate status immediately
    updateRepository(id, { 
      status: start ? 'starting' : 'stopping'
    });
    
    console.log(`${start ? '▶️' : '⏹️'} ${action}ing ${appNameToToggle} in CasaOS...`);
    
    const result = await toggleCasaOSApp(appNameToToggle, start);
    
    if (result.success) {
      console.log(`✅ Toggle command sent for ${appNameToToggle}, now verifying actual status change...`);
      
      // Don't return success yet - wait for verification
      // Start polling to verify status change and respond when complete
      pollToggleStatusAndRespond(res, id, appNameToToggle, start, 0);
    } else {
      console.log(`❌ Failed to ${action} ${appNameToToggle}: ${result.message}`);
      // Revert status on failure
      updateRepository(id, { status: 'success' });
      res.status(500).json({ success: false, message: `Failed to ${action} application: ${result.message}` });
    }
    
  } catch (error: any) {
    console.error(`❌ Toggle error for ${repo.name}:`, error);
    res.status(500).json({ success: false, message: error.message || "Toggle failed" });
  }
});

// DEBUG: Get detailed app status for troubleshooting
app.get("/api/repos/:id/debug", validateAuthHash, async (req, res) => {
  const { id } = req.params;
  const repo = getRepository(id);
  
  if (!repo) {
    return res.status(404).json({ success: false, message: "Repository not found" });
  }
  
  try {
    const { getCasaOSAppStatus } = await import('./casaos-status');
    
    // Get app name from docker-compose.yml
    let appNameToCheck = repo.name;
    const composePath = path.join('/app/uidata', repo.name, 'docker-compose.yml');
    
    if (fs.existsSync(composePath)) {
      try {
        const yaml = require('yaml');
        const composeContent = fs.readFileSync(composePath, 'utf8');
        const composeData = yaml.parse(composeContent);
        
        if (composeData.services && Object.keys(composeData.services).length > 0) {
          appNameToCheck = Object.keys(composeData.services)[0];
        }
      } catch (error) {
        console.log(`⚠️ Could not parse docker-compose.yml for debug`);
      }
    }
    
    const casaosStatus = await getCasaOSAppStatus(appNameToCheck);
    
    // Also get Docker container info
    let dockerInfo = {};
    try {
      const { exec } = require('child_process');
      const { promisify } = require('util');
      const execAsync = promisify(exec);
      const { stdout } = await execAsync(`docker ps -a --filter "name=${appNameToCheck}" --format "{{.Names}}\t{{.Status}}\t{{.State}}"`);
      dockerInfo = { containerList: stdout };
    } catch (error: any) {
      dockerInfo = { error: error.message };
    }
    
    res.json({
      success: true,
      debug: {
        repoName: repo.name,
        appNameUsed: appNameToCheck,
        repoStatus: repo.status,
        repoIsInstalled: repo.isInstalled,
        repoIsRunning: repo.isRunning,
        casaosStatus,
        dockerInfo
      }
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Log streaming endpoint for real-time terminal output
app.get("/api/repos/:id/logs", validateAuthHash, (req, res) => {
  const { id } = req.params;
  const repo = getRepository(id);
  
  if (!repo) {
    return res.status(404).json({ success: false, message: "Repository not found" });
  }

  // Set up Server-Sent Events
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Cache-Control'
  });

  // Send initial connection message
  res.write(`data: ${JSON.stringify({ 
    message: `Connected to logs for ${repo.name}`, 
    type: 'system' 
  })}\n\n`);

  // Get or create log collector for this repository
  const logCollector = buildQueue.getLogCollector(id);
  
  // Send any existing logs
  const existingLogs = logCollector.getLogs();
  existingLogs.forEach(log => {
    res.write(`data: ${JSON.stringify(log)}\n\n`);
  });

  // Listen for new logs
  const onLog = (log: any) => {
    if (res.writable) {
      res.write(`data: ${JSON.stringify(log)}\n\n`);
    }
  };

  logCollector.on('log', onLog);

  // Handle client disconnect
  req.on('close', () => {
    logCollector.removeListener('log', onLog);
    res.end();
  });

  // Keep connection alive
  const keepAlive = setInterval(() => {
    if (res.writable) {
      res.write(`data: ${JSON.stringify({ message: '', type: 'ping' })}\n\n`);
    } else {
      clearInterval(keepAlive);
    }
  }, 30000);
});

// Environment-based force update API has been removed
// Use the web UI or POST /api/repos/:id/compile for manual builds

const port = config.webuiPort;
app.listen(port, () => {
  console.log(`🚀 UI and API listening on :${port}`);
  console.log(`   Access the installer UI at the app's root URL.`);
});
