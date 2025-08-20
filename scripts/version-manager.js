#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const DOCKFLOW_JSON_PATH = path.join(__dirname, '..', 'dockflow.json');

class VersionManager {
    constructor() {
        this.dockflowData = this.loadDockflowData();
    }

    loadDockflowData() {
        try {
            const data = fs.readFileSync(DOCKFLOW_JSON_PATH, 'utf8');
            return JSON.parse(data);
        } catch (error) {
            console.error('Error loading dockflow.json:', error.message);
            process.exit(1);
        }
    }

    saveDockflowData() {
        try {
            fs.writeFileSync(DOCKFLOW_JSON_PATH, JSON.stringify(this.dockflowData, null, 2));
        } catch (error) {
            console.error('Error saving dockflow.json:', error.message);
            process.exit(1);
        }
    }

    getCurrentVersion() {
        return this.dockflowData.version;
    }

    incrementVersion() {
        const [major, minor, patch] = this.dockflowData.version.split('.').map(Number);
        const newVersion = `${major}.${minor}.${patch + 1}`;
        
        this.dockflowData.version = newVersion;
        this.dockflowData.buildCount++;
        this.dockflowData.lastPublish.latest = new Date().toISOString();

        this.saveDockflowData();
        return newVersion;
    }

    updateDevPublish() {
        this.dockflowData.lastPublish.dev = new Date().toISOString();
        this.saveDockflowData();
    }

    getDockerTags() {
        const version = this.getCurrentVersion();
        const repo = this.dockflowData.repository;
        
        return {
            latest: `${repo}:latest`,
            versioned: `${repo}:${version}`,
            dev: `${repo}:dev`
        };
    }

    showStatus() {
        console.log('📦 Dockflow Version Status');
        console.log('========================');
        console.log(`Current Version: ${this.getCurrentVersion()}`);
        console.log(`Repository: ${this.dockflowData.repository}`);
        console.log(`Build Count: ${this.dockflowData.buildCount}`);
        console.log(`Last Latest Publish: ${this.dockflowData.lastPublish.latest || 'Never'}`);
        console.log(`Last Dev Publish: ${this.dockflowData.lastPublish.dev || 'Never'}`);
        
        const tags = this.getDockerTags();
        console.log('\n🏷️ Docker Tags:');
        console.log(`  Latest: ${tags.latest}`);
        console.log(`  Versioned: ${tags.versioned}`);
        console.log(`  Dev: ${tags.dev}`);
    }

    cleanupDockerImages(tags = []) {
        const { execSync } = require('child_process');
        
        if (tags.length === 0) {
            // Default cleanup - remove all images for this repository
            const allTags = this.getDockerTags();
            tags = [allTags.latest, allTags.versioned, allTags.dev];
        }

        console.log('🧹 Cleaning up local Docker images...');
        
        for (const tag of tags) {
            try {
                // Check if image exists before trying to remove
                execSync(`docker image inspect ${tag}`, { stdio: 'ignore' });
                execSync(`docker rmi ${tag}`, { stdio: 'ignore' });
                console.log(`  ✅ Removed: ${tag}`);
            } catch (error) {
                // Image doesn't exist or couldn't be removed, skip silently
                console.log(`  ⏭️ Skipped: ${tag} (not found locally)`);
            }
        }

        // Also run docker system prune to clean up dangling images
        try {
            execSync('docker image prune -f', { stdio: 'ignore' });
            console.log('  🗑️ Cleaned up dangling images');
        } catch (error) {
            // Ignore prune errors
        }

        console.log('✅ Docker cleanup complete');
    }
}

// CLI Interface
const command = process.argv[2];
const versionManager = new VersionManager();

switch (command) {
    case 'current':
        console.log(versionManager.getCurrentVersion());
        break;
    
    case 'increment':
        const newVersion = versionManager.incrementVersion();
        console.log(`🚀 Version incremented to ${newVersion}`);
        break;
    
    case 'dev-publish':
        versionManager.updateDevPublish();
        console.log('📝 Dev publish timestamp updated');
        break;
    
    case 'tags':
        const tags = versionManager.getDockerTags();
        console.log(JSON.stringify(tags, null, 2));
        break;
    
    case 'status':
        versionManager.showStatus();
        break;
    
    case 'cleanup':
        versionManager.cleanupDockerImages();
        break;
    
    default:
        console.log('Dockflow Version Manager');
        console.log('');
        console.log('Usage: node version-manager.js [command]');
        console.log('');
        console.log('Commands:');
        console.log('  current       Show current version');
        console.log('  increment     Increment patch version');
        console.log('  dev-publish   Update dev publish timestamp');
        console.log('  tags          Show Docker tags JSON');
        console.log('  status        Show detailed status');
        console.log('  cleanup       Remove local Docker images');
        break;
}