#!/usr/bin/env node

const { execSync } = require('child_process');
const path = require('path');

function getCurrentVersion() {
    try {
        const versionManagerPath = path.join(__dirname, 'version-manager.js');
        const version = execSync(`node ${versionManagerPath} current`, { encoding: 'utf8' }).trim();
        return version;
    } catch (error) {
        console.error(`❌ Failed to get current version: ${error.message}`);
        process.exit(1);
    }
}

function pushDocker(tag) {
    const REPO = "krizcold/yundera-github-compiler";
    
    console.log(`🚀 Pushing Docker image: ${REPO}:${tag}...`);
    
    try {
        if (tag === 'latest') {
            // For latest, also push version number
            const version = getCurrentVersion();
            
            // Push both tags
            const pushLatestCommand = `docker push ${REPO}:${tag}`;
            const pushVersionCommand = `docker push ${REPO}:${version}`;
            
            console.log(`Executing: ${pushLatestCommand}`);
            execSync(pushLatestCommand, { stdio: 'inherit' });
            
            console.log(`Executing: ${pushVersionCommand}`);
            execSync(pushVersionCommand, { stdio: 'inherit' });
            
            console.log(`✅ Push complete for tags: ${tag}, ${version}`);
        } else {
            const pushCommand = `docker push ${REPO}:${tag}`;
            console.log(`Executing: ${pushCommand}`);
            
            execSync(pushCommand, { stdio: 'inherit' });
            
            if (tag === 'dev') {
                // Update dev publish timestamp
                const versionManagerPath = path.join(__dirname, 'version-manager.js');
                execSync(`node ${versionManagerPath} dev-publish`, { stdio: 'inherit' });
            }
            
            console.log(`✅ Push complete for tag: ${tag}`);
        }
    } catch (error) {
        console.error(`❌ Docker push failed: ${error.message}`);
        process.exit(1);
    }
}

// Get tag from command line argument, default to 'latest'
const tag = process.argv[2] || 'latest';

pushDocker(tag);