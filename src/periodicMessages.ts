import fs from 'fs';
import path from 'path';

export interface PeriodicMessageEntry {
  id: string;
  text: string;
  minIntervalSeconds: number;
  maxIntervalSeconds: number;
}

export interface PeriodicMessagesConfig {
  globalLimits: {
    minGapSeconds: number;
    maxPerHour: number;
    startupGraceSeconds: number;
  };
  messages: PeriodicMessageEntry[];
}

type SayFn = (text: string) => Promise<void>;

function randomBetween(minMs: number, maxMs: number): number {
  return Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
}

export function loadPeriodicMessagesConfig(): PeriodicMessagesConfig {
  const filePath = path.join(__dirname, '..', 'periodic-messages.json');
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw) as PeriodicMessagesConfig;
  } catch {
    throw new Error(`Failed to load periodic-messages.json from ${filePath}. Ensure the file exists at the project root.`);
  }
}

export class PeriodicMessageScheduler {
  private readonly TICK_MS = 10_000;
  private readonly config: PeriodicMessagesConfig;

  private tickHandle: ReturnType<typeof setInterval> | null = null;
  private messageState: Map<string, { remainingMs: number }> = new Map();
  private initialized: boolean = false;
  private isStreamOnline: boolean = false;
  private streamStartedAt: number = 0;
  private sentTimestamps: number[] = [];
  private lastSentAt: number = 0;
  private say: SayFn | null = null;

  constructor(config: PeriodicMessagesConfig) {
    this.config = config;
  }

  start(say: SayFn): void {
    this.say = say;
    this.isStreamOnline = true;
    this.streamStartedAt = Date.now();

    if (!this.initialized) {
      for (const entry of this.config.messages) {
        this.messageState.set(entry.id, {
          remainingMs: randomBetween(entry.minIntervalSeconds * 1000, entry.maxIntervalSeconds * 1000),
        });
      }
      this.tickHandle = setInterval(() => this.tick(), this.TICK_MS);
      this.initialized = true;
      console.log(`[periodic] Scheduler started with ${this.config.messages.length} message(s). Grace period: ${this.config.globalLimits.startupGraceSeconds}s.`);
    } else {
      console.log('[periodic] Stream back online — resuming countdowns.');
    }
  }

  stop(): void {
    this.isStreamOnline = false;
    console.log('[periodic] Stream offline — countdowns paused.');
  }

  private tick(): void {
    if (!this.isStreamOnline) return;

    for (const [id, state] of this.messageState) {
      state.remainingMs -= this.TICK_MS;

      if (state.remainingMs <= 0) {
        const entry = this.config.messages.find((e) => e.id === id);
        if (!entry) continue;

        if (this.canSend()) {
          const now = Date.now();
          this.lastSentAt = now;
          this.sentTimestamps.push(now);
          this.say!(entry.text).catch((err) => {
            console.error(`[periodic] Failed to send "${id}":`, err);
          });
        } else {
          console.log(`[periodic] Skipping "${id}" — rate limited or grace period active.`);
        }

        state.remainingMs = randomBetween(entry.minIntervalSeconds * 1000, entry.maxIntervalSeconds * 1000);
      }
    }
  }

  private canSend(): boolean {
    const now = Date.now();
    const oneHourAgo = now - 60 * 60 * 1000;

    this.sentTimestamps = this.sentTimestamps.filter((t) => t > oneHourAgo);

    if (this.sentTimestamps.length >= this.config.globalLimits.maxPerHour) {
      return false;
    }

    if (this.lastSentAt > 0 && now - this.lastSentAt < this.config.globalLimits.minGapSeconds * 1000) {
      return false;
    }

    if (now - this.streamStartedAt < this.config.globalLimits.startupGraceSeconds * 1000) {
      return false;
    }

    return true;
  }
}
