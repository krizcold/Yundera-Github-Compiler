import fs from 'fs';
import path from 'path';

// Storage paths
const UI_DATA_DIR = '/app/uidata';
const REPOSITORIES_FILE = path.join(UI_DATA_DIR, 'repositories.json');
const SETTINGS_FILE = path.join(UI_DATA_DIR, 'settings.json');

// Data models
export interface Repository {
  id: string;
  name: string;
  url: string;
  autoUpdate: boolean;
  autoUpdateInterval: number; // minutes
  apiUpdatesEnabled: boolean;
  status: 'idle' | 'building' | 'success' | 'error';
  lastBuildTime?: string;
  lastUpdateCheck?: string;
  currentVersion?: string;
  latestVersion?: string;
  isInstalled?: boolean; // queried from CasaOS
  lastUpdated?: string; // for backward compatibility
  hasCompose?: boolean; // for backward compatibility
}

export interface GlobalSettings {
  globalApiUpdatesEnabled: boolean;
  defaultAutoUpdateInterval: number;
  maxConcurrentBuilds: number;
}

// Default settings
const DEFAULT_SETTINGS: GlobalSettings = {
  globalApiUpdatesEnabled: true,
  defaultAutoUpdateInterval: 60, // 1 hour
  maxConcurrentBuilds: 2
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
    console.log(`📋 Loaded ${repos.length} repositories from storage`);
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
  
  if (!fs.existsSync(SETTINGS_FILE)) {
    saveSettings(DEFAULT_SETTINGS);
    return DEFAULT_SETTINGS;
  }
  
  try {
    const data = fs.readFileSync(SETTINGS_FILE, 'utf-8');
    const settings = { ...DEFAULT_SETTINGS, ...JSON.parse(data) };
    console.log('⚙️ Loaded global settings from storage');
    return settings;
  } catch (error) {
    console.error('❌ Error loading settings:', error);
    return DEFAULT_SETTINGS;
  }
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
    id: generateRepositoryId(repo.url),
    status: 'idle'
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
function generateRepositoryId(url: string): string {
  // Extract repo name from URL and create a simple ID
  const urlParts = url.replace(/\.git$/, '').split('/');
  const repoName = urlParts[urlParts.length - 1];
  const timestamp = Date.now().toString(36);
  return `${repoName}-${timestamp}`;
}