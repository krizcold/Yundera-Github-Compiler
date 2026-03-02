import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { StoreConfig } from './storage';

// --- Interfaces ---

export interface DockerImageRef {
  service: string;
  fullRef: string;
  registry: string;
  repository: string;
  currentTag: string;
  latestTag?: string;
  versionStatus?: 'up-to-date' | 'update-available' | 'latest-tag' | 'unknown';
}

export interface StoreApp {
  name: string;
  storeId: string;
  storeName: string;
  icon?: string;
  description?: string;
  category?: string;
  developer?: string;
  images: DockerImageRef[];
  composeRaw: string;
}

interface StoreCache {
  storeId: string;
  fetchedAt: string;
  apps: StoreApp[];
}

interface RegistryCacheEntry {
  repository: string;
  registry: string;
  tags: string[];
  fetchedAt: string;
}

// --- Constants ---

const UI_DATA_DIR = '/app/uidata';
const STORE_CACHE_FILE = path.join(UI_DATA_DIR, 'store-cache.json');
const REGISTRY_CACHE_FILE = path.join(UI_DATA_DIR, 'registry-cache.json');
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

// --- Image reference parsing ---

export function parseImageRef(imageString: string, serviceName: string): DockerImageRef {
  let registry = 'docker.io';
  let repository: string;
  let tag = 'latest';

  // Strip @sha256: digest if present (e.g. "image:tag@sha256:abc123")
  let cleanedImage = imageString;
  const digestIdx = cleanedImage.indexOf('@sha256:');
  if (digestIdx > 0) {
    cleanedImage = cleanedImage.substring(0, digestIdx);
  }

  // Split off tag (last : that doesn't contain /)
  let imagePart = cleanedImage;
  const lastColon = cleanedImage.lastIndexOf(':');
  if (lastColon > 0) {
    const afterColon = cleanedImage.substring(lastColon + 1);
    // If after colon contains /, it's part of the registry/repo, not a tag
    if (!afterColon.includes('/')) {
      tag = afterColon;
      imagePart = cleanedImage.substring(0, lastColon);
    }
  }

  // Determine registry
  const parts = imagePart.split('/');
  if (parts.length >= 2 && (parts[0].includes('.') || parts[0].includes(':'))) {
    // Custom registry (contains dot or port)
    registry = parts[0];
    repository = parts.slice(1).join('/');
  } else if (parts.length === 1) {
    // Official Docker Hub image (e.g. "nginx")
    registry = 'docker.io';
    repository = 'library/' + parts[0];
  } else {
    // Docker Hub user image (e.g. "user/repo")
    registry = 'docker.io';
    repository = imagePart;
  }

  return {
    service: serviceName,
    fullRef: imageString,
    registry,
    repository,
    currentTag: tag,
  };
}

// --- Caching ---

function loadStoreCache(): StoreCache[] {
  try {
    if (fs.existsSync(STORE_CACHE_FILE)) {
      return JSON.parse(fs.readFileSync(STORE_CACHE_FILE, 'utf-8'));
    }
  } catch (e) {
    console.error('Failed to load store cache:', e);
  }
  return [];
}

function saveStoreCache(caches: StoreCache[]): void {
  try {
    fs.writeFileSync(STORE_CACHE_FILE, JSON.stringify(caches, null, 2));
  } catch (e) {
    console.error('Failed to save store cache:', e);
  }
}

function loadRegistryCache(): RegistryCacheEntry[] {
  try {
    if (fs.existsSync(REGISTRY_CACHE_FILE)) {
      return JSON.parse(fs.readFileSync(REGISTRY_CACHE_FILE, 'utf-8'));
    }
  } catch (e) {
    console.error('Failed to load registry cache:', e);
  }
  return [];
}

function saveRegistryCache(entries: RegistryCacheEntry[]): void {
  try {
    fs.writeFileSync(REGISTRY_CACHE_FILE, JSON.stringify(entries, null, 2));
  } catch (e) {
    console.error('Failed to save registry cache:', e);
  }
}

function isCacheValid(fetchedAt: string): boolean {
  return (Date.now() - new Date(fetchedAt).getTime()) < CACHE_TTL_MS;
}

export function clearStoreCache(storeId: string): void {
  const caches = loadStoreCache();
  const filtered = caches.filter(c => c.storeId !== storeId);
  saveStoreCache(filtered);
}

export function clearRegistryCache(): void {
  saveRegistryCache([]);
  console.log('🗑️ Registry cache cleared');
}

// --- GitHub API helpers ---

export function parseGitHubUrl(repoUrl: string): { owner: string; repo: string } | null {
  try {
    const url = new URL(repoUrl);
    const parts = url.pathname.replace(/^\//, '').replace(/\.git$/, '').split('/');
    if (parts.length >= 2) {
      return { owner: parts[0], repo: parts[1] };
    }
  } catch {
    // Try pattern match
    const match = repoUrl.match(/github\.com[/:]([^/]+)\/([^/.]+)/);
    if (match) return { owner: match[1], repo: match[2] };
  }
  return null;
}

// --- Fetch store apps ---

export async function fetchStoreApps(storeConfig: StoreConfig, refresh: boolean = false): Promise<StoreApp[]> {
  // Check cache first
  if (!refresh) {
    const caches = loadStoreCache();
    const cached = caches.find(c => c.storeId === storeConfig.id);
    if (cached && isCacheValid(cached.fetchedAt)) {
      console.log(`📦 Using cached store data for ${storeConfig.name}`);
      return cached.apps;
    }
  }

  const parsed = parseGitHubUrl(storeConfig.repoUrl);
  if (!parsed) {
    throw new Error(`Invalid GitHub URL: ${storeConfig.repoUrl}`);
  }

  const { owner, repo } = parsed;
  const appsPath = storeConfig.appsPath || 'Apps';

  console.log(`📦 Fetching apps from ${owner}/${repo}/${appsPath}...`);

  // List directories in Apps folder
  const listUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${appsPath}`;
  const listResponse = await axios.get(listUrl, {
    headers: { 'Accept': 'application/vnd.github.v3+json', 'User-Agent': 'Yundera-Store-Tracker' },
    timeout: 15000,
  });

  const directories = listResponse.data.filter((item: any) => item.type === 'dir');
  console.log(`📂 Found ${directories.length} app directories`);

  // Fetch docker-compose.yml for each directory (5 at a time)
  const apps: StoreApp[] = [];
  const batchSize = 5;

  for (let i = 0; i < directories.length; i += batchSize) {
    const batch = directories.slice(i, i + batchSize);
    const promises = batch.map(async (dir: any) => {
      try {
        const composeUrl = `https://raw.githubusercontent.com/${owner}/${repo}/main/${appsPath}/${dir.name}/docker-compose.yml`;
        const composeResp = await axios.get(composeUrl, { timeout: 10000 });
        const composeRaw = composeResp.data;

        return parseComposeToStoreApp(dir.name, composeRaw, storeConfig);
      } catch (err: any) {
        console.warn(`⚠️ Failed to fetch compose for ${dir.name}: ${err.message}`);
        return null;
      }
    });

    const results = await Promise.all(promises);
    for (const result of results) {
      if (result) apps.push(result);
    }
  }

  // Save to cache
  const caches = loadStoreCache();
  const existingIdx = caches.findIndex(c => c.storeId === storeConfig.id);
  const cacheEntry: StoreCache = {
    storeId: storeConfig.id,
    fetchedAt: new Date().toISOString(),
    apps,
  };

  if (existingIdx >= 0) {
    caches[existingIdx] = cacheEntry;
  } else {
    caches.push(cacheEntry);
  }
  saveStoreCache(caches);

  console.log(`✅ Fetched ${apps.length} apps from ${storeConfig.name}`);
  return apps;
}

function parseComposeToStoreApp(dirName: string, composeRaw: string, storeConfig: StoreConfig): StoreApp | null {
  try {
    // Use js-yaml for YAML parsing (available as dependency)
    const yaml = require('js-yaml');
    const compose = yaml.load(composeRaw);
    if (!compose || typeof compose !== 'object') return null;

    const casaos = compose['x-casaos'] || {};
    const services = compose.services || {};

    // Extract image references from all services
    const images: DockerImageRef[] = [];
    for (const [svcName, svcConfig] of Object.entries(services)) {
      const svc = svcConfig as any;
      if (svc.image) {
        images.push(parseImageRef(svc.image, svcName));
      }
    }

    // Extract tagline - it can be an object with language keys or a string
    let description: string | undefined;
    if (casaos.tagline) {
      if (typeof casaos.tagline === 'object') {
        description = casaos.tagline.en || Object.values(casaos.tagline)[0] as string;
      } else {
        description = String(casaos.tagline);
      }
    }

    return {
      name: dirName,
      storeId: storeConfig.id,
      storeName: storeConfig.name,
      icon: casaos.icon || undefined,
      description,
      category: casaos.category ? (Array.isArray(casaos.category) ? casaos.category[0] : casaos.category) : undefined,
      developer: casaos.developer || casaos.author || undefined,
      images,
      composeRaw,
    };
  } catch (err: any) {
    console.warn(`⚠️ Failed to parse compose for ${dirName}: ${err.message}`);
    return null;
  }
}

// --- Registry version checking ---

interface ParsedVersion {
  numbers: number[];
  suffix: string;  // e.g. "-alpine", "-rc20", "" for clean versions
  isPreRelease: boolean; // true for -rc, -beta, -alpha, -dev
  hasVPrefix: boolean;
}

/**
 * Parse a version tag into structured components.
 * Handles: "1.4.0", "v4.4.4", "15-alpine", "7-alpine", "0.5.8", "v2",
 *          "2.0.0-rc20", "14-alpine", "alpine" (no version), "git-f4000f4" (not a version)
 */
function parseVersion(tag: string): ParsedVersion | null {
  const hasVPrefix = /^v/i.test(tag);
  const cleaned = tag.replace(/^v/i, '');

  // Must start with a digit to be a version
  if (!/^\d/.test(cleaned)) return null;

  // Extract the numeric part and the suffix
  // Match: leading digits possibly separated by dots, then optional suffix
  const match = cleaned.match(/^(\d+(?:\.\d+)*)(.*)$/);
  if (!match) return null;

  const numbers = match[1].split('.').map(Number);
  const suffix = match[2] || ''; // e.g. "-alpine", "-rc20", ""

  // Detect pre-release suffixes
  const isPreRelease = /^-(rc|beta|alpha|dev|pre|snapshot)/i.test(suffix);

  return { numbers, suffix, isPreRelease, hasVPrefix };
}

function compareVersionNumbers(a: number[], b: number[]): number {
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const av = a[i] || 0;
    const bv = b[i] || 0;
    if (av !== bv) return av - bv;
  }
  return 0;
}

/**
 * Normalize a suffix for matching variants.
 * "-alpine" and "-bullseye" are variant suffixes (OS/distro flavors).
 * "-rc1", "-beta2" are pre-release suffixes.
 * Returns the variant portion (e.g. "-alpine") without pre-release parts.
 */
function getVariantSuffix(suffix: string): string {
  // Common variant suffixes to recognize as the same "family"
  const variantMatch = suffix.match(/^-?(alpine|bullseye|slim|buster|bookworm|jammy|focal)/i);
  if (variantMatch) return '-' + variantMatch[1].toLowerCase();
  // If suffix doesn't start with a pre-release marker and isn't empty, treat it as a variant
  if (suffix && !/^-(rc|beta|alpha|dev|pre|snapshot)/i.test(suffix)) {
    return suffix.toLowerCase();
  }
  return '';
}

/**
 * Find the latest stable tag that matches the same variant as the current tag.
 * E.g., if current is "15-alpine", only consider other "*-alpine" tags.
 * If current is "1.4.0", only consider clean tags (no variant suffix).
 * Pre-release tags (rc, beta, alpha) are excluded unless the current tag is itself a pre-release.
 */
function findLatestMatchingTag(tags: string[], currentTag: string): string | null {
  const currentParsed = parseVersion(currentTag);
  if (!currentParsed) return null;

  const currentVariant = getVariantSuffix(currentParsed.suffix);
  const includePreRelease = currentParsed.isPreRelease;

  let best: { tag: string; parsed: ParsedVersion } | null = null;

  for (const tag of tags) {
    const parsed = parseVersion(tag);
    if (!parsed) continue;

    // Must match the same variant family
    const tagVariant = getVariantSuffix(parsed.suffix);
    if (tagVariant !== currentVariant) continue;

    // Skip pre-releases unless current is also pre-release
    if (parsed.isPreRelease && !includePreRelease) continue;

    if (!best || compareVersionNumbers(parsed.numbers, best.parsed.numbers) > 0) {
      best = { tag, parsed };
    }
  }

  return best ? best.tag : null;
}

async function fetchDockerHubTags(repository: string): Promise<string[]> {
  try {
    const url = `https://registry.hub.docker.com/v2/repositories/${repository}/tags?page_size=100&ordering=last_updated`;
    const resp = await axios.get(url, { timeout: 10000 });
    return (resp.data.results || []).map((t: any) => t.name);
  } catch (err: any) {
    console.warn(`⚠️ Docker Hub tag fetch failed for ${repository}: ${err.message}`);
    return [];
  }
}

async function fetchGhcrTags(repository: string): Promise<string[]> {
  try {
    // Get anonymous token
    const tokenUrl = `https://ghcr.io/token?scope=repository:${repository}:pull`;
    const tokenResp = await axios.get(tokenUrl, { timeout: 10000 });
    const token = tokenResp.data.token;
    const headers = { 'Authorization': `Bearer ${token}` };

    // Paginate through all tag pages (GHCR caps at 1000 per page)
    let allTags: string[] = [];
    let url: string | null = `https://ghcr.io/v2/${repository}/tags/list?n=1000`;

    while (url) {
      const resp = await axios.get(url, { headers, timeout: 15000 });
      const tags = resp.data.tags || [];
      allTags = allTags.concat(tags);

      // Check Link header for next page
      const link = resp.headers.link as string | undefined;
      if (link && link.includes('rel="next"')) {
        const match = link.match(/<([^>]+)>/);
        if (match) {
          url = match[1];
          if (url.startsWith('/')) url = 'https://ghcr.io' + url;
        } else {
          url = null;
        }
      } else {
        url = null;
      }

      // Safety cap — don't fetch forever for repos with 100k+ tags
      if (allTags.length > 50000) break;
    }

    return allTags;
  } catch (err: any) {
    console.warn(`⚠️ GHCR tag fetch failed for ${repository}: ${err.message}`);
    return [];
  }
}

async function fetchCustomRegistryTags(registry: string, repository: string): Promise<string[]> {
  try {
    const url = `https://${registry}/v2/${repository}/tags/list`;
    const resp = await axios.get(url, { timeout: 10000 });
    return resp.data.tags || [];
  } catch (err: any) {
    console.warn(`⚠️ Registry tag fetch failed for ${registry}/${repository}: ${err.message}`);
    return [];
  }
}

async function fetchTagsForImage(imageRef: DockerImageRef): Promise<string[]> {
  // Check registry cache first
  const cacheEntries = loadRegistryCache();
  const cacheKey = `${imageRef.registry}/${imageRef.repository}`;
  const cached = cacheEntries.find(e => `${e.registry}/${e.repository}` === cacheKey);

  if (cached && isCacheValid(cached.fetchedAt)) {
    return cached.tags;
  }

  let tags: string[];
  if (imageRef.registry === 'docker.io') {
    tags = await fetchDockerHubTags(imageRef.repository);
  } else if (imageRef.registry === 'ghcr.io') {
    tags = await fetchGhcrTags(imageRef.repository);
  } else {
    tags = await fetchCustomRegistryTags(imageRef.registry, imageRef.repository);
  }

  // Update cache
  const existingIdx = cacheEntries.findIndex(e => `${e.registry}/${e.repository}` === cacheKey);
  const entry: RegistryCacheEntry = {
    repository: imageRef.repository,
    registry: imageRef.registry,
    tags,
    fetchedAt: new Date().toISOString(),
  };
  if (existingIdx >= 0) {
    cacheEntries[existingIdx] = entry;
  } else {
    cacheEntries.push(entry);
  }
  saveRegistryCache(cacheEntries);

  return tags;
}

// Well-known floating/rolling tags that are not versioned — treat like :latest
const FLOATING_TAGS = new Set([
  'latest', 'alpine', 'slim', 'stable', 'edge', 'beta', 'nightly',
  'bullseye', 'bookworm', 'buster', 'trixie', 'jammy', 'focal', 'noble',
  'lts', 'mainline', 'current', 'preview',
]);

export async function checkImageVersion(imageRef: DockerImageRef): Promise<DockerImageRef> {
  const result = { ...imageRef };

  // If using :latest or a known floating tag, mark as such
  if (imageRef.currentTag === 'latest' || FLOATING_TAGS.has(imageRef.currentTag.toLowerCase())) {
    result.versionStatus = 'latest-tag';
    return result;
  }

  // Check if current tag looks like a version
  const currentParsed = parseVersion(imageRef.currentTag);
  if (!currentParsed) {
    // Tags like "git-f4000f4" (hash) — genuinely unknown
    result.versionStatus = 'unknown';
    return result;
  }

  try {
    const tags = await fetchTagsForImage(imageRef);
    if (tags.length === 0) {
      result.versionStatus = 'unknown';
      return result;
    }

    const latestTag = findLatestMatchingTag(tags, imageRef.currentTag);
    if (!latestTag) {
      result.versionStatus = 'unknown';
      return result;
    }

    const latestParsed = parseVersion(latestTag)!;
    result.latestTag = latestTag;

    if (compareVersionNumbers(currentParsed.numbers, latestParsed.numbers) >= 0) {
      result.versionStatus = 'up-to-date';
    } else {
      result.versionStatus = 'update-available';
    }
  } catch (err: any) {
    console.warn(`⚠️ Version check failed for ${imageRef.fullRef}: ${err.message}`);
    result.versionStatus = 'unknown';
  }

  return result;
}

export async function checkImageVersions(images: DockerImageRef[], refresh: boolean = false): Promise<DockerImageRef[]> {
  // Always start fresh — clear stale file cache from previous runs.
  // Within this run, fetchTagsForImage naturally deduplicates via the file
  // (first fetch writes it, subsequent reads hit it).
  if (refresh) {
    clearRegistryCache();
  }

  // Deduplicate by fullRef — check each unique image once, map results to all duplicates
  const checkedMap = new Map<string, DockerImageRef>();

  for (const img of images) {
    if (checkedMap.has(img.fullRef)) continue;

    const result = await checkImageVersion(img);
    checkedMap.set(img.fullRef, result);
    // Small delay between unique registry calls to respect rate limits
    await new Promise(resolve => setTimeout(resolve, 200));
  }

  // Map results back to the original array order
  return images.map(img => {
    const checked = checkedMap.get(img.fullRef)!;
    return { ...checked, service: img.service };
  });
}
