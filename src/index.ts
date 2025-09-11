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
import { validateAuthHash, protectWebUI, validateAppTokenMiddleware, AppAuthenticatedRequest } from "./auth-middleware";
import { createAppToken, removeAppToken, hasPermission } from "./app-tokens";


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
  const autoUpdateRepos = managedRepos.filter(repo => repo.autoUpdate);
  console.log(`⏰ Starting auto-update timers for ${autoUpdateRepos.length} repositories`);
  
  autoUpdateRepos.forEach(repo => {
    startRepoTimer(repo);
  });
  
  if (autoUpdateRepos.length === 0) {
    console.log(`ℹ️ No repositories have auto-update enabled`);
  }
  
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
    console.log(`⏱️ Auto-update timer triggered for ${repository.name}`);
    const updatedRepo = getRepository(repository.id);
    
    if (!updatedRepo) {
      console.log(`⚠️ Repository ${repository.name} not found, stopping timer`);
      stopRepoTimer(repository.id);
      return;
    }

    if (!updatedRepo.autoUpdate) {
      console.log(`⚠️ Auto-update disabled for ${repository.name}, stopping timer`);
      stopRepoTimer(repository.id);
      return;
    }

    // Only check for updates if it's a GitHub repo with a URL
    if (updatedRepo.type === 'github' && updatedRepo.url) {
      try {
        console.log(`🔍 Checking for updates: ${updatedRepo.name}`);
        const updateInfo = checkForUpdates(updatedRepo.url, baseDir);
        
        // Update repository with check time and version info
        updateRepository(updatedRepo.id, {
          lastUpdateCheck: new Date().toISOString(),
          currentVersion: updateInfo.currentCommit.substring(0, 8),
          latestVersion: updateInfo.latestCommit.substring(0, 8)
        });
        
        if (updateInfo.hasUpdates) {
          console.log(`📋 Updates available for ${updatedRepo.name} (${updateInfo.commitsBehind} commits behind)`);
          await buildQueue.addJob(updatedRepo, false);
          console.log(`✅ Auto-update build queued for ${updatedRepo.name}`);
        } else {
          console.log(`✅ ${updatedRepo.name} is up to date`);
        }
        
      } catch (error) {
        console.error(`❌ Auto-update check failed for ${updatedRepo.name}:`, error);
      }
    } else {
      console.log(`⚠️ Skipping auto-update for ${updatedRepo.name} (not a GitHub repo with URL)`);
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

// POST /api/repos - Create a new GitHub repository
app.post("/api/repos", validateAuthHash, async (req, res) => {
  const { name, url, type, autoUpdate, autoUpdateInterval, apiUpdatesEnabled, status } = req.body;
  
  if (!name || !type) {
    return res.status(400).json({ success: false, message: "Name and type are required" });
  }
  
  if (type === 'github' && !url) {
    return res.status(400).json({ success: false, message: "URL is required for GitHub repositories" });
  }
  
  try {
    // Check if a repo with this name already exists
    const existingRepos = loadRepositories();
    if (existingRepos.some(r => r.name.toLowerCase() === name.toLowerCase())) {
      return res.status(409).json({ success: false, message: `An application named '${name}' already exists.` });
    }
    
    const newRepo = addRepository({
      name,
      url,
      type,
      autoUpdate: autoUpdate || false,
      autoUpdateInterval: autoUpdateInterval || 60,
      apiUpdatesEnabled: apiUpdatesEnabled !== false,
      status: status || 'empty'
    });
    
    res.json({ success: true, repo: newRepo });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
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
    let displayName;
    
    if (fs.existsSync(sourcePath)) {
      fs.copyFileSync(sourcePath, targetPath);
      hasCompose = true;
      console.log(`📋 Copied docker-compose.yml to ${targetPath}`);
      
      // Analyze docker-compose.yml for icon and display name
      try {
        const yaml = await import('yaml');
        const composeContent = fs.readFileSync(targetPath, 'utf8');
        const composeData = yaml.parse(composeContent);
        
        // Extract display name from compose file's name property
        if (composeData.name && composeData.name !== repo.name) {
          displayName = composeData.name;
          console.log(`🏷️ Found app name in compose file: ${displayName}`);
        }
        
        // Look for icon in x-casaos section
        if (composeData['x-casaos'] && composeData['x-casaos'].icon) {
          icon = composeData['x-casaos'].icon;
          // Icon found and stored
        }
      } catch (error: any) {
        console.log(`⚠️ Could not parse docker-compose.yml for icon and name: ${error.message}`);
      }
    } else {
      console.log(`⚠️ No docker-compose.yml found in ${sourcePath}`);
    }
    
    // Update repository status to imported
    const updateData: any = { 
      status: 'imported',
      hasCompose,
      icon: icon || undefined
    };
    
    // Add displayName if we found one in the compose file
    if (displayName) {
      updateData.displayName = displayName;
      console.log(`📝 Updated repository display name to: ${displayName}`);
    }
    
    updateRepository(id, updateData);
    
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
  const { preserveData } = req.body || {};
  
  
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
      const result = await uninstallCasaOSApp(appNameToUninstall, preserveData);
      
      if (result.success) {
        // If data was preserved, we manually stopped containers - no need to poll CasaOS
        if (result.message.includes('(data preserved)')) {
          console.log(`✅ App ${appNameToUninstall} containers stopped`);
        } else {
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
        }
      } else {
        console.log(`⚠️ Failed to uninstall ${appNameToUninstall}: ${result.message}`);
        // Continue with repository removal even if uninstall failed
      }
    }
    
    // Remove app token if it exists
    try {
      const actualAppName = repo.displayName || repo.name;
      const tokenRemoved = removeAppToken(actualAppName, repo.id);
      if (tokenRemoved) {
        console.log(`🔑 Removed app token for ${actualAppName}`);
      }
    } catch (tokenError: any) {
      const actualAppName = repo.displayName || repo.name;
      console.warn(`⚠️ Failed to remove app token for ${actualAppName}: ${tokenError.message}`);
      // Don't fail the removal if token cleanup fails
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
      
      // Handle app data directory based on preserveData setting
      // Use the same app name logic as the uninstall process
      let appDataDirName = repo.name;
      const composePath = path.join('/app/uidata', repo.name, 'docker-compose.yml');
      
      if (fs.existsSync(composePath)) {
        try {
          const yaml = require('yaml');
          const composeContent = fs.readFileSync(composePath, 'utf8');
          const composeData = yaml.parse(composeContent);
          
          if (composeData.name) {
            appDataDirName = composeData.name;
          } else if (composeData.services && Object.keys(composeData.services).length > 0) {
            appDataDirName = Object.keys(composeData.services)[0];
          }
        } catch (error) {
          // Use repo.name as fallback
        }
      }
      
      const appDataDir = path.join('/DATA/AppData', appDataDirName);
      if (!preserveData && fs.existsSync(appDataDir)) {
        // Remove data directory when checkbox is checked (preserveData = false)
        try {
          fs.rmSync(appDataDir, { recursive: true, force: true });
          console.log(`🧹 Removed app data directory: ${appDataDir}`);
        } catch (error: any) {
          console.error(`⚠️ Failed to remove app data directory:`, error.message);
        }
      } else if (preserveData) {
        console.log(`💾 Preserving app data directory: ${appDataDir}`);
      }
      
      // Clean up CasaOS metadata directory (always remove)
      const appMetadataDir = path.join('/DATA/AppData/casaos/apps', repo.name);
      try {
        if (fs.existsSync(appMetadataDir)) {
          fs.rmSync(appMetadataDir, { recursive: true, force: true });
        }
      } catch (error: any) {
        console.error(`⚠️ Failed to clean up app metadata directory for ${repo.name}:`, error.message);
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
    
    let message = "";
    if (repo.isInstalled) {
      if (preserveData) {
        message = "Repository removed, app uninstalled from CasaOS, and application data preserved";
      } else {
        message = "Repository removed and app uninstalled from CasaOS";
      }
    } else {
      message = "Repository and associated files removed successfully";
    }
      
    res.json({ success: true, message });
    
  } catch (error: any) {
    console.error(`❌ Error removing repository ${repo.name}:`, error);
    res.status(500).json({ success: false, message: error.message || "Repository removal failed" });
  }
});

// GET /api/repos/:id/check-updates - Check if a specific repository has updates available
app.get("/api/repos/:id/check-updates", validateAuthHash, async (req, res) => {
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

// POST /api/terminal/execute - Execute command in interactive terminal
app.post("/api/terminal/execute", validateAuthHash, async (req, res) => {
  const { command, runAsUser = 'ubuntu', currentDir = '/', envVars = {} } = req.body;
  
  if (!command || typeof command !== 'string') {
    return res.status(400).json({ success: false, message: "Command is required" });
  }
  
  // Sanitize user input
  const safeUser = runAsUser.replace(/[^a-zA-Z0-9_-]/g, '').substring(0, 32) || 'ubuntu';
  const safeCommand = command.trim();
  
  if (!safeCommand) {
    return res.status(400).json({ success: false, message: "Command cannot be empty" });
  }
  
  try {
    const { exec } = await import('child_process');
    const { promisify } = require('util');
    const execAsync = promisify(exec);
    
    // Log the command execution
    console.log(`🖥️ Terminal command executed by ${safeUser}: ${safeCommand}`);
    
    // Test Docker and CasaOS container access first
    try {
      const dockerTest = await execAsync('docker ps --filter "name=casaos" --format "{{.Names}}"', {
        timeout: 10000,
        maxBuffer: 1024 * 1024
      });
      
      if (dockerTest.stdout.trim() !== 'casaos') {
        return res.status(500).json({ 
          success: false, 
          message: `CasaOS container not found. Available containers: ${dockerTest.stdout}` 
        });
      }
    } catch (error: any) {
      console.error('Docker access test failed:', error);
      return res.status(500).json({ 
        success: false, 
        message: `Cannot access Docker or CasaOS container: ${error.message}` 
      });
    }
    
    // Build environment variables string
    const envString = Object.entries(envVars)
      .map(([key, value]) => `${key}="${value}"`)
      .join(' ');
    
    // Execute command with session state (current directory and environment)
    // We execute the command, then get the new working directory
    const sessionCommand = `
      cd "${currentDir}" 2>/dev/null || cd /;
      ${envString ? `export ${envString};` : ''}
      ${safeCommand};
      echo "---PWD---";
      pwd
    `;
    
    const dockerCommand = `docker exec --user ${safeUser} casaos bash -c '${sessionCommand.replace(/'/g, "'\\''")}'`;
    
    const result = await execAsync(dockerCommand, {
      timeout: 60000, // 1 minute timeout
      maxBuffer: 1024 * 1024 * 5, // 5MB buffer
      shell: '/bin/sh'
    });
    
    // Extract the new directory from the output
    let stdout = result.stdout || '';
    let newDir = currentDir;
    
    // Look for our PWD marker and extract the directory
    const pwdMarkerIndex = stdout.lastIndexOf('---PWD---');
    if (pwdMarkerIndex !== -1) {
      const afterMarker = stdout.substring(pwdMarkerIndex + 9);
      const newDirMatch = afterMarker.trim().split('\n')[0];
      if (newDirMatch && newDirMatch.startsWith('/')) {
        newDir = newDirMatch.trim();
        // Remove the PWD section from the output
        stdout = stdout.substring(0, pwdMarkerIndex).trim();
      }
    }
    
    res.json({
      success: true,
      stdout: stdout,
      stderr: result.stderr || '',
      command: safeCommand,
      user: safeUser,
      newDir: newDir,
      envVars: envVars // Return current env vars (could be enhanced to detect changes)
    });
    
  } catch (error: any) {
    console.error(`❌ Terminal command execution failed:`, error);
    
    // Extract useful error information
    let errorMessage = error.message || 'Unknown error';
    let stdout = '';
    let stderr = '';
    
    // If it's an exec error, we might have partial output
    if (error.stdout) stdout = error.stdout;
    if (error.stderr) stderr = error.stderr;
    
    // Handle specific error cases
    if (error.message.includes('ENOENT')) {
      errorMessage = 'Command not found or shell unavailable';
    } else if (error.message.includes('timeout')) {
      errorMessage = 'Command timed out (60 second limit)';
    } else if (error.message.includes('killed')) {
      errorMessage = 'Command was killed or interrupted';
    }
    
    res.json({
      success: false,
      message: errorMessage,
      stdout: stdout,
      stderr: stderr,
      command: safeCommand,
      user: safeUser,
      newDir: currentDir, // Keep current directory on error
      envVars: envVars
    });
  }
});

// POST /api/terminal/autocomplete - Provide file/folder autocomplete for terminal
app.post("/api/terminal/autocomplete", validateAuthHash, async (req, res) => {
  const { path: inputPath, currentDir = '/', runAsUser = 'ubuntu' } = req.body;
  
  // Handle empty path - list current directory
  if (!inputPath || typeof inputPath !== 'string' || inputPath.trim() === '') {
    const safeUser = runAsUser.replace(/[^a-zA-Z0-9_-]/g, '').substring(0, 32) || 'ubuntu';
    
    try {
      const { exec } = await import('child_process');
      const { promisify } = require('util');
      const execAsync = promisify(exec);
      
      // Test Docker and CasaOS container access first
      try {
        const dockerTest = await execAsync('docker ps --filter "name=casaos" --format "{{.Names}}"', {
          timeout: 5000,
          maxBuffer: 1024 * 1024
        });
        
        if (dockerTest.stdout.trim() !== 'casaos') {
          return res.json({ success: false, message: 'CasaOS container not found' });
        }
      } catch (error: any) {
        return res.json({ success: false, message: 'Cannot access Docker or CasaOS container' });
      }
      
      // List all files in current directory with detailed info
      const listCommand = `cd "${currentDir}" && ls -1a | grep -v '^\\.$' | grep -v '^\\.\\.$' | while read file; do
        if [ -d "\$file" ]; then
          echo "directory|\$file||"
        else
          size=\$(ls -l "\$file" 2>/dev/null | awk '{print \$5}' || echo "")
          echo "file|\$file|\$size|"
        fi
      done`;
      
      const dockerCommand = `docker exec --user ${safeUser} casaos bash -c '${listCommand.replace(/'/g, "'\\''")}'`;
      
      console.log(`[DEBUG] Autocomplete - currentDir: ${currentDir}, user: ${safeUser}`);
      console.log(`[DEBUG] Docker command: ${dockerCommand}`);
      
      const result = await execAsync(dockerCommand, {
        timeout: 10000,
        maxBuffer: 1024 * 1024,
        shell: '/bin/sh'
      });
      
      console.log(`[DEBUG] Raw output: ${result.stdout}`);
      
      const completions: any[] = [];
      if (result.stdout) {
        const lines = result.stdout.trim().split('\n').filter((line: string) => line.trim());
        
        for (const line of lines) {
          if (line.trim()) {
            const [type, name, size, permissions] = line.split('|');
            if (name && name.trim()) {
              completions.push({
                name: name.trim(),
                type: type,
                size: size !== '-' ? size : '',
                permissions: permissions
              });
            }
          }
        }
      }
      
      return res.json({ success: true, completions });
    } catch (error: any) {
      console.error('Directory listing failed:', error);
      return res.json({ success: false, message: 'Failed to list directory contents' });
    }
  }
  
  // Sanitize user input
  const safeUser = runAsUser.replace(/[^a-zA-Z0-9_-]/g, '').substring(0, 32) || 'ubuntu';
  const safePath = inputPath.trim();
  
  try {
    const { exec } = await import('child_process');
    const { promisify } = require('util');
    const execAsync = promisify(exec);
    
    // Test Docker and CasaOS container access first
    try {
      const dockerTest = await execAsync('docker ps --filter "name=casaos" --format "{{.Names}}"', {
        timeout: 5000,
        maxBuffer: 1024 * 1024
      });
      
      if (dockerTest.stdout.trim() !== 'casaos') {
        return res.json({ success: false, message: 'CasaOS container not found' });
      }
    } catch (error: any) {
      console.error('Docker access test failed for autocomplete:', error);
      return res.json({ success: false, message: 'Cannot access Docker or CasaOS container' });
    }
    
    // Determine the directory to search in and the prefix to match
    let searchDir = currentDir;
    let filePrefix = safePath;
    
    // Handle absolute vs relative paths
    if (safePath.startsWith('/')) {
      // Absolute path
      const lastSlash = safePath.lastIndexOf('/');
      if (lastSlash > 0) {
        searchDir = safePath.substring(0, lastSlash);
        filePrefix = safePath.substring(lastSlash + 1);
      } else {
        searchDir = '/';
        filePrefix = safePath.substring(1);
      }
    } else {
      // Relative path
      const lastSlash = safePath.lastIndexOf('/');
      if (lastSlash >= 0) {
        const relativeDir = safePath.substring(0, lastSlash);
        searchDir = currentDir === '/' ? `/${relativeDir}` : `${currentDir}/${relativeDir}`;
        filePrefix = safePath.substring(lastSlash + 1);
      }
    }
    
    // Clean up the search directory path
    searchDir = searchDir.replace(/\/+/g, '/').replace(/\/$/, '') || '/';
    
    // Build the autocomplete command
    // Use ls with specific formatting and grep to filter
    const autocompleteCommand = `
      cd "${searchDir}" 2>/dev/null || exit 1;
      ls -1a 2>/dev/null | grep -i "^${filePrefix}" | head -20
    `;
    
    const dockerCommand = `docker exec --user ${safeUser} casaos bash -c '${autocompleteCommand.replace(/'/g, "'\\''")}'`;
    
    const result = await execAsync(dockerCommand, {
      timeout: 10000, // 10 second timeout
      maxBuffer: 1024 * 1024,
      shell: '/bin/sh'
    });
    
    // Parse the output to get completions
    const completions: string[] = [];
    if (result.stdout) {
      const files = result.stdout.trim().split('\n').filter((line: string) => line.trim());
      
      for (const file of files) {
        const trimmedFile = file.trim();
        if (trimmedFile && trimmedFile !== '.' && trimmedFile !== '..') {
          // Check if it's a directory by trying to list it
          try {
            const testDirCommand = `docker exec --user ${safeUser} casaos bash -c 'cd "${searchDir}" && test -d "${trimmedFile}" && echo "DIR" || echo "FILE"'`;
            const dirResult = await execAsync(testDirCommand, {
              timeout: 2000,
              maxBuffer: 1024
            });
            
            // Add trailing slash for directories
            if (dirResult.stdout.trim() === 'DIR') {
              completions.push(trimmedFile + '/');
            } else {
              completions.push(trimmedFile);
            }
          } catch (e) {
            // If test fails, assume it's a file
            completions.push(trimmedFile);
          }
        }
      }
    }
    
    // Build full path completions
    const fullCompletions = completions.map(completion => {
      if (safePath.startsWith('/')) {
        // Absolute path
        const dirPart = searchDir === '/' ? '/' : searchDir + '/';
        return dirPart + completion;
      } else {
        // Relative path
        const lastSlash = safePath.lastIndexOf('/');
        if (lastSlash >= 0) {
          return safePath.substring(0, lastSlash + 1) + completion;
        } else {
          return completion;
        }
      }
    });
    
    res.json({
      success: true,
      completions: fullCompletions,
      searchDir: searchDir,
      prefix: filePrefix
    });
    
  } catch (error: any) {
    console.error(`❌ Autocomplete failed:`, error);
    res.json({
      success: false,
      message: error.message || 'Autocomplete failed',
      completions: []
    });
  }
});

// POST /api/terminal/rename - Rename a file or directory
app.post("/api/terminal/rename", validateAuthHash, async (req, res) => {
  const { oldName, newName, currentDir = '/', runAsUser = 'ubuntu' } = req.body;
  
  if (!oldName || !newName || oldName === newName) {
    return res.json({ success: false, message: 'Invalid rename parameters' });
  }
  
  // Sanitize user input
  const safeUser = runAsUser.replace(/[^a-zA-Z0-9_-]/g, '').substring(0, 32) || 'ubuntu';
  const safeOldName = oldName.trim();
  const safeNewName = newName.trim();
  
  try {
    const { exec } = await import('child_process');
    const { promisify } = require('util');
    const execAsync = promisify(exec);
    
    // Test Docker and CasaOS container access first
    try {
      const dockerTest = await execAsync('docker ps --filter "name=casaos" --format "{{.Names}}"', {
        timeout: 5000,
        maxBuffer: 1024 * 1024
      });
      
      if (dockerTest.stdout.trim() !== 'casaos') {
        return res.json({ success: false, message: 'CasaOS container not found' });
      }
    } catch (error: any) {
      return res.json({ success: false, message: 'Cannot access Docker or CasaOS container' });
    }
    
    // Build the rename command
    const renameCommand = `
      cd "${currentDir}" 2>/dev/null || exit 1;
      if [ ! -e "${safeOldName}" ]; then
        echo "ERROR: File does not exist"
        exit 1
      fi
      if [ -e "${safeNewName}" ]; then
        echo "ERROR: Target file already exists"
        exit 1
      fi
      mv "${safeOldName}" "${safeNewName}" && echo "SUCCESS"
    `;
    
    const dockerCommand = `docker exec --user ${safeUser} casaos bash -c '${renameCommand.replace(/'/g, "'\\''")}'`;
    
    const result = await execAsync(dockerCommand, {
      timeout: 10000,
      maxBuffer: 1024 * 1024,
      shell: '/bin/sh'
    });
    
    if (result.stdout.includes('SUCCESS')) {
      res.json({ success: true, message: `Renamed "${oldName}" to "${newName}"` });
    } else if (result.stdout.includes('ERROR:')) {
      res.json({ success: false, message: result.stdout.trim() });
    } else {
      res.json({ success: false, message: 'Rename operation failed' });
    }
    
  } catch (error: any) {
    console.error('Rename operation failed:', error);
    res.json({ success: false, message: error.message || 'Rename operation failed' });
  }
});

// POST /api/terminal/delete - Delete files or directories
app.post("/api/terminal/delete", validateAuthHash, async (req, res) => {
  const { fileNames, currentDir = '/', runAsUser = 'ubuntu' } = req.body;
  
  if (!fileNames || !Array.isArray(fileNames) || fileNames.length === 0) {
    return res.json({ success: false, message: 'No files specified for deletion' });
  }
  
  // Sanitize user input
  const safeUser = runAsUser.replace(/[^a-zA-Z0-9_-]/g, '').substring(0, 32) || 'ubuntu';
  const safeFileNames = fileNames.map(name => name.trim()).filter(name => name.length > 0);
  
  if (safeFileNames.length === 0) {
    return res.json({ success: false, message: 'No valid files specified' });
  }
  
  try {
    const { exec } = await import('child_process');
    const { promisify } = require('util');
    const execAsync = promisify(exec);
    
    // Test Docker and CasaOS container access first
    try {
      const dockerTest = await execAsync('docker ps --filter "name=casaos" --format "{{.Names}}"', {
        timeout: 5000,
        maxBuffer: 1024 * 1024
      });
      
      if (dockerTest.stdout.trim() !== 'casaos') {
        return res.json({ success: false, message: 'CasaOS container not found' });
      }
    } catch (error: any) {
      return res.json({ success: false, message: 'Cannot access Docker or CasaOS container' });
    }
    
    // Build the delete command
    const deleteCommand = `
      cd "${currentDir}" 2>/dev/null || exit 1;
      for file in ${safeFileNames.map(name => `"${name}"`).join(' ')}; do
        if [ ! -e "\$file" ]; then
          echo "ERROR: \$file does not exist"
          exit 1
        fi
      done
      rm -rf ${safeFileNames.map(name => `"${name}"`).join(' ')} && echo "SUCCESS: Deleted ${safeFileNames.length} item(s)"
    `;
    
    const dockerCommand = `docker exec --user ${safeUser} casaos bash -c '${deleteCommand.replace(/'/g, "'\\''")}'`;
    
    const result = await execAsync(dockerCommand, {
      timeout: 15000, // Longer timeout for delete operations
      maxBuffer: 1024 * 1024,
      shell: '/bin/sh'
    });
    
    if (result.stdout.includes('SUCCESS:')) {
      res.json({ success: true, message: result.stdout.trim() });
    } else if (result.stdout.includes('ERROR:')) {
      res.json({ success: false, message: result.stdout.trim() });
    } else {
      res.json({ success: false, message: 'Delete operation failed' });
    }
    
  } catch (error: any) {
    console.error('Delete operation failed:', error);
    res.json({ success: false, message: error.message || 'Delete operation failed' });
  }
});

// GET /api/services/:service/logs - Get logs for a specific service
app.get("/api/services/:service/logs", validateAuthHash, async (req, res) => {
  const { service } = req.params;
  const { lines = 100 } = req.query;
  
  console.log(`📋 Getting logs for service: ${service}`);
  
  try {
    let containerName: string;
    let logCommand: string;
    
    // Map service names to container names and log commands
    switch (service) {
      case 'github-compiler':
        containerName = 'yunderagithubcompiler';
        logCommand = `docker logs --tail ${lines} ${containerName}`;
        break;
      case 'casaos':
        containerName = 'casaos';
        logCommand = `docker logs --tail ${lines} ${containerName}`;
        break;
      case 'mesh-router':
        containerName = 'mesh-router';
        logCommand = `docker logs --tail ${lines} ${containerName}`;
        break;
      default:
        return res.status(400).json({ 
          success: false, 
          message: `Unknown service: ${service}` 
        });
    }
    
    // Execute docker logs command
    const result = execSync(logCommand, { 
      encoding: 'utf8',
      timeout: 30000,
      maxBuffer: 1024 * 1024 * 10 // 10MB max buffer
    });
    
    // Split logs into lines and filter out empty ones
    const logs = result.split('\n').filter(line => line.trim().length > 0);
    
    console.log(`✅ Retrieved ${logs.length} log lines for ${service}`);
    res.json({ success: true, logs, service: containerName });
    
  } catch (error: any) {
    console.error(`❌ Failed to get logs for ${service}:`, error.message);
    
    // Check if it's a container not found error
    if (error.message.includes('No such container')) {
      res.json({ 
        success: true, 
        logs: [`Container '${service}' not found or not running`],
        service: service
      });
    } else {
      res.status(500).json({ 
        success: false, 
        message: `Failed to retrieve logs: ${error.message}` 
      });
    }
  }
});

// POST /api/services/execute - Execute command in a service container
app.post("/api/services/execute", validateAuthHash, async (req, res) => {
  const { service, command } = req.body;
  
  if (!service || !command) {
    return res.status(400).json({ 
      success: false, 
      message: "Service and command are required" 
    });
  }
  
  console.log(`🖥️ Executing command in ${service}: ${command}`);
  
  try {
    let containerName: string;
    
    // Map service names to container names
    switch (service) {
      case 'github-compiler':
        containerName = 'yunderagithubcompiler';
        break;
      case 'casaos':
        containerName = 'casaos';
        break;
      case 'mesh-router':
        containerName = 'mesh-router';
        break;
      default:
        return res.status(400).json({ 
          success: false, 
          message: `Unknown service: ${service}` 
        });
    }
    
    // Execute command in container with proper escaping
    // Validate and sanitize the command
    if (command.includes('\n') || command.includes('\r')) {
      return res.json({ 
        success: false, 
        message: "Multi-line commands are not allowed",
        output: "Multi-line commands are not allowed"
      });
    }
    
    // Use single quotes to prevent most injection attacks
    const escapedCommand = command.replace(/'/g, "'\"'\"'");
    const dockerCommand = `docker exec ${containerName} /bin/sh -c '${escapedCommand}'`;
    
    const result = execSync(dockerCommand, { 
      encoding: 'utf8',
      timeout: 30000,
      maxBuffer: 1024 * 1024 // 1MB max buffer
    });
    
    console.log(`✅ Command executed successfully in ${service}`);
    res.json({ success: true, output: result, service: containerName });
    
  } catch (error: any) {
    console.error(`❌ Failed to execute command in ${service}:`, error.message);
    
    // Extract meaningful error message
    let errorMessage = error.message;
    if (error.stdout) {
      errorMessage += '\n' + error.stdout;
    }
    if (error.stderr) {
      errorMessage += '\n' + error.stderr;
    }
    
    res.json({ 
      success: false, 
      message: errorMessage,
      output: errorMessage 
    });
  }
});

// GET /api/services/status - Get status of all monitored services
app.get("/api/services/status", validateAuthHash, async (req, res) => {
  console.log(`🔍 Checking status of all services`);
  
  try {
    const services = ['yunderagithubcompiler', 'casaos', 'mesh-router'];
    const statusResults = [];
    
    for (const container of services) {
      try {
        // Check if container exists and get its status
        const result = execSync(`docker inspect --format='{{.State.Status}}' ${container}`, { 
          encoding: 'utf8',
          timeout: 10000
        });
        
        const status = result.trim();
        statusResults.push({
          container,
          status: status,
          running: status === 'running'
        });
        
      } catch (error) {
        // Container doesn't exist
        statusResults.push({
          container,
          status: 'not_found',
          running: false
        });
      }
    }
    
    console.log(`✅ Retrieved status for ${statusResults.length} services`);
    res.json({ success: true, services: statusResults });
    
  } catch (error: any) {
    console.error(`❌ Failed to get service status:`, error.message);
    res.status(500).json({ 
      success: false, 
      message: `Failed to retrieve service status: ${error.message}` 
    });
  }
});

// GET /api/services/:service/logs/stream - Stream logs in real-time using Server-Sent Events
app.get("/api/services/:service/logs/stream", validateAuthHash, async (req, res) => {
  const { service } = req.params;
  const { lines = 10 } = req.query;
  
  console.log(`📡 Starting log stream for service: ${service}`);
  
  // Set headers for Server-Sent Events
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Cache-Control');
  
  let containerName: string;
  
  // Map service names to container names
  switch (service) {
    case 'github-compiler':
      containerName = 'yunderagithubcompiler';
      break;
    case 'casaos':
      containerName = 'casaos';
      break;
    case 'mesh-router':
      containerName = 'mesh-router';
      break;
    default:
      res.write(`event: error\ndata: ${JSON.stringify({ error: `Unknown service: ${service}` })}\n\n`);
      res.end();
      return;
  }
  
  // Send initial ping
  res.write(`event: connected\ndata: ${JSON.stringify({ message: `Connected to ${service} logs` })}\n\n`);
  
  // Function to get and send recent logs
  const sendRecentLogs = () => {
    try {
      const result = execSync(`docker logs --tail ${lines} ${containerName}`, { 
        encoding: 'utf8',
        timeout: 10000,
        maxBuffer: 1024 * 1024 * 5 // 5MB max buffer
      });
      
      const logs = result.split('\n').filter(line => line.trim().length > 0);
      logs.forEach(logLine => {
        res.write(`event: log\ndata: ${JSON.stringify({ log: logLine, timestamp: new Date().toISOString() })}\n\n`);
      });
      
    } catch (error: any) {
      if (error.message.includes('No such container')) {
        res.write(`event: log\ndata: ${JSON.stringify({ log: `Container '${containerName}' not found or not running`, timestamp: new Date().toISOString() })}\n\n`);
      } else {
        res.write(`event: error\ndata: ${JSON.stringify({ error: error.message })}\n\n`);
      }
    }
  };
  
  // Send recent logs immediately
  sendRecentLogs();
  
  // Set up interval to send new logs periodically
  const logInterval = setInterval(() => {
    try {
      // Get logs from the last 2 seconds to simulate real-time
      const result = execSync(`docker logs --since 2s ${containerName}`, { 
        encoding: 'utf8',
        timeout: 5000,
        maxBuffer: 1024 * 1024 // 1MB max buffer
      });
      
      if (result.trim()) {
        const logs = result.split('\n').filter(line => line.trim().length > 0);
        logs.forEach(logLine => {
          res.write(`event: log\ndata: ${JSON.stringify({ log: logLine, timestamp: new Date().toISOString() })}\n\n`);
        });
      }
      
      // Send keep-alive ping every 30 seconds
      if (Date.now() % 30000 < 2000) {
        res.write(`event: ping\ndata: ${JSON.stringify({ timestamp: new Date().toISOString() })}\n\n`);
      }
      
    } catch (error: any) {
      // Silently handle errors in the interval
      if (!error.message.includes('No such container')) {
        console.error(`Log streaming error for ${service}:`, error.message);
      }
    }
  }, 2000); // Check for new logs every 2 seconds
  
  // Clean up when client disconnects
  req.on('close', () => {
    console.log(`📡 Log stream closed for service: ${service}`);
    clearInterval(logInterval);
  });
  
  req.on('error', (error) => {
    console.log(`📡 Log stream error for service ${service}:`, error.message);
    clearInterval(logInterval);
  });
  
  // Also clean up on response end
  res.on('close', () => {
    clearInterval(logInterval);
  });
});

// POST /api/services/autocomplete - Provide autocomplete for service terminal commands
app.post("/api/services/autocomplete", validateAuthHash, async (req, res) => {
  const { service, path: inputPath, currentDir = '/' } = req.body;
  
  if (!service) {
    return res.status(400).json({ 
      success: false, 
      message: "Service is required" 
    });
  }
  
  console.log(`🔍 Autocomplete request for service ${service}: "${inputPath}" in ${currentDir}`);
  
  try {
    let containerName: string;
    
    // Map service names to container names
    switch (service) {
      case 'github-compiler':
        containerName = 'yunderagithubcompiler';
        break;
      case 'casaos':
        containerName = 'casaos';
        break;
      case 'mesh-router':
        containerName = 'mesh-router';
        break;
      default:
        return res.status(400).json({ 
          success: false, 
          message: `Unknown service: ${service}` 
        });
    }
    
    // Handle empty path - list current directory
    const pathToSearch = inputPath || '.';
    const searchCommand = `find "${currentDir}" -maxdepth 1 -name "${pathToSearch}*" 2>/dev/null | head -20`;
    
    const result = execSync(`docker exec ${containerName} /bin/sh -c "${searchCommand}"`, { 
      encoding: 'utf8',
      timeout: 10000,
      maxBuffer: 1024 * 512 // 512KB max buffer
    });
    
    // Process results
    const files = result.split('\n')
      .filter(line => line.trim().length > 0)
      .map(fullPath => {
        const filename = fullPath.split('/').pop() || '';
        return {
          name: filename,
          path: fullPath,
          type: 'unknown' // We could add stat info here if needed
        };
      })
      .filter(item => item.name.length > 0);
    
    console.log(`✅ Found ${files.length} autocomplete matches for ${service}`);
    res.json({ success: true, completions: files });
    
  } catch (error: any) {
    console.error(`❌ Autocomplete failed for ${service}:`, error.message);
    
    // Return empty completions instead of error - autocomplete should fail silently
    res.json({ success: true, completions: [] });
  }
});

// GET /api/docker/:containerName/logs/stream - Stream logs for any Docker container
app.get("/api/docker/:containerName/logs/stream", validateAuthHash, async (req, res) => {
  const { containerName } = req.params;
  const { lines = 10 } = req.query;
  
  console.log(`📡 Starting log stream for Docker container: ${containerName}`);
  
  // Set headers for Server-Sent Events
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Cache-Control');
  
  // Validate container name (basic security check)
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(containerName)) {
    res.write(`event: error\ndata: ${JSON.stringify({ error: 'Invalid container name' })}\n\n`);
    res.end();
    return;
  }
  
  // Send initial ping
  res.write(`event: connected\ndata: ${JSON.stringify({ message: `Connected to ${containerName} logs` })}\n\n`);
  
  // Function to get and send recent logs
  const sendRecentLogs = () => {
    try {
      const result = execSync(`docker logs --tail ${lines} ${containerName}`, { 
        encoding: 'utf8',
        timeout: 10000,
        maxBuffer: 1024 * 1024 * 5 // 5MB max buffer
      });
      
      const logs = result.split('\n').filter(line => line.trim().length > 0);
      logs.forEach(logLine => {
        res.write(`event: log\ndata: ${JSON.stringify({ log: logLine, timestamp: new Date().toISOString() })}\n\n`);
      });
      
    } catch (error: any) {
      if (error.message.includes('No such container')) {
        res.write(`event: log\ndata: ${JSON.stringify({ log: `Container '${containerName}' not found or not running`, timestamp: new Date().toISOString() })}\n\n`);
      } else {
        res.write(`event: error\ndata: ${JSON.stringify({ error: error.message })}\n\n`);
      }
    }
  };
  
  // Send recent logs immediately
  sendRecentLogs();
  
  // Set up interval to send new logs periodically
  const logInterval = setInterval(() => {
    try {
      // Get logs from the last 2 seconds to simulate real-time
      const result = execSync(`docker logs --since 2s ${containerName}`, { 
        encoding: 'utf8',
        timeout: 5000,
        maxBuffer: 1024 * 1024 // 1MB max buffer
      });
      
      if (result.trim()) {
        const logs = result.split('\n').filter(line => line.trim().length > 0);
        logs.forEach(logLine => {
          res.write(`event: log\ndata: ${JSON.stringify({ log: logLine, timestamp: new Date().toISOString() })}\n\n`);
        });
      }
      
      // Send keep-alive ping every 30 seconds
      if (Date.now() % 30000 < 2000) {
        res.write(`event: ping\ndata: ${JSON.stringify({ timestamp: new Date().toISOString() })}\n\n`);
      }
      
    } catch (error: any) {
      // Silently handle errors in the interval
      if (!error.message.includes('No such container')) {
        console.error(`Log streaming error for ${containerName}:`, error.message);
      }
    }
  }, 2000); // Check for new logs every 2 seconds
  
  // Clean up when client disconnects
  req.on('close', () => {
    console.log(`📡 Log stream closed for Docker container: ${containerName}`);
    clearInterval(logInterval);
  });
  
  req.on('error', (error) => {
    console.log(`📡 Log stream error for Docker container ${containerName}:`, error.message);
    clearInterval(logInterval);
  });
  
  res.on('close', () => {
    clearInterval(logInterval);
  });
});

// POST /api/docker/execute - Execute command in any Docker container
app.post("/api/docker/execute", validateAuthHash, async (req, res) => {
  const { containerName, command } = req.body;
  
  if (!containerName || !command) {
    return res.status(400).json({ 
      success: false, 
      message: "Container name and command are required" 
    });
  }
  
  // Validate container name (basic security check)
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(containerName)) {
    return res.status(400).json({ 
      success: false, 
      message: "Invalid container name" 
    });
  }
  
  console.log(`🖥️ Executing command in Docker container ${containerName}: ${command}`);
  
  try {
    // Execute command in container with proper escaping
    if (command.includes('\n') || command.includes('\r')) {
      return res.json({ 
        success: false, 
        message: "Multi-line commands are not allowed",
        output: "Multi-line commands are not allowed"
      });
    }
    
    // Use single quotes to prevent most injection attacks
    const escapedCommand = command.replace(/'/g, "'\"'\"'");
    const dockerCommand = `docker exec ${containerName} /bin/sh -c '${escapedCommand}'`;
    
    const result = execSync(dockerCommand, { 
      encoding: 'utf8',
      timeout: 30000,
      maxBuffer: 1024 * 1024 // 1MB max buffer
    });
    
    console.log(`✅ Command executed successfully in Docker container ${containerName}`);
    res.json({ success: true, output: result, containerName });
    
  } catch (error: any) {
    console.error(`❌ Failed to execute command in Docker container ${containerName}:`, error.message);
    
    // Extract meaningful error message
    let errorMessage = error.message;
    if (error.stdout) {
      errorMessage += '\n' + error.stdout;
    }
    if (error.stderr) {
      errorMessage += '\n' + error.stderr;
    }
    
    res.json({ 
      success: false, 
      message: errorMessage,
      output: errorMessage 
    });
  }
});

// POST /api/docker/autocomplete - Provide autocomplete for Docker container terminal
app.post("/api/docker/autocomplete", validateAuthHash, async (req, res) => {
  const { containerName, path: inputPath, currentDir = '/' } = req.body;
  
  if (!containerName) {
    return res.status(400).json({ 
      success: false, 
      message: "Container name is required" 
    });
  }
  
  // Validate container name (basic security check)
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(containerName)) {
    return res.status(400).json({ 
      success: false, 
      message: "Invalid container name" 
    });
  }
  
  console.log(`🔍 Docker autocomplete request for container ${containerName}: "${inputPath}" in ${currentDir}`);
  
  try {
    // Handle empty path - list current directory
    const pathToSearch = inputPath || '.';
    const searchCommand = `find "${currentDir}" -maxdepth 1 -name "${pathToSearch}*" 2>/dev/null | head -20`;
    
    const result = execSync(`docker exec ${containerName} /bin/sh -c "${searchCommand}"`, { 
      encoding: 'utf8',
      timeout: 10000,
      maxBuffer: 1024 * 512 // 512KB max buffer
    });
    
    // Process results
    const files = result.split('\n')
      .filter(line => line.trim().length > 0)
      .map(fullPath => {
        const filename = fullPath.split('/').pop() || '';
        return {
          name: filename,
          path: fullPath,
          type: 'unknown' // We could add stat info here if needed
        };
      })
      .filter(item => item.name.length > 0);
    
    console.log(`✅ Found ${files.length} autocomplete matches for Docker container ${containerName}`);
    res.json({ success: true, completions: files });
    
  } catch (error: any) {
    console.error(`❌ Docker autocomplete failed for ${containerName}:`, error.message);
    
    // Return empty completions instead of error - autocomplete should fail silently
    res.json({ success: true, completions: [] });
  }
});

// Environment-based force update API has been removed
// Use the web UI or POST /api/repos/:id/compile for manual builds

// ===========================================
// APP-SPECIFIC SECURE API ENDPOINTS
// ===========================================
// These endpoints allow external applications to securely manage their own updates
// without requiring full AUTH_HASH admin access.
// 
// Authentication: Apps must use the X-App-Token header with their generated app token.
// Documentation: See README.md "App-Specific Secure API" section for usage examples.

// GET /api/app/check-updates - Check for updates for the authenticated app
app.get("/api/app/check-updates", validateAppTokenMiddleware, async (req, res) => {
  const appReq = req as AppAuthenticatedRequest;
  const appToken = appReq.appToken!;
  
  // Find the repository associated with this app
  const repo = managedRepos.find(r => r.id === appToken.repositoryId);
  if (!repo) {
    return res.status(404).json({
      success: false,
      message: `Repository not found for app ${appToken.appName}`
    });
  }
  
  // Check permissions
  if (!hasPermission(appToken, 'check-self-updates')) {
    return res.status(403).json({
      success: false,
      message: 'App does not have permission to check updates'
    });
  }
  
  console.log(`🔍 App ${appToken.appName} checking for updates`);
  
  // Verify repository has a URL (only GitHub repos support update checking)
  if (!repo.url) {
    return res.status(400).json({
      success: false,
      message: 'Repository does not support update checking (no URL available)'
    });
  }
  
  try {
    const updateInfo: GitUpdateInfo = await checkForUpdates(repo.url, baseDir);
    
    const response = {
      success: true,
      appName: appToken.appName,
      repositoryId: repo.id,
      currentVersion: updateInfo.currentCommit,
      latestVersion: updateInfo.latestCommit,
      hasUpdates: updateInfo.hasUpdates,
      commitsBehind: updateInfo.commitsBehind,
      lastChecked: new Date().toISOString(),
      message: !updateInfo.hasUpdates 
        ? 'App is up to date' 
        : updateInfo.commitsBehind > 0 
          ? `${updateInfo.commitsBehind} commit(s) behind`
          : 'Updates available (count unknown)'
    };
    
    console.log(`✅ Update check complete for app ${appToken.appName}: ${!updateInfo.hasUpdates ? 'up to date' : `${updateInfo.commitsBehind} behind`}`);
    res.json(response);
    
  } catch (error: any) {
    console.error(`❌ Failed to check updates for app ${appToken.appName}:`, error.message);
    res.status(500).json({
      success: false,
      message: `Failed to check updates: ${error.message}`
    });
  }
});

// POST /api/app/update - Trigger self-update for the authenticated app
app.post("/api/app/update", validateAppTokenMiddleware, async (req, res) => {
  const appReq = req as AppAuthenticatedRequest;
  const appToken = appReq.appToken!;
  
  // Find the repository associated with this app
  const repo = managedRepos.find(r => r.id === appToken.repositoryId);
  if (!repo) {
    return res.status(404).json({
      success: false,
      message: `Repository not found for app ${appToken.appName}`
    });
  }
  
  // Check permissions
  if (!hasPermission(appToken, 'update-self')) {
    return res.status(403).json({
      success: false,
      message: 'App does not have permission to update itself'
    });
  }
  
  console.log(`🔄 App ${appToken.appName} requesting self-update`);
  
  // Add to build queue
  const jobResult = await buildQueue.addJob(repo, false);
  if (!jobResult.success) {
    return res.status(500).json({
      success: false,
      message: jobResult.message
    });
  }
  
  res.json({
    success: true,
    appName: appToken.appName,
    repositoryId: repo.id,
    message: 'Update build queued successfully'
  });
  
  console.log(`✅ Self-update queued for app ${appToken.appName}`);
});

// GET /api/app/status - Get build and installation status for the authenticated app
app.get("/api/app/status", validateAppTokenMiddleware, async (req, res) => {
  const appReq = req as AppAuthenticatedRequest;
  const appToken = appReq.appToken!;
  
  // Find the repository associated with this app
  const repo = managedRepos.find(r => r.id === appToken.repositoryId);
  if (!repo) {
    return res.status(404).json({
      success: false,
      message: `Repository not found for app ${appToken.appName}`
    });
  }
  
  // Check permissions
  if (!hasPermission(appToken, 'get-self-status')) {
    return res.status(403).json({
      success: false,
      message: 'App does not have permission to check status'
    });
  }
  
  try {
    // Check build queue status
    const queueStatus = buildQueue.getQueueStatus();
    const currentJob = queueStatus.runningJobs.find((job: any) => job.repositoryId === repo.id);
    const recentJobs = buildQueue.getRecentJobs().filter((job: any) => job.repositoryId === repo.id).slice(0, 5);
    
    // Check CasaOS installation status
    let casaOSStatus = null;
    try {
      casaOSStatus = {
        installed: await isAppInstalledInCasaOS(repo.name),
        appId: repo.name
      };
    } catch (error) {
      console.warn(`⚠️ Could not check CasaOS status for app ${appToken.appName}:`, error);
    }
    
    const response = {
      success: true,
      appName: appToken.appName,
      repositoryId: repo.id,
      repository: {
        url: repo.url,
        lastBuildTime: repo.lastBuildTime,
        status: repo.status,
        currentVersion: repo.currentVersion,
        latestVersion: repo.latestVersion
      },
      buildQueue: {
        currentlyBuilding: !!currentJob,
        currentJob: currentJob ? {
          id: currentJob.id,
          repositoryName: currentJob.repositoryName,
          startTime: currentJob.startTime,
          runTime: currentJob.runTime
        } : null,
        recentJobs: recentJobs.map((job: any) => ({
          id: job.id,
          status: job.status,
          startTime: job.startTime,
          endTime: job.endTime,
          duration: job.duration
        }))
      },
      casaOS: casaOSStatus,
      lastChecked: new Date().toISOString()
    };
    
    res.json(response);
    
  } catch (error: any) {
    console.error(`❌ Failed to get status for app ${appToken.appName}:`, error.message);
    res.status(500).json({
      success: false,
      message: `Failed to get status: ${error.message}`
    });
  }
});

const port = config.webuiPort;
app.listen(port, () => {
  console.log(`🚀 UI and API listening on :${port}`);
  console.log(`   Access the installer UI at the app's root URL.`);
});
