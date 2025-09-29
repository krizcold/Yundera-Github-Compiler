import * as yaml from 'js-yaml';

/**
 * Intelligent docker-compose comparison that ignores environment variable values
 * and focuses on structural changes. This mirrors the frontend logic.
 */
export function compareDockerComposeStructure(currentCompose: string, newCompose: string): boolean {
    try {
        // If they're identical, no changes
        if (currentCompose === newCompose) {
            return false;
        }

        // Load YAML with string schema to prevent number precision loss
        const loadOptions = { schema: yaml.FAILSAFE_SCHEMA };
        const currentConfig = yaml.load(currentCompose, loadOptions);
        const newConfig = yaml.load(newCompose, loadOptions);

        // Normalize both configurations (replace env values with placeholders)
        const normalizedCurrent = normalizeDockerComposeForComparison(currentConfig);
        const normalizedNew = normalizeDockerComposeForComparison(newConfig);

        // Compare the normalized structures
        const currentNormalizedYaml = yaml.dump(normalizedCurrent, { indent: 2, lineWidth: 120 });
        const newNormalizedYaml = yaml.dump(normalizedNew, { indent: 2, lineWidth: 120 });

        const hasChanges = currentNormalizedYaml !== newNormalizedYaml;

        if (hasChanges) {
            console.log('🔍 ANALYSIS: Structural changes detected in docker-compose.yml');
        } else {
            console.log('🔍 ANALYSIS: Only environment variable values differ, no structural changes');
        }

        return hasChanges;

    } catch (error: any) {
        console.warn('Error in smart docker-compose comparison:', error.message);
        // Fallback to string comparison if YAML parsing fails
        return currentCompose !== newCompose;
    }
}

/**
 * Normalize docker-compose for comparison by replacing env values with placeholders
 */
function normalizeDockerComposeForComparison(config: any): any {
    if (!config || typeof config !== 'object') {
        return config;
    }

    // Deep clone the config to avoid modifying the original
    const normalized = JSON.parse(JSON.stringify(config));

    // Recursively normalize the structure
    normalizeEnvironmentValues(normalized);

    return normalized;
}

/**
 * Recursively find and normalize environment variable values
 */
function normalizeEnvironmentValues(obj: any): void {
    if (!obj || typeof obj !== 'object') {
        return;
    }

    for (const key in obj) {
        if (key === 'environment' && obj[key]) {
            // Handle environment section
            if (Array.isArray(obj[key])) {
                // Array format: ["KEY=value", "KEY2=value2"]
                obj[key] = obj[key].map((envVar: any) => {
                    if (typeof envVar === 'string' && envVar.includes('=')) {
                        const [envKey] = envVar.split('=', 1);
                        return `${envKey}=<PLACEHOLDER>`;
                    }
                    return envVar;
                });
            } else if (typeof obj[key] === 'object') {
                // Object format: {KEY: "value", KEY2: "value2"}
                for (const envKey in obj[key]) {
                    obj[key][envKey] = '<PLACEHOLDER>';
                }
            }
        } else if (typeof obj[key] === 'object') {
            // Recursively process nested objects
            normalizeEnvironmentValues(obj[key]);
        }
    }
}