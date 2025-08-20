# Yundera GitHub Compiler

Automatically clone, build, and deploy Docker-based projects from GitHub repositories to YUNDERA. This containerized service is specifically designed for the YUNDERA platform and integrates directly with YUNDERA's infrastructure to monitor configured repositories and install them as YUNDERA applications with a complete API for external integration.

## Features

- **Automatic GitHub Integration**: Clone and monitor repositories for updates
- **Docker Build System**: Build Docker images from source code
- **YUNDERA Deployment**: Seamless installation to YUNDERA via API
- **Web Management UI**: Modern interface for repository management
- **Build Queue System**: Concurrent build processing with status tracking
- **REST API**: Complete API for external application integration
- **Auto-Update System**: Configurable automatic updates per repository
- **Smart Loading System**: Prevents access to broken UI during initial setup

## Quick Start

### Docker Compose

```yaml
version: '3.8'
services:
  yundera-compiler:
    image: yundera/github-compiler:latest
    ports:
      - "3000:3000"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - yundera-data:/app/uidata
    environment:
      - WEBUI_PORT=3000
      - CASAOS_API_HOST=localhost
      - CASAOS_API_PORT=8080
    restart: unless-stopped

volumes:
  yundera-data:
```

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `WEBUI_PORT` | `3000` | Web UI and API port |
| `CASAOS_API_HOST` | `localhost` | YUNDERA API hostname |
| `CASAOS_API_PORT` | `8080` | YUNDERA API port |
| `DATA_ROOT` | `/DATA` | Data storage root path |
| `DIAG_COMMAND` | - | Optional diagnostic command |

## API Integration for External Apps

The Yundera compiler provides a comprehensive REST API that other applications can use to trigger builds, monitor status, and manage repositories.

### Base URL
```
http://localhost:3000
```

### API Endpoints

#### Repository Management

**Add Repository**
```bash
curl -X POST http://localhost:3000/api/repos \
  -H "Content-Type: application/json" \
  -d '{
    "name": "my-app",
    "url": "https://github.com/user/repository.git", 
    "autoUpdate": true,
    "autoUpdateInterval": 60,
    "apiUpdatesEnabled": true
  }'
```

**Trigger Build/Update**
```bash
curl -X POST http://localhost:3000/api/repos/{repository-id}/compile
```

**Get Repository Status**
```bash
curl http://localhost:3000/api/repos
```

**Check for Updates (Single Repository)**
```bash
curl http://localhost:3000/api/repos/{repository-id}/check-update
```

**Check for Updates (All Repositories)**
```bash
curl -X POST http://localhost:3000/api/repos/check-updates
```

#### Update Checking

The update checking system allows external applications to query whether repositories have new commits available without triggering a full build and deployment. This is useful for notifications, dashboards, or conditional build triggers.

**Check Single Repository for Updates**
```bash
curl http://localhost:3000/api/repos/{repository-id}/check-update
```

Response format:
```json
{
  "success": true,
  "repository": {
    "id": "my-app-abc123",
    "name": "my-app",
    "url": "https://github.com/user/my-app.git"
  },
  "updateInfo": {
    "hasUpdates": true,
    "currentCommit": "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0",
    "latestCommit": "z9y8x7w6v5u4t3s2r1q0p9o8n7m6l5k4j3i2h1g0",
    "currentVersion": "a1b2c3d4",
    "latestVersion": "z9y8x7w6",
    "commitsBehind": 5,
    "lastChecked": "2024-01-15T10:30:00.000Z",
    "error": null
  }
}
```

**Check All Repositories for Updates**
```bash
curl -X POST http://localhost:3000/api/repos/check-updates
```

Response format:
```json
{
  "success": true,
  "message": "Update check completed. 2 repositories have updates available.",
  "summary": {
    "totalChecked": 5,
    "withUpdates": 2,
    "lastChecked": "2024-01-15T10:30:00.000Z"
  },
  "repositories": [
    {
      "repository": {
        "id": "app1-abc123",
        "name": "app1",
        "url": "https://github.com/user/app1.git"
      },
      "updateInfo": {
        "hasUpdates": true,
        "currentVersion": "a1b2c3d4",
        "latestVersion": "z9y8x7w6",
        "commitsBehind": 3
      }
    }
  ]
}
```

#### Build Queue Monitoring

**Check Build Queue Status**
```bash
curl http://localhost:3000/api/build-queue/status
```

**Check System Readiness**
```bash
curl http://localhost:3000/api/system/ready
```

**Get Build History**
```bash
curl http://localhost:3000/api/build-queue/history
```

#### Direct Installation

**Install Docker Compose YAML Directly**
```bash
curl -X POST http://localhost:3000/install-via-proxy \
  -H "Content-Type: application/json" \
  -d '{"yaml": "version: '\''3.8'\''\nservices:\n  app:\n    image: nginx"}'
```

### Integration Script Example

Here's a complete script example for integrating with the Yundera compiler:

```bash
#!/bin/bash

YUNDERA_API="http://localhost:3000"
REPO_URL="https://github.com/user/my-app.git"
APP_NAME="my-app"

# Function to check if Yundera is running
check_yundera() {
    curl -s "$YUNDERA_API/api/system/status" > /dev/null
    return $?
}

# Function to add repository
add_repo() {
    echo "Adding repository: $APP_NAME"
    curl -X POST "$YUNDERA_API/api/repos" \
        -H "Content-Type: application/json" \
        -d "{
            \"name\": \"$APP_NAME\",
            \"url\": \"$REPO_URL\",
            \"autoUpdate\": true,
            \"autoUpdateInterval\": 60,
            \"apiUpdatesEnabled\": true
        }"
}

# Function to trigger build
trigger_build() {
    local repo_id=$1
    echo "Triggering build for repository: $repo_id"
    curl -X POST "$YUNDERA_API/api/repos/$repo_id/compile"
}

# Function to monitor build status
monitor_build() {
    echo "Monitoring build status..."
    while true; do
        status=$(curl -s "$YUNDERA_API/api/build-queue/status" | jq -r '.data.running')
        if [ "$status" = "0" ]; then
            echo "Build completed!"
            break
        fi
        echo "Build in progress... (Running: $status)"
        sleep 10
    done
}

# Main execution
if check_yundera; then
    echo "Yundera compiler is running"
    
    # Get list of repos to find existing one or add new
    repos=$(curl -s "$YUNDERA_API/api/repos")
    repo_id=$(echo "$repos" | jq -r ".repos[] | select(.name==\"$APP_NAME\") | .id")
    
    if [ "$repo_id" = "null" ] || [ -z "$repo_id" ]; then
        echo "Repository not found, adding..."
        response=$(add_repo)
        repo_id=$(echo "$response" | jq -r '.repo.id')
    fi
    
    echo "Repository ID: $repo_id"
    trigger_build "$repo_id"
    monitor_build
    
    echo "Deployment completed! Check YUNDERA dashboard."
else
    echo "Error: Yundera compiler is not running on $YUNDERA_API"
    exit 1
fi
```

### JavaScript/Node.js Integration

```javascript
const axios = require('axios');

class YunderaClient {
    constructor(baseUrl = 'http://localhost:3000') {
        this.baseUrl = baseUrl;
    }

    async addRepository(config) {
        try {
            const response = await axios.post(`${this.baseUrl}/api/repos`, config);
            return response.data;
        } catch (error) {
            throw new Error(`Failed to add repository: ${error.message}`);
        }
    }

    async triggerBuild(repoId) {
        try {
            const response = await axios.post(`${this.baseUrl}/api/repos/${repoId}/compile`);
            return response.data;
        } catch (error) {
            throw new Error(`Failed to trigger build: ${error.message}`);
        }
    }

    async getBuildStatus() {
        try {
            const response = await axios.get(`${this.baseUrl}/api/build-queue/status`);
            return response.data;
        } catch (error) {
            throw new Error(`Failed to get build status: ${error.message}`);
        }
    }

    async checkForUpdates(repoId) {
        try {
            const response = await axios.get(`${this.baseUrl}/api/repos/${repoId}/check-update`);
            return response.data;
        } catch (error) {
            throw new Error(`Failed to check for updates: ${error.message}`);
        }
    }

    async checkAllForUpdates() {
        try {
            const response = await axios.post(`${this.baseUrl}/api/repos/check-updates`);
            return response.data;
        } catch (error) {
            throw new Error(`Failed to check all for updates: ${error.message}`);
        }
    }

    async waitForBuild(repoId, timeout = 300000) {
        const startTime = Date.now();
        
        while (Date.now() - startTime < timeout) {
            const status = await this.getBuildStatus();
            const isBuilding = status.data.runningJobs.some(job => 
                job.repositoryId === repoId
            );
            
            if (!isBuilding) {
                return true; // Build completed
            }
            
            await new Promise(resolve => setTimeout(resolve, 5000));
        }
        
        throw new Error('Build timeout');
    }
}

// Usage example - Deploy app
async function deployApp() {
    const client = new YunderaClient();
    
    try {
        // Add repository
        const repo = await client.addRepository({
            name: 'my-app',
            url: 'https://github.com/user/my-app.git',
            autoUpdate: true,
            autoUpdateInterval: 60,
            apiUpdatesEnabled: true
        });
        
        // Trigger build
        await client.triggerBuild(repo.repo.id);
        
        // Wait for completion
        await client.waitForBuild(repo.repo.id);
        
        console.log('Deployment completed successfully!');
    } catch (error) {
        console.error('Deployment failed:', error.message);
    }
}

// Usage example - Check for updates before building
async function smartDeploy() {
    const client = new YunderaClient();
    
    try {
        // Check if updates are available for all repositories
        const updateCheck = await client.checkAllForUpdates();
        console.log(`Found ${updateCheck.summary.withUpdates} repositories with updates`);
        
        // Deploy only repositories that have updates
        for (const repo of updateCheck.repositories) {
            if (repo.updateInfo.hasUpdates) {
                console.log(`Deploying ${repo.repository.name} - ${repo.updateInfo.commitsBehind} commits behind`);
                await client.triggerBuild(repo.repository.id);
                await client.waitForBuild(repo.repository.id);
                console.log(`✅ ${repo.repository.name} updated successfully`);
            } else {
                console.log(`⏭️ ${repo.repository.name} is up to date, skipping`);
            }
        }
        
        console.log('Smart deployment completed!');
    } catch (error) {
        console.error('Smart deployment failed:', error.message);
    }
}
```

## Architecture

### Core Components

- **Express API Server** (`src/index.ts`): REST API and web UI serving
- **Git Handler** (`src/GitHandler.ts`): Repository cloning and updates
- **Docker Handler** (`src/DockerHandler.ts`): Docker image building and YUNDERA integration
- **Build Queue** (`src/build-queue.ts`): Concurrent build job management
- **Storage System** (`src/storage.ts`): Persistent data management
- **YUNDERA Installer** (`src/CasaOSInstaller.ts`): Direct YUNDERA API integration

### Workflow

1. **Repository Configuration**: Add GitHub repositories via API or web UI
2. **Git Operations**: Clone/pull repository source code
3. **Docker Build**: Build Docker images from source
4. **YUNDERA Integration**: Transform docker-compose.yml and install via YUNDERA API
5. **Status Tracking**: Monitor installation and update repository status

### YUNDERA Integration

The system integrates directly with YUNDERA by executing curl commands from within the YUNDERA container:

```bash
docker exec casaos sh -c "curl -X POST 'http://localhost:8080/v2/app_management/compose' ..."
```

This allows seamless installation to your YUNDERA service without requiring authentication tokens.

## Web UI

Access the management interface at `http://localhost:3000` for:

- Repository management (add/edit/delete)
- Manual build triggers
- Build queue monitoring
- Docker Compose YAML editing
- System status monitoring
- Global settings configuration

### Smart Loading System

The application features an intelligent loading system that ensures users never see a broken interface during initial setup:

**First Installation Behavior:**
- Shows a beautiful loading screen when Docker integration isn't ready
- Automatically polls system status every 2 seconds
- Seamlessly transitions to the main UI once setup is complete
- Provides real-time status updates and progress indication

**Automatic Recovery:**
- If Docker socket mounting fails, the app automatically restarts after 2 minutes
- The pre-install script has enhanced timing (2-minute timeout with 2-second checks)
- Multiple retry attempts ensure successful Docker integration

**User Experience:**
- No more accessing broken UI during setup
- Clear visual feedback on setup progress
- Automatic redirect when system is ready
- Professional loading interface with status updates

This ensures that users always have a smooth experience, especially during the critical first-launch period.

## Data Persistence

- **Location**: `/app/uidata/` (mount as volume)
- **Files**: 
  - `repositories.json` - Repository configurations
  - `settings.json` - Global settings
- **Auto-sync**: Configuration reloads every 30 seconds

## Version Management

The project uses `dockflow.json` for automatic semantic versioning:

- **Current System**: Starts at `1.0.0` and auto-increments patch version (1.0.1, 1.0.2, etc.)
- **Automatic Incrementing**: Happens on `latest` and `both` publishes
- **Docker Tags**: Creates both `:latest` and `:1.x.x` version tags
- **Dev Builds**: Uses `:dev` tag without version incrementing
- **Tracking**: Maintains build count and publish timestamps

**dockflow.json Structure:**
```json
{
  "version": "1.0.0",
  "repository": "krizcold/yundera-github-compiler",
  "lastPublish": {
    "latest": "2024-08-15T...",
    "dev": "2024-08-15T..."
  },
  "buildCount": 5
}
```

## Requirements

- Docker with docker.sock access
- YUNDERA service running
- Node.js 18+ (for development)
- TypeScript (for development)

## Development

```bash
# Install dependencies
npm install

# Development mode
npm run dev

# Build
npm run build

# Production
npm start
```

### Docker Workflow Commands (Dockflow)

**One-Command Build & Push:**
```bash
# Build TypeScript + Docker + auto-increment version + push to :latest and :1.x.x + cleanup
npm run dockflow:latest

# Build TypeScript + Docker + push to :dev (no version increment) + cleanup
npm run dockflow:dev

# Build TypeScript + Docker + auto-increment version + push to :latest, :1.x.x, and :dev + cleanup
npm run dockflow:both
```

**Version Management:**
```bash
# Show current version
npm run version:current

# Show detailed version status
npm run version:status

# Manual version increment (not needed - automatic on latest/both)
npm run version:increment

# Clean up local Docker images (automatic after dockflow)
npm run docker:cleanup
```

**Individual Docker Operations:**
```bash
# Build Docker image with :latest tag
npm run docker:build

# Build Docker image with :dev tag
npm run docker:build-dev

# Push :latest tag to krizcold/yundera-github-compiler
npm run docker:push

# Push :dev tag to krizcold/yundera-github-compiler
npm run docker:push-dev
```

**Alternative Shell Script:**
```bash
# Shell script alternative to npm commands
./dockflow.sh latest|dev|both
```

## API Response Formats

### Repository Object
```json
{
  "id": "string",
  "name": "string",
  "url": "string", 
  "autoUpdate": boolean,
  "autoUpdateInterval": number,
  "apiUpdatesEnabled": boolean,
  "status": "idle|building|success|error",
  "lastBuildTime": "ISO-8601 timestamp",
  "isInstalled": boolean
}
```

### Build Status Response
```json
{
  "success": true,
  "data": {
    "maxConcurrent": 2,
    "running": 1,
    "queued": 0,
    "queuedJobs": [],
    "runningJobs": [
      {
        "id": "string",
        "repositoryName": "string",
        "repositoryId": "string", 
        "startTime": 1640995200000,
        "runTime": 30000
      }
    ]
  }
}
```

## License

MIT License - see LICENSE file for details.