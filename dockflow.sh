#!/bin/bash

# Dockflow - Docker Build and Push Workflow
# Usage: ./dockflow.sh [latest|dev|both]

set -e

# Check if buildx is available and conditionally enable BuildKit
check_buildx() {
    if docker buildx version >/dev/null 2>&1; then
        echo "🔧 BuildKit enabled (buildx available)"
        export DOCKER_BUILDKIT=1
    else
        echo "⚠️ BuildKit disabled (buildx not available, using legacy builder)"
        unset DOCKER_BUILDKIT
    fi
}

# Initialize BuildKit setting
check_buildx

REPO="krizcold/yundera-github-compiler"

show_help() {
    echo "Dockflow - Docker Build and Push Workflow"
    echo ""
    echo "Usage: ./dockflow.sh [COMMAND]"
    echo ""
    echo "Commands:"
    echo "  latest    Build TypeScript, create :latest tag, and push"
    echo "  dev       Build TypeScript, create :dev tag, and push"  
    echo "  both      Build TypeScript, create both tags, and push both"
    echo "  help      Show this help message"
    echo ""
    echo "Examples:"
    echo "  ./dockflow.sh latest   # Build and push to latest"
    echo "  ./dockflow.sh dev      # Build and push to dev"
    echo "  ./dockflow.sh both     # Build and push to both latest and dev"
}

build_typescript() {
    echo "🔨 Building TypeScript..."
    npm run build
    echo "✅ TypeScript build complete"
}

build_docker() {
    local tag=$1
    echo "🐳 Building Docker image with tag: ${tag}..."
    if [ "$tag" = "latest" ]; then
        # For latest, also tag with version number
        local version=$(node scripts/version-manager.js current)
        docker build -t "${REPO}:${tag}" -t "${REPO}:${version}" .
        echo "✅ Docker build complete for tags: ${tag}, ${version}"
    else
        docker build -t "${REPO}:${tag}" .
        echo "✅ Docker build complete for tag: ${tag}"
    fi
}

push_docker() {
    local tag=$1
    echo "🚀 Pushing Docker image: ${REPO}:${tag}..."
    if [ "$tag" = "latest" ]; then
        # For latest, also push version number
        local version=$(node scripts/version-manager.js current)
        docker push "${REPO}:${tag}"
        docker push "${REPO}:${version}"
        echo "✅ Push complete for tags: ${tag}, ${version}"
    else
        docker push "${REPO}:${tag}"
        if [ "$tag" = "dev" ]; then
            node scripts/version-manager.js dev-publish
        fi
        echo "✅ Push complete for tag: ${tag}"
    fi
}

cleanup_docker() {
    echo "🧹 Cleaning up local Docker images..."
    node scripts/version-manager.js cleanup
}

case "${1:-latest}" in
    "latest")
        echo "🚢 Dockflow: Building and pushing to LATEST"
        build_typescript
        echo "📈 Incrementing version..."
        node scripts/version-manager.js increment
        build_docker "latest"
        push_docker "latest"
        cleanup_docker
        version=$(node scripts/version-manager.js current)
        echo "🎉 Dockflow complete! Images pushed to ${REPO}:latest and ${REPO}:${version}"
        ;;
    "dev")
        echo "🚢 Dockflow: Building and pushing to DEV"
        build_typescript
        build_docker "dev"
        push_docker "dev"
        cleanup_docker
        echo "🎉 Dockflow complete! Image pushed to ${REPO}:dev"
        ;;
    "both")
        echo "🚢 Dockflow: Building and pushing to BOTH latest and dev"
        build_typescript
        echo "📈 Incrementing version..."
        node scripts/version-manager.js increment
        build_docker "latest"
        build_docker "dev"
        push_docker "latest"
        push_docker "dev"
        cleanup_docker
        version=$(node scripts/version-manager.js current)
        echo "🎉 Dockflow complete! Images pushed to ${REPO}:latest, ${REPO}:${version}, and ${REPO}:dev"
        ;;
    "help"|"-h"|"--help")
        show_help
        ;;
    *)
        echo "❌ Unknown command: $1"
        echo ""
        show_help
        exit 1
        ;;
esac
