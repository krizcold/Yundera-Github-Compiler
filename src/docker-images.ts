import { exec } from 'child_process';
import yaml from 'js-yaml';
import { Repository } from './storage';

// execAsync following casaos-status.ts pattern
const execAsync = (command: string, options: any = {}) => {
  return new Promise<{ stdout: string; stderr: string }>((resolve) => {
    const defaultOptions = {
      maxBuffer: 50 * 1024 * 1024,
      timeout: 30000,
      ...options
    };
    exec(command, defaultOptions, (error, stdout, stderr) => {
      if (error) {
        console.error(`[docker-images] Command failed: ${command.substring(0, 100)}`);
        resolve({ stdout: '', stderr: error.message });
      } else {
        resolve({ stdout: stdout.toString(), stderr: stderr.toString() });
      }
    });
  });
};

// --- Interfaces ---

export interface ContainerRef {
  id: string;
  name: string;
  state: string;
}

export interface DockerImageInfo {
  id: string;
  repository: string;
  tag: string;
  size: string;
  createdAt: string;
  createdSince: string;
  status: 'in-use' | 'unused' | 'dangling';
  containers: ContainerRef[];
  yunderaManaged: boolean;
  yunderaRepoName?: string;
}

export interface DockerImageGroup {
  repository: string;
  images: DockerImageInfo[];
}

export interface DockerDiskUsage {
  totalSize: string;
  reclaimable: string;
  imageCount: number;
  danglingCount: number;
  unusedCount: number;
  inUseCount: number;
}

// --- Docker CLI functions ---

interface RawImage {
  ID: string;
  Repository: string;
  Tag: string;
  Size: string;
  CreatedAt: string;
  CreatedSince: string;
}

interface RawContainer {
  ID: string;
  Names: string;
  Image: string;
  Status: string;
  State: string;
}

async function getDockerImages(): Promise<RawImage[]> {
  const { stdout } = await execAsync(`docker images --no-trunc --format '{{json .}}'`);
  if (!stdout.trim()) return [];
  return stdout.trim().split('\n').map(line => {
    try { return JSON.parse(line); }
    catch { return null; }
  }).filter(Boolean) as RawImage[];
}

async function getDockerContainers(): Promise<RawContainer[]> {
  const { stdout } = await execAsync(`docker ps -a --no-trunc --format '{{json .}}'`);
  if (!stdout.trim()) return [];
  return stdout.trim().split('\n').map(line => {
    try { return JSON.parse(line); }
    catch { return null; }
  }).filter(Boolean) as RawContainer[];
}

async function getDiskUsageRaw(): Promise<string> {
  const { stdout } = await execAsync(`docker system df`);
  return stdout;
}

function parseDiskUsage(raw: string, imageCount: number, danglingCount: number, unusedCount: number, inUseCount: number): DockerDiskUsage {
  // Parse "docker system df" output to extract Images row
  // Format: TYPE  TOTAL  ACTIVE  SIZE  RECLAIMABLE
  const lines = raw.trim().split('\n');
  let totalSize = 'N/A';
  let reclaimable = 'N/A';
  for (const line of lines) {
    if (line.startsWith('Images')) {
      const parts = line.split(/\s{2,}/);
      if (parts.length >= 5) {
        totalSize = parts[3];
        reclaimable = parts[4];
      }
    }
  }
  return { totalSize, reclaimable, imageCount, danglingCount, unusedCount, inUseCount };
}

// --- Yundera-managed detection ---

function extractImageRefsFromRepos(repos: Repository[]): Map<string, string> {
  // Returns Map<imageName (repo:tag or repo), repoDisplayName>
  const imageMap = new Map<string, string>();

  for (const repo of repos) {
    const composeSrc = repo.modifiedDockerCompose || repo.rawDockerCompose;
    if (!composeSrc) continue;

    const displayName = repo.displayName || repo.name;

    try {
      const parsed = yaml.load(composeSrc) as any;
      if (parsed && parsed.services) {
        for (const svcName of Object.keys(parsed.services)) {
          const svc = parsed.services[svcName];
          if (svc.image) {
            const img = svc.image.toString().trim();
            imageMap.set(img, displayName);
            // Also store just the repo part (without tag)
            const colonIdx = img.lastIndexOf(':');
            if (colonIdx > 0) {
              imageMap.set(img.substring(0, colonIdx), displayName);
            }
          }
        }
      }
    } catch {
      // Skip repos with invalid YAML
    }

    // Also match by repo name/appName as image prefix
    if (repo.name) imageMap.set(repo.name, displayName);
    if (repo.appName) imageMap.set(repo.appName, displayName);
  }

  return imageMap;
}

// --- Main enrichment function ---

export async function getEnrichedImageList(repos: Repository[]): Promise<{ groups: DockerImageGroup[]; diskUsage: DockerDiskUsage }> {
  const [rawImages, rawContainers, diskUsageRaw] = await Promise.all([
    getDockerImages(),
    getDockerContainers(),
    getDiskUsageRaw()
  ]);

  // Build container-to-image mapping
  // A container's Image field can be "name:tag" or just "name" or an ID
  const containersByImage = new Map<string, ContainerRef[]>();
  for (const c of rawContainers) {
    const ref: ContainerRef = { id: c.ID.substring(0, 12), name: c.Names, state: c.State };
    const imageKey = c.Image;
    if (!containersByImage.has(imageKey)) {
      containersByImage.set(imageKey, []);
    }
    containersByImage.get(imageKey)!.push(ref);
  }

  // Build set of image IDs that are used by containers
  const usedImageIds = new Set<string>();
  for (const c of rawContainers) {
    // Try to match by full image reference or by ID
    for (const img of rawImages) {
      const fullRef = img.Repository !== '<none>' ? `${img.Repository}:${img.Tag}` : '';
      if (c.Image === fullRef || c.Image === img.Repository || c.Image === img.ID || c.Image.startsWith('sha256:' + img.ID.replace('sha256:', ''))) {
        usedImageIds.add(img.ID);
      }
    }
  }

  // Yundera-managed detection
  const yunderaImageMap = extractImageRefsFromRepos(repos);

  // Enrich images
  let danglingCount = 0;
  let unusedCount = 0;
  let inUseCount = 0;

  const enriched: DockerImageInfo[] = rawImages.map(img => {
    const isDangling = img.Repository === '<none>' && img.Tag === '<none>';
    const isUsed = usedImageIds.has(img.ID);

    let status: DockerImageInfo['status'];
    if (isDangling) {
      status = 'dangling';
      danglingCount++;
    } else if (isUsed) {
      status = 'in-use';
      inUseCount++;
    } else {
      status = 'unused';
      unusedCount++;
    }

    // Find containers using this image
    const fullRef = img.Repository !== '<none>' ? `${img.Repository}:${img.Tag}` : '';
    const containers = containersByImage.get(fullRef) || containersByImage.get(img.Repository) || [];

    // Yundera-managed check
    let yunderaManaged = false;
    let yunderaRepoName: string | undefined;

    if (img.Repository !== '<none>') {
      // Check full ref (repo:tag), repo only, and repo name
      const checks = [fullRef, img.Repository];
      for (const check of checks) {
        if (yunderaImageMap.has(check)) {
          yunderaManaged = true;
          yunderaRepoName = yunderaImageMap.get(check);
          break;
        }
      }
    }

    return {
      id: img.ID.replace('sha256:', '').substring(0, 12),
      repository: img.Repository,
      tag: img.Tag,
      size: img.Size,
      createdAt: img.CreatedAt,
      createdSince: img.CreatedSince,
      status,
      containers,
      yunderaManaged,
      yunderaRepoName
    };
  });

  // Group by repository
  const groupMap = new Map<string, DockerImageInfo[]>();
  for (const img of enriched) {
    const key = img.repository;
    if (!groupMap.has(key)) {
      groupMap.set(key, []);
    }
    groupMap.get(key)!.push(img);
  }

  // Sort: dangling (<none>) first, then alphabetical
  const groups: DockerImageGroup[] = [];
  if (groupMap.has('<none>')) {
    groups.push({ repository: '<none>', images: groupMap.get('<none>')! });
    groupMap.delete('<none>');
  }
  const sortedKeys = [...groupMap.keys()].sort((a, b) => a.localeCompare(b));
  for (const key of sortedKeys) {
    groups.push({ repository: key, images: groupMap.get(key)! });
  }

  const diskUsage = parseDiskUsage(diskUsageRaw, rawImages.length, danglingCount, unusedCount, inUseCount);

  return { groups, diskUsage };
}

// --- Delete / Prune operations ---

export async function deleteDockerImage(imageId: string, force: boolean): Promise<{ success: boolean; message: string }> {
  // Sanitize: only allow hex characters for image IDs
  const sanitized = imageId.replace(/[^a-f0-9]/g, '');
  if (!sanitized || sanitized.length < 6) {
    return { success: false, message: 'Invalid image ID' };
  }

  const cmd = force ? `docker rmi -f ${sanitized}` : `docker rmi ${sanitized}`;
  const { stdout, stderr } = await execAsync(cmd);

  if (stderr && !stdout) {
    return { success: false, message: stderr };
  }
  return { success: true, message: stdout || 'Image removed' };
}

export async function pruneDockerImages(all: boolean): Promise<{ success: boolean; message: string; spaceReclaimed: string }> {
  const cmd = all ? 'docker image prune -a -f' : 'docker image prune -f';
  const { stdout, stderr } = await execAsync(cmd);

  // Parse "Total reclaimed space: X.XXgB" from output
  let spaceReclaimed = '0B';
  const match = stdout.match(/Total reclaimed space:\s*(.+)/i);
  if (match) {
    spaceReclaimed = match[1].trim();
  }

  if (stderr && !stdout) {
    return { success: false, message: stderr, spaceReclaimed: '0B' };
  }
  return { success: true, message: `Prune complete. Reclaimed: ${spaceReclaimed}`, spaceReclaimed };
}
