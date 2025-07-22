// src/config.ts
export interface AppConfig {
  casaosApiHost: string;
  casaosApiPort: string;
  webuiPort: number;
  dataRoot: string;
  diagCommand?: string;
}

/**
 * Load basic application configuration from environment variables.
 * Repository configuration is now handled by the storage system.
 */
export function loadConfig(): AppConfig {
  return {
    casaosApiHost: process.env.CASAOS_API_HOST || "localhost",
    casaosApiPort: process.env.CASAOS_API_PORT || "8080",
    webuiPort: Number(process.env.WEBUI_PORT || 3000),
    dataRoot: process.env.DATA_ROOT || "/DATA",
    diagCommand: process.env.DIAG_COMMAND
  };
}
