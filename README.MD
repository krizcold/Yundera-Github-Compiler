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

## Variable Replacement in Docker Compose

The compiler automatically replaces template variables in your docker-compose.yml files:

- `$PUID` / `${PUID}` - Process user ID (default: 1000)
- `$PGID` / `${PGID}` - Process group ID (default: 1000)  
- `$APP_ID` / `${APP_ID}` - Unique app identifier
- `$REF_DOMAIN` / `${REF_DOMAIN}` - Reference domain for web access
- `$REF_SCHEME` / `${REF_SCHEME}` - Reference scheme (http/https)
- `$REF_PORT` / `${REF_PORT}` - Reference port
- `$AUTH_HASH` / `${AUTH_HASH}` - Random authentication hash (for admin access)
- `$API_HASH` / `${API_HASH}` - App-specific API token (for secure app updates)

**Important:** Apps using `$API_HASH` must be on the same Docker network as the GitHub Compiler (`pcs` network) and use `yunderagithubcompiler` as the hostname to communicate with the API.

**Complete Requirements Checklist:**
- ✅ Include `$API_HASH` in environment variables
- ✅ Use `COMPILER_API=http://yunderagithubcompiler:3000/api/app`
- ✅ Add `networks: [pcs]` to your service
- ✅ Read token from `process.env.APP_TOKEN`
- ✅ Use `X-App-Token` header for API calls

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
curl http://localhost:3000/api/repos/{repository-id}/check-updates
```

**Check for Updates (All Repositories)**
```bash
curl -X POST http://localhost:3000/api/repos/check-updates
```

**Uninstall App from CasaOS**
```bash
curl -X POST http://localhost:3000/api/repos/{repository-id}/uninstall
```

**Start/Stop App in CasaOS**
```bash
curl -X POST http://localhost:3000/api/repos/{repository-id}/toggle
```

#### Update Checking

The update checking system allows external applications to query whether repositories have new commits available without triggering a full build and deployment. This is useful for notifications, dashboards, or conditional build triggers.

**Check Single Repository for Updates**
```bash
curl http://localhost:3000/api/repos/{repository-id}/check-updates
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

### App-Specific Secure API

For security, external applications should NOT use the admin AUTH_HASH. Instead, use app-specific tokens that are automatically generated during installation.

#### Authentication
```javascript
headers: {
  'X-App-Token': 'your-app-token-here'
}
```

App tokens are automatically created when apps are installed and injected into the app's environment variables via `$API_HASH` variable replacement.

#### Step-by-Step Setup and Verification

**Step 1: Create your app's docker-compose.yml**
```yaml
version: '3.8'
services:
  myapp:
    image: myapp:latest
    environment:
      - APP_TOKEN=$API_HASH
      - COMPILER_API=http://yunderagithubcompiler:3000/api/app
    networks:
      - pcs
    restart: unless-stopped

networks:
  pcs:
    external: true
```

**Step 2: Install your app**
- The GitHub Compiler will automatically replace `$API_HASH` with your unique token

**Step 3: Verify the setup**
```bash
# Check if token was injected:
docker exec -it myapp env | grep APP_TOKEN

# Test network connectivity:
docker exec -it myapp nslookup yunderagithubcompiler

# Test API access:
docker exec -it myapp curl -H "X-App-Token: $APP_TOKEN" http://yunderagithubcompiler:3000/api/app/check-updates
```

#### Getting Your Token
Apps receive their tokens through the `$API_HASH` variable in their docker-compose.yml:

```yaml
services:
  myapp:
    environment:
      - APP_TOKEN=$API_HASH
      - COMPILER_API=http://yunderagithubcompiler:3000/api/app
```

During installation, `$API_HASH` is replaced with your app's unique token. Your application can then read it from the environment variable.

#### Network Configuration (IMPORTANT)

**Apps MUST be on the same Docker network as the GitHub Compiler to communicate.**

**Example docker-compose.yml for an app:**
```yaml
version: '3.8'
services:
  mybot:
    image: myuser/mybot:latest
    environment:
      - NODE_ENV=production
      - APP_TOKEN=$API_HASH
      - COMPILER_API=http://yunderagithubcompiler:3000/api/app
    networks:
      - pcs
    restart: unless-stopped

networks:
  pcs:
    external: true
```

**Key Points:**
- Use `yunderagithubcompiler` as the hostname (the compiler's container name)
- Both containers must be on the `pcs` network
- Port remains `3000`
- **Do NOT use IP addresses, localhost, or host.docker.internal**

**After installation, the environment becomes:**
```yaml
environment:
  - NODE_ENV=production  
  - APP_TOKEN=a1b2c3d4e5f6789...  # Your app's unique 64-char token
  - COMPILER_API=http://yunderagithubcompiler:3000/api/app
```

#### Secure API Endpoints

**Check for Updates (App-Specific)**
```bash
# From another container on the same network:
curl -H "X-App-Token: your-token" http://yunderagithubcompiler:3000/api/app/check-updates

# From the host machine:
curl -H "X-App-Token: your-token" http://localhost:3000/api/app/check-updates
```

**Trigger Self-Update**
```bash
# From another container on the same network:
curl -X POST -H "X-App-Token: your-token" http://yunderagithubcompiler:3000/api/app/update

# From the host machine:
curl -X POST -H "X-App-Token: your-token" http://localhost:3000/api/app/update
```

**Check App Status**
```bash
# From another container on the same network:
curl -H "X-App-Token: your-token" http://yunderagithubcompiler:3000/api/app/status

# From the host machine:
curl -H "X-App-Token: your-token" http://localhost:3000/api/app/status
```

#### Understanding Update Check Responses

**IMPORTANT**: When checking for updates, always use the `hasUpdates` field to determine if updates are available. Never rely solely on the `commitsBehind` value for decision making.

**Response Fields Explained:**
- `hasUpdates` (boolean): True if updates are available, false if up to date
- `commitsBehind` (number): Number of commits behind (may be 1 when count is unknown)
- `message` (string): Human-readable status message, ready for display
- `currentVersion`/`latestVersion`: Commit hashes for version tracking

**Correct Usage Pattern:**
```javascript
const response = await checkForUpdates();

if (response.hasUpdates) {
  // Updates are available
  console.log(`Updates available: ${response.message}`);
  // Safe to trigger update
} else {
  // App is up to date
  console.log('App is up to date');
  // No action needed
}
```

**Why Not Use `commitsBehind` Directly?**
- Fresh installs: Repository doesn't exist locally yet (`commitsBehind` may be 1)
- Git errors: Commit counting can fail (`commitsBehind` may be 1 as fallback)
- Up to date: Only when `hasUpdates: false` is the app truly current (`commitsBehind: 0`)

**Common Scenarios:**
```javascript
// Scenario 1: App is up to date
{
  "hasUpdates": false,
  "commitsBehind": 0,
  "message": "App is up to date"
}

// Scenario 2: Updates available with known count
{
  "hasUpdates": true, 
  "commitsBehind": 3,
  "message": "3 commit(s) behind"
}

// Scenario 3: Updates available but count unknown
{
  "hasUpdates": true,
  "commitsBehind": 1, 
  "message": "Updates available (count unknown)"
}
```

#### Auto-Update Implementation Example

```javascript
const axios = require('axios');

class AppUpdater {
  constructor() {
    // Read token from environment variable (injected via $API_HASH)
    this.appToken = process.env.APP_TOKEN;
    this.apiBase = process.env.COMPILER_API || 'http://yunderagithubcompiler:3000/api/app';
    
    if (!this.appToken) {
      throw new Error('APP_TOKEN environment variable not set. Ensure your docker-compose.yml includes $API_HASH.');
    }
  }
  
  async checkAndUpdate() {
    const hasUpdates = await this.checkForUpdates();
    if (hasUpdates) {
      await this.notifyUpdate('Update detected! Initiating self-update...');
      const success = await this.triggerSelfUpdate();
      
      if (success) {
        await this.waitForUpdateCompletion();
      }
    }
  }
  
  async checkForUpdates() {
    try {
      const response = await axios.get(`${this.apiBase}/check-updates`, {
        headers: { 'X-App-Token': this.appToken }
      });
      return response.data.success && response.data.hasUpdates;
    } catch (error) {
      console.error('Update check failed:', error.message);
      return false;
    }
  }
  
  async triggerSelfUpdate() {
    try {
      const response = await axios.post(`${this.apiBase}/update`, {}, {
        headers: { 'X-App-Token': this.appToken }
      });
      return response.data.success;
    } catch (error) {
      console.error('Update trigger failed:', error.message);
      return false;
    }
  }
  
  async waitForUpdateCompletion() {
    const maxAttempts = 20; // 10 minutes max
    let attempts = 0;
    
    while (attempts < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, 30000)); // Wait 30 seconds
      
      try {
        const response = await axios.get(`${this.apiBase}/status`, {
          headers: { 'X-App-Token': this.appToken }
        });
        
        if (response.data.success && !response.data.buildQueue.currentlyBuilding) {
          await this.notifyUpdate('Update completed! Application will restart shortly.');
          break;
        }
      } catch (error) {
        console.error('Status check failed:', error.message);
      }
      
      attempts++;
    }
  }
  
  async notifyUpdate(message) {
    // Implement your application's notification logic here
    console.log(`Update notification: ${message}`);
  }
}

// Usage Example
const updater = new AppUpdater(); // Token automatically read from environment

// Check for updates every hour
setInterval(async () => {
  await updater.checkAndUpdate();
}, 60 * 60 * 1000);

// Manual update trigger
async function manualUpdate() {
  console.log('Checking for updates...');
  await updater.checkAndUpdate();
}
```

#### Security Features
- **Scoped Access**: App tokens only work for the specific app they were created for
- **Limited Permissions**: Tokens only allow `check-self-updates`, `update-self`, and `get-self-status`
- **No Admin Access**: Apps cannot access AUTH_HASH or perform admin functions
- **Automatic Management**: Tokens created during installation, removed during uninstallation

#### Troubleshooting Network Issues

**Common Error: Connection Refused**
```
Error: connect ECONNREFUSED 192.168.x.x:3000
```

**Solution:**
1. Verify your app's docker-compose.yml includes:
   ```yaml
   networks:
     - pcs
   ```

2. Use the correct hostname:
   ```yaml
   environment:
     - COMPILER_API=http://yunderagithubcompiler:3000/api/app
   ```

3. Test connectivity from inside your container:
   ```bash
   docker exec -it your-app-container sh
   # Inside container:
   nslookup yunderagithubcompiler
   wget http://yunderagithubcompiler:3000/api/system/status
   ```

**Alternative Network Configuration:**
If the `pcs` network doesn't exist, create your own:
```yaml
networks:
  casaos_apps:
    driver: bridge

# Then use the same network in both containers
```

#### Debugging Token Issues

**1. Verify Token Injection**
Check if your app received the token:
```bash
docker exec -it your-app-container env | grep APP_TOKEN
# Should show: APP_TOKEN=a1b2c3d4e5f6789...
```

**2. Verify API Connection**
Test connectivity from your app container:
```bash
docker exec -it your-app-container sh
# Inside container:
echo $APP_TOKEN
curl -H "X-App-Token: $APP_TOKEN" http://yunderagithubcompiler:3000/api/app/check-updates
```

**3. Check Token in Storage**
Verify the token was created on the compiler side:
```bash
docker exec yunderagithubcompiler cat /app/uidata/app-tokens.json
```

**4. Check Network Configuration**
Verify both containers are on the same network:
```bash
# Check compiler network:
docker inspect yunderagithubcompiler | grep NetworkMode

# Check your app network:
docker inspect your-app-container | grep NetworkMode
```

**5. Common Token Issues:**
- **Token not injected**: `$API_HASH` wasn't in your docker-compose.yml
- **Wrong environment variable**: Using `API_ENDPOINT` instead of `COMPILER_API`
- **Network isolation**: Containers on different networks
- **Wrong hostname**: Using `localhost` instead of `yunderagithubcompiler`

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
            const response = await axios.get(`${this.baseUrl}/api/repos/${repoId}/check-updates`);
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