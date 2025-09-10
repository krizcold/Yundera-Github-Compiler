#!/usr/bin/env node

const { execSync } = require('child_process');
const path = require('path');

// Check if Docker buildx is available for BuildKit support
function isBuildxAvailable() {
    try {
        execSync('docker buildx version', { stdio: 'pipe', timeout: 5000 });
        return true;
    } catch {
        return false;
    }
}

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

function buildDocker(tag) {
    const REPO = "krizcold/yundera-github-compiler";
    
    console.log(`🐳 Building Docker image with tag: ${tag}...`);
    
    try {
        if (tag === 'latest') {
            // For latest, also tag with version number
            const version = getCurrentVersion();
            
            const buildCommand = `docker build -t ${REPO}:${tag} -t ${REPO}:${version} .`;
            console.log(`Executing: ${buildCommand}`);
            
            // Only enable BuildKit if buildx is available
            const env = { ...process.env };
            if (isBuildxAvailable()) {
                env.DOCKER_BUILDKIT = '1';
                console.log('🔧 BuildKit enabled (buildx available)');
            } else {
                console.log('⚠️ BuildKit disabled (buildx not available, using legacy builder)');
            }
            
            execSync(buildCommand, { stdio: 'inherit', env });
            console.log(`✅ Docker build complete for tags: ${tag}, ${version}`);
        } else {
            const buildCommand = `docker build -t ${REPO}:${tag} .`;
            console.log(`Executing: ${buildCommand}`);
            
            // Only enable BuildKit if buildx is available
            const env = { ...process.env };
            if (isBuildxAvailable()) {
                env.DOCKER_BUILDKIT = '1';
                console.log('🔧 BuildKit enabled (buildx available)');
            } else {
                console.log('⚠️ BuildKit disabled (buildx not available, using legacy builder)');
            }
            
            execSync(buildCommand, { stdio: 'inherit', env });
            console.log(`✅ Docker build complete for tag: ${tag}`);
        }
    } catch (error) {
        console.error(`❌ Docker build failed: ${error.message}`);
        process.exit(1);
    }
}

// Get tag from command line argument, default to 'latest'
const tag = process.argv[2] || 'latest';

buildDocker(tag);