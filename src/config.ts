// src/config.ts
// Following the settings app configuration pattern

export interface BaseConfig {
  // Base configuration properties (can be extended later)
}

export interface Config extends BaseConfig {
  // Core application settings
  WEBUI_PORT: string;
  CASAOS_API_HOST: string;
  CASAOS_API_PORT: string;
  DATA_ROOT: string;
  DIAG_COMMAND: string;

  // Yundera platform integration (matching settings app - may be used by platform)
  DOMAIN: string;
  PROVIDER_STR: string;
  UID: string;
  DEFAULT_PWD: string;
  PUBLIC_IP: string;
  DEFAULT_USER: string;

  // Authentication and paths (following settings app pattern - may be used by platform)
  JWT_SECRET: string;
  AUTHORITY_ENDPOINT: string;
  COMPOSE_FOLDER_PATH: string;
  BASE_PATH: string;
  MOCK: string;

  // CasaOS reference settings
  PUID: string;
  PGID: string;
  REF_DOMAIN: string;
  REF_SCHEME: string;
  REF_PORT: string;
  REF_SEPARATOR: string;
  
  // Debug/logging settings
  LOG_APPS_BEACON: string;
}

/**
 * Get configuration value by key, following settings app pattern
 */
export function getConfig(key: keyof Config): string {
  const value = process.env[key];
  return value || '';
}

/**
 * Check if app logging beacon is enabled
 */
export function isAppLoggingEnabled(): boolean {
  const value = getConfig('LOG_APPS_BEACON');
  return value.toLowerCase() === 'true' || value === '1';
}

/**
 * Legacy configuration interface for backward compatibility
 */
export interface AppConfig {
  casaosApiHost: string;
  casaosApiPort: string;
  webuiPort: number;
  dataRoot: string;
  diagCommand?: string;
  hostAddress?: string;
}

/**
 * Load basic application configuration from environment variables.
 * Repository configuration is now handled by the storage system.
 * @deprecated Use getConfig() instead for new code
 */
export function loadConfig(): AppConfig {
  return {
    casaosApiHost: getConfig('CASAOS_API_HOST') || "localhost",
    casaosApiPort: getConfig('CASAOS_API_PORT') || "8080",
    webuiPort: Number(getConfig('WEBUI_PORT')) || 3000,
    dataRoot: getConfig('DATA_ROOT') || "/DATA",
    diagCommand: getConfig('DIAG_COMMAND') || undefined,
    hostAddress: process.env.HOST_ADDRESS || undefined
  };
}
