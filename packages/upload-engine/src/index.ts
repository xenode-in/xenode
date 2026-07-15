export type UploadStatus =
  | "queued"
  | "running"
  | "paused"
  | "completed"
  | "failed"
  | "cancelled";

export interface UploadInput {
  id: string;
  name: string;
  size: number;
  contentType: string;
  source: unknown;
}

export interface UploadCheckpoint {
  uploadId: string;
  offset: number;
  remoteId?: string;
}

export interface UploadPolicy {
  validate(input: UploadInput): void | Promise<void>;
}

export interface UploadAdapter {
  upload(
    input: UploadInput,
    checkpoint: UploadCheckpoint | null,
    signal: AbortSignal,
    onCheckpoint: (checkpoint: UploadCheckpoint) => Promise<void>,
  ): Promise<unknown>;
}

export interface CheckpointStore {
  load(uploadId: string): Promise<UploadCheckpoint | null>;
  save(checkpoint: UploadCheckpoint): Promise<void>;
  remove(uploadId: string): Promise<void>;
}

export const acceptAllUploadPolicy: UploadPolicy = {
  validate() {},
};

export function createMemoryCheckpointStore(): CheckpointStore {
  const checkpoints = new Map<string, UploadCheckpoint>();
  return {
    async load(uploadId) {
      return checkpoints.get(uploadId) ?? null;
    },
    async save(checkpoint) {
      checkpoints.set(checkpoint.uploadId, { ...checkpoint });
    },
    async remove(uploadId) {
      checkpoints.delete(uploadId);
    },
  };
}

export interface UploadResult {
  id: string;
  status: UploadStatus;
  value?: unknown;
  error?: Error;
}

export interface UploadEngineOptions {
  concurrency?: number;
  maxAttempts?: number;
  retryDelayMs?: (attempt: number) => number;
}

interface Job {
  input: UploadInput;
  controller: AbortController;
  resolve: (result: UploadResult) => void;
  attempts: number;
}

export class UploadEngine {
  private readonly queue: Job[] = [];
  private readonly active = new Map<string, Job>();
  private paused = false;
  private readonly concurrency: number;
  private readonly maxAttempts: number;
  private readonly retryDelayMs: (attempt: number) => number;

  constructor(
    private readonly adapter: UploadAdapter,
    private readonly policy: UploadPolicy,
    private readonly checkpoints: CheckpointStore,
    options: UploadEngineOptions = {},
  ) {
    this.concurrency = Math.max(1, options.concurrency ?? 5);
    this.maxAttempts = Math.max(1, options.maxAttempts ?? 3);
    this.retryDelayMs = options.retryDelayMs ?? ((attempt) => 250 * 2 ** attempt);
  }

  enqueue(input: UploadInput): Promise<UploadResult> {
    return new Promise((resolve) => {
      this.queue.push({
        input,
        controller: new AbortController(),
        resolve,
        attempts: 0,
      });
      this.pump();
    });
  }

  pause(): void {
    this.paused = true;
  }

  resume(): void {
    this.paused = false;
    this.pump();
  }

  cancel(id: string): boolean {
    const queuedIndex = this.queue.findIndex((job) => job.input.id === id);
    if (queuedIndex >= 0) {
      const [job] = this.queue.splice(queuedIndex, 1);
      job.resolve({ id, status: "cancelled" });
      return true;
    }
    const active = this.active.get(id);
    if (!active) return false;
    active.controller.abort();
    return true;
  }

  private pump(): void {
    while (
      !this.paused &&
      this.active.size < this.concurrency &&
      this.queue.length > 0
    ) {
      const job = this.queue.shift();
      if (!job) return;
      this.active.set(job.input.id, job);
      void this.run(job);
    }
  }

  private async run(job: Job): Promise<void> {
    try {
      await this.policy.validate(job.input);
      const checkpoint = await this.checkpoints.load(job.input.id);
      const value = await this.adapter.upload(
        job.input,
        checkpoint,
        job.controller.signal,
        (next) => this.checkpoints.save(next),
      );
      await this.checkpoints.remove(job.input.id);
      job.resolve({ id: job.input.id, status: "completed", value });
    } catch (cause) {
      const error = cause instanceof Error ? cause : new Error(String(cause));
      if (job.controller.signal.aborted) {
        job.resolve({ id: job.input.id, status: "cancelled", error });
      } else if (++job.attempts < this.maxAttempts) {
        await new Promise((resolve) =>
          setTimeout(resolve, this.retryDelayMs(job.attempts)),
        );
        this.active.delete(job.input.id);
        this.queue.unshift(job);
        this.pump();
        return;
      } else {
        job.resolve({ id: job.input.id, status: "failed", error });
      }
    }
    this.active.delete(job.input.id);
    this.pump();
  }
}
