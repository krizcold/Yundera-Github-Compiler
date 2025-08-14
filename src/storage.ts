import fs from 'fs';
import path from 'path';
import { isAppLoggingEnabled } from './config';

// Storage paths
const UI_DATA_DIR = '/app/uidata';
const REPOSITORIES_FILE = path.join(UI_DATA_DIR, 'repositories.json');
const SETTINGS_FILE = path.join(UI_DATA_DIR, 'settings.json');

// Data models
export interface Repository {
  id: string;
  name: string;
  type: 'github' | 'compose';
  url?: string;
  autoUpdate: boolean;
  autoUpdateInterval: number; // minutes
  apiUpdatesEnabled: boolean;
  status: 'idle' | 'empty' | 'importing' | 'imported' | 'building' | 'success' | 'error' | 'uninstalling' | 'starting' | 'stopping' | 'installing';
  lastBuildTime?: string;
  lastUpdateCheck?: string;
  currentVersion?: string;
  latestVersion?: string;
  isInstalled?: boolean; // queried from CasaOS
  isRunning?: boolean; // running status from CasaOS
  installMismatch?: boolean; // true if marked installed but not found in CasaOS
  icon?: string; // icon URL extracted from docker-compose.yml
  lastUpdated?: string; // for backward compatibility
  hasCompose?: boolean; // for backward compatibility
}

export interface GlobalSettings {
  globalApiUpdatesEnabled: boolean;
  defaultAutoUpdateInterval: number;
  maxConcurrentBuilds: number;
  // New settings for App Store processing
  puid: string;
  pgid: string;
  refDomain: string;
  refScheme: string;
  refPort: string;
  refSeparator: string;
}

// Default settings
const DEFAULT_SETTINGS: GlobalSettings = {
  globalApiUpdatesEnabled: true,
  defaultAutoUpdateInterval: 60, // 1 hour
  maxConcurrentBuilds: 2,
  puid: "1000",
  pgid: "1000",
  refDomain: "local.casaos.io",
  refScheme: "http",
  refPort: "80",
  refSeparator: "-",
};

// Ensure UI data directory exists
function ensureUIDataDir(): void {
  if (!fs.existsSync(UI_DATA_DIR)) {
    fs.mkdirSync(UI_DATA_DIR, { recursive: true });
    console.log(`📁 Created UI data directory: ${UI_DATA_DIR}`);
  }
}

// Repository storage functions
export function loadRepositories(): Repository[] {
  ensureUIDataDir();
  
  if (!fs.existsSync(REPOSITORIES_FILE)) {
    return [];
  }
  
  try {
    const data = fs.readFileSync(REPOSITORIES_FILE, 'utf-8');
    const repos = JSON.parse(data);
    if (isAppLoggingEnabled()) {
      console.log(`📋 Loaded ${repos.length} repositories from storage`);
    }
    return repos;
  } catch (error) {
    console.error('❌ Error loading repositories:', error);
    return [];
  }
}

export function saveRepositories(repositories: Repository[]): void {
  ensureUIDataDir();
  
  try {
    fs.writeFileSync(REPOSITORIES_FILE, JSON.stringify(repositories, null, 2));
    console.log(`💾 Saved ${repositories.length} repositories to storage`);
  } catch (error) {
    console.error('❌ Error saving repositories:', error);
    throw error;
  }
}

// Settings storage functions
export function loadSettings(): GlobalSettings {
  ensureUIDataDir();
  
  let settingsFromFile: Partial<GlobalSettings> = {};
  if (fs.existsSync(SETTINGS_FILE)) {
    try {
      const data = fs.readFileSync(SETTINGS_FILE, 'utf-8');
      settingsFromFile = JSON.parse(data);
    } catch (error) {
      console.error('❌ Error loading settings.json:', error);
    }
  }

  // Dynamically load settings from environment variables, falling back to the file, then to defaults.
  // This makes the compiler automatically adapt to the host CasaOS environment.
  const finalSettings: GlobalSettings = {
    ...DEFAULT_SETTINGS,
    ...settingsFromFile,
    puid: process.env.PUID || settingsFromFile.puid || DEFAULT_SETTINGS.puid,
    pgid: process.env.PGID || settingsFromFile.pgid || DEFAULT_SETTINGS.pgid,
    refDomain: process.env.REF_DOMAIN || settingsFromFile.refDomain || DEFAULT_SETTINGS.refDomain,
    refScheme: process.env.REF_SCHEME || settingsFromFile.refScheme || DEFAULT_SETTINGS.refScheme,
    refPort: process.env.REF_PORT || settingsFromFile.refPort || DEFAULT_SETTINGS.refPort,
    refSeparator: process.env.REF_SEPARATOR || settingsFromFile.refSeparator || DEFAULT_SETTINGS.refSeparator,
  };

  console.log('⚙️ Loaded dynamic settings. Final values:', {
    puid: finalSettings.puid,
    pgid: finalSettings.pgid,
    refDomain: finalSettings.refDomain,
    refScheme: finalSettings.refScheme,
    refPort: finalSettings.refPort,
  });

  // Save the combined settings back to the file to ensure it's created on first run.
  if (!fs.existsSync(SETTINGS_FILE)) {
    saveSettings(finalSettings);
  }

  return finalSettings;
}

export function saveSettings(settings: GlobalSettings): void {
  ensureUIDataDir();
  
  try {
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
    console.log('💾 Saved global settings to storage');
  } catch (error) {
    console.error('❌ Error saving settings:', error);
    throw error;
  }
}

// Repository management functions
export function addRepository(repo: Omit<Repository, 'id'>): Repository {
  const repositories = loadRepositories();
  const newRepo: Repository = {
    ...repo,
    id: generateRepositoryId(repo.url || repo.name)
  };
  
  repositories.push(newRepo);
  saveRepositories(repositories);
  
  console.log(`➕ Added repository: ${newRepo.name} (${newRepo.id})`);
  return newRepo;
}

export function updateRepository(id: string, updates: Partial<Repository>): Repository | null {
  const repositories = loadRepositories();
  const index = repositories.findIndex(repo => repo.id === id);
  
  if (index === -1) {
    console.error(`❌ Repository not found: ${id}`);
    return null;
  }
  
  repositories[index] = { ...repositories[index], ...updates };
  saveRepositories(repositories);
  
  console.log(`✏️ Updated repository: ${repositories[index].name} (${id})`);
  return repositories[index];
}

export function removeRepository(id: string): boolean {
  const repositories = loadRepositories();
  const index = repositories.findIndex(repo => repo.id === id);
  
  if (index === -1) {
    console.error(`❌ Repository not found: ${id}`);
    return false;
  }
  
  const removedRepo = repositories.splice(index, 1)[0];
  saveRepositories(repositories);
  
  console.log(`🗑️ Removed repository: ${removedRepo.name} (${id})`);
  return true;
}

export function getRepository(id: string): Repository | null {
  const repositories = loadRepositories();
  return repositories.find(repo => repo.id === id) || null;
}

// Utility functions
function generateRepositoryId(identifier: string): string {
  // Extract repo name from URL or use identifier and create a simple ID
  const namePart = identifier.replace(/\.git$/, '').split('/').pop()?.replace(/[^a-zA-Z0-9]/g, '') || 'repo';
  const timestamp = Date.now().toString(36);
  return `${namePart}-${timestamp}`;
}
