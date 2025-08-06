import { Repository, loadSettings } from './storage';

export interface BuildJob {
  id: string;
  repository: Repository;
  force: boolean;
  timestamp: number;
  status: 'queued' | 'building' | 'completed' | 'failed';
  startTime?: number;
  endTime?: number;
  error?: string;
  resolve?: (result: { success: boolean; message: string }) => void;
  reject?: (error: Error) => void;
}

export class BuildQueue {
  private queue: BuildJob[] = [];
  private running: Map<string, BuildJob> = new Map();
  private completed: BuildJob[] = [];
  private pendingRepositoryIds: Set<string> = new Set();
  private maxConcurrent: number;

  constructor() {
    this.maxConcurrent = 2; // Default value
    this.updateMaxConcurrent();
  }

  updateMaxConcurrent(): void {
    const settings = loadSettings();
    this.maxConcurrent = settings.maxConcurrentBuilds;
    console.log(`🔧 Build queue max concurrent builds set to: ${this.maxConcurrent}`);
  }

  async addJob(repository: Repository, force: boolean = false): Promise<{ success: boolean; message: string }> {
    return new Promise((resolve, reject) => {
      if (this.pendingRepositoryIds.has(repository.id)) {
        resolve({ success: false, message: `Repository ${repository.name} is already queued or building` });
        return;
      }

      this.pendingRepositoryIds.add(repository.id);

      const job: BuildJob = {
        id: `${repository.id}-${Date.now()}`,
        repository,
        force,
        timestamp: Date.now(),
        status: 'queued',
        resolve,
        reject
      };

      this.queue.push(job);
      console.log(`📋 Added build job for ${repository.name} to queue (${this.queue.length} queued)`);
      
      // Try to start the job immediately if we have capacity
      this.processQueue();
    });
  }

  private async processQueue(): Promise<void> {
    // Update max concurrent setting in case it changed
    this.updateMaxConcurrent();

    // Start jobs if we have capacity and jobs waiting
    while (this.running.size < this.maxConcurrent && this.queue.length > 0) {
      const job = this.queue.shift()!;
      await this.startJob(job);
    }
  }

  private async startJob(job: BuildJob): Promise<void> {
    job.status = 'building';
    job.startTime = Date.now();
    this.running.set(job.repository.id, job);

    console.log(`🚀 Starting build job for ${job.repository.name} (${this.running.size}/${this.maxConcurrent} slots used)`);

    try {
      // Import the processRepo function dynamically to avoid circular imports
      const { processRepo } = await import('./repository-processor');
      const result = await processRepo(job.repository, job.force);

      job.status = 'completed';
      job.endTime = Date.now();
      
      console.log(`✅ Build job completed for ${job.repository.name} in ${job.endTime - job.startTime!}ms`);
      
      if (job.resolve) {
        job.resolve(result);
      }

    } catch (error: any) {
      job.status = 'failed';
      job.endTime = Date.now();
      job.error = error.message;

      console.error(`❌ Build job failed for ${job.repository.name}:`, error);

      if (job.reject) {
        job.reject(error);
      }
    } finally {
      // Move job from running to completed
      this.running.delete(job.repository.id);
      this.completed.push(job);
      this.pendingRepositoryIds.delete(job.repository.id);


      // Keep only last 50 completed jobs to prevent memory leak
      if (this.completed.length > 50) {
        this.completed.splice(0, this.completed.length - 50);
      }

      // Process next jobs in queue
      this.processQueue();
    }
  }

  getQueueStatus(): {
    maxConcurrent: number;
    running: number;
    queued: number;
    queuedJobs: Array<{
      id: string;
      repositoryName: string;
      repositoryId: string;
      timestamp: number;
      waitTime: number;
    }>;
    runningJobs: Array<{
      id: string;
      repositoryName: string;
      repositoryId: string;
      startTime: number;
      runTime: number;
    }>;
  } {
    const now = Date.now();
    
    return {
      maxConcurrent: this.maxConcurrent,
      running: this.running.size,
      queued: this.queue.length,
      queuedJobs: this.queue.map(job => ({
        id: job.id,
        repositoryName: job.repository.name,
        repositoryId: job.repository.id,
        timestamp: job.timestamp,
        waitTime: now - job.timestamp
      })),
      runningJobs: Array.from(this.running.values()).map(job => ({
        id: job.id,
        repositoryName: job.repository.name,
        repositoryId: job.repository.id,
        startTime: job.startTime!,
        runTime: now - job.startTime!
      }))
    };
  }

  getRecentJobs(limit: number = 10): Array<{
    id: string;
    repositoryName: string;
    repositoryId: string;
    status: BuildJob['status'];
    startTime?: number;
    endTime?: number;
    duration?: number;
    error?: string;
  }> {
    return this.completed
      .slice(-limit)
      .reverse()
      .map(job => ({
        id: job.id,
        repositoryName: job.repository.name,
        repositoryId: job.repository.id,
        status: job.status,
        startTime: job.startTime,
        endTime: job.endTime,
        duration: job.startTime && job.endTime ? job.endTime - job.startTime : undefined,
        error: job.error
      }));
  }

  isRepositoryBuilding(repositoryId: string): boolean {
    return this.running.has(repositoryId);
  }

  isRepositoryQueued(repositoryId: string): boolean {
    return this.queue.some(job => job.repository.id === repositoryId);
  }

  cancelQueuedJob(repositoryId: string): boolean {
    const index = this.queue.findIndex(job => job.repository.id === repositoryId);
    if (index !== -1) {
      const job = this.queue.splice(index, 1)[0];
      this.pendingRepositoryIds.delete(job.repository.id);
      if (job.resolve) {
        job.resolve({ success: false, message: 'Build cancelled by user' });
      }
      console.log(`🚫 Cancelled queued build job for ${job.repository.name}`);
      return true;
    }
    return false;
  }
}

// Global build queue instance
export const buildQueue = new BuildQueue();