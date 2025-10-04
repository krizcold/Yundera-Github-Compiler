import { Repository, loadSettings } from './storage';
import { EventEmitter } from 'events';

export interface LogEntry {
  message: string;
  type: 'system' | 'info' | 'warning' | 'error' | 'success';
  timestamp: number;
}

export class LogCollector extends EventEmitter {
  private logs: LogEntry[] = [];
  private maxLogs: number = 1000;

  constructor(public repositoryId: string) {
    super();
  }

  addLog(message: string, type: LogEntry['type'] = 'info'): void {
    const logEntry: LogEntry = {
      message,
      type,
      timestamp: Date.now()
    };

    this.logs.push(logEntry);

    // Keep only recent logs to prevent memory issues
    if (this.logs.length > this.maxLogs) {
      this.logs.splice(0, this.logs.length - this.maxLogs);
    }

    // Emit the log entry to any connected streams
    this.emit('log', logEntry);
  }

  getLogs(): LogEntry[] {
    return [...this.logs];
  }

  clear(): void {
    this.logs = [];
  }
}

export interface BuildJob {
  id: string;
  repository: Repository;
  force: boolean;
  runAsUser?: string;
  runPreInstall?: boolean;
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
  private logCollectors: Map<string, LogCollector> = new Map();

  constructor() {
    this.maxConcurrent = 2; // Default value
    this.updateMaxConcurrent();
  }

  updateMaxConcurrent(): void {
    const settings = loadSettings();
    this.maxConcurrent = settings.maxConcurrentBuilds;
    console.log(`🔧 Build queue max concurrent builds set to: ${this.maxConcurrent}`);
  }

  async addJob(repository: Repository, force: boolean = false, runAsUser?: string, runPreInstall?: boolean): Promise<{ success: boolean; message: string }> {
    if (this.pendingRepositoryIds.has(repository.id)) {
      return { success: false, message: `Repository ${repository.name} is already queued or building` };
    }

    this.pendingRepositoryIds.add(repository.id);

    const job: BuildJob = {
      id: `${repository.id}-${Date.now()}`,
      repository,
      force,
      runAsUser,
      runPreInstall,
      timestamp: Date.now(),
      status: 'queued',
      resolve: undefined,
      reject: undefined
    };

    this.queue.push(job);
    console.log(`📋 Added build job for ${repository.name} to queue (${this.queue.length} queued)`);
    
    // Try to start the job immediately if we have capacity
    this.processQueue();
    
    // Return immediately after queueing (don't wait for completion)
    return { success: true, message: `Build job queued for ${repository.name}. Use /api/build-status to monitor progress.` };
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
    
    // Get log collector for this repository
    const logCollector = this.getLogCollector(job.repository.id);
    logCollector.clear(); // Clear previous logs
    
    logCollector.addLog(`🚀 Build process started for ${job.repository.name}`, 'system');
    logCollector.addLog(`⚙️ Job queued at ${new Date(job.timestamp).toLocaleTimeString()}`, 'info');
    logCollector.addLog(`🔧 Build started at ${new Date(job.startTime).toLocaleTimeString()}`, 'info');

    try {
      // Import the processRepo function dynamically to avoid circular imports
      const { processRepo } = await import('./repository-processor');
      
      // Pass the log collector to the processRepo function for real-time logging
      const result = await processRepo(job.repository, job.force, logCollector, job.runAsUser, job.runPreInstall);

      job.status = 'completed';
      job.endTime = Date.now();
      
      const duration = job.endTime - job.startTime!;
      console.log(`✅ Build job completed for ${job.repository.name} in ${duration}ms`);
      logCollector.addLog(`✅ Build completed successfully in ${duration}ms`, 'success');

    } catch (error: any) {
      job.status = 'failed';
      job.endTime = Date.now();
      job.error = error.message;

      console.error(`❌ Build job failed for ${job.repository.name}:`, error);
      logCollector.addLog(`❌ Build failed: ${error.message}`, 'error');
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

  getLogCollector(repositoryId: string): LogCollector {
    if (!this.logCollectors.has(repositoryId)) {
      this.logCollectors.set(repositoryId, new LogCollector(repositoryId));
    }
    return this.logCollectors.get(repositoryId)!;
  }

  clearLogs(repositoryId: string): void {
    const collector = this.logCollectors.get(repositoryId);
    if (collector) {
      collector.clear();
    }
  }
}

// Global build queue instance
export const buildQueue = new BuildQueue();