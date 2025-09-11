import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

// Storage paths
const UI_DATA_DIR = '/app/uidata';
const APP_TOKENS_FILE = path.join(UI_DATA_DIR, 'app-tokens.json');

export interface AppToken {
  appName: string;
  token: string;
  repositoryId: string;
  permissions: string[];
  createdAt: string;
  lastUsed?: string;
}

interface AppTokensStorage {
  tokens: AppToken[];
}

// Ensure UI data directory exists
function ensureUIDataDir(): void {
  if (!fs.existsSync(UI_DATA_DIR)) {
    fs.mkdirSync(UI_DATA_DIR, { recursive: true });
  }
}

// Load app tokens from storage
function loadAppTokens(): AppToken[] {
  ensureUIDataDir();
  
  if (!fs.existsSync(APP_TOKENS_FILE)) {
    return [];
  }
  
  try {
    const data = fs.readFileSync(APP_TOKENS_FILE, 'utf-8');
    const storage: AppTokensStorage = JSON.parse(data);
    return storage.tokens || [];
  } catch (error) {
    console.error('Error loading app tokens:', error);
    return [];
  }
}

// Save app tokens to storage
function saveAppTokens(tokens: AppToken[]): void {
  ensureUIDataDir();
  
  try {
    const storage: AppTokensStorage = { tokens };
    fs.writeFileSync(APP_TOKENS_FILE, JSON.stringify(storage, null, 2));
    console.log(`💾 Saved ${tokens.length} app tokens to storage`);
  } catch (error) {
    console.error('Error saving app tokens:', error);
  }
}

// Generate a secure random token
function generateToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

// Create a new app token
export function createAppToken(appName: string, repositoryId: string): AppToken {
  const tokens = loadAppTokens();
  
  // Check if token already exists for this app
  const existingToken = tokens.find(t => t.appName === appName && t.repositoryId === repositoryId);
  if (existingToken) {
    console.log(`🔑 App token already exists for ${appName}, returning existing token`);
    return existingToken;
  }
  
  const newToken: AppToken = {
    appName,
    token: generateToken(),
    repositoryId,
    permissions: ['check-self-updates', 'update-self', 'get-self-status'],
    createdAt: new Date().toISOString()
  };
  
  tokens.push(newToken);
  saveAppTokens(tokens);
  
  console.log(`🔑 Created new app token for ${appName}`);
  return newToken;
}

// Validate and return app token information
export function validateAppToken(token: string): AppToken | null {
  const tokens = loadAppTokens();
  const appToken = tokens.find(t => t.token === token);
  
  if (appToken) {
    // Update last used timestamp
    appToken.lastUsed = new Date().toISOString();
    saveAppTokens(tokens);
    console.log(`🔑 Valid app token used by ${appToken.appName}`);
  }
  
  return appToken || null;
}

// Remove app token (when app is uninstalled)
export function removeAppToken(appName: string, repositoryId: string): boolean {
  const tokens = loadAppTokens();
  const initialLength = tokens.length;
  
  const filteredTokens = tokens.filter(t => !(t.appName === appName && t.repositoryId === repositoryId));
  
  if (filteredTokens.length < initialLength) {
    saveAppTokens(filteredTokens);
    console.log(`🔑 Removed app token for ${appName}`);
    return true;
  }
  
  return false;
}

// Get all app tokens (for admin/debugging)
export function getAllAppTokens(): AppToken[] {
  return loadAppTokens();
}

// Check if token has specific permission
export function hasPermission(token: AppToken, permission: string): boolean {
  return token.permissions.includes(permission);
}