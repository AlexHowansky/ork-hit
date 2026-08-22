/**
 * In-memory token-bucket rate limiting.
 *
 * Applied to the two endpoints that are worth guessing at: game master sign-in
 * and joining a session with a code. State is per-process, which is the right
 * scope here — the app runs as a single process against a local SQLite file.
 */

import { errors } from "../../lib/errors.ts";
import { log } from "../../lib/log.ts";

interface Bucket {
  tokens: number;
  updatedAt: number;
}

export interface LimitConfig {
  /** Bucket capacity: how many attempts are allowed in a burst. */
  burst: number;
  /** Tokens refilled per second. */
  refillPerSecond: number;
}

export class RateLimiter {
  readonly #buckets = new Map<string, Bucket>();
  readonly #config: LimitConfig;
  readonly #name: string;

  constructor(name: string, config: LimitConfig) {
    this.#name = name;
    this.#config = config;
  }

  /** Consumes one token for `key`, throwing a 429 when the bucket is empty. */
  check(key: string): void {
    const now = Date.now();
    const bucket = this.#buckets.get(key) ?? { tokens: this.#config.burst, updatedAt: now };

    const elapsedSeconds = (now - bucket.updatedAt) / 1000;
    bucket.tokens = Math.min(
      this.#config.burst,
      bucket.tokens + elapsedSeconds * this.#config.refillPerSecond,
    );
    bucket.updatedAt = now;

    if (bucket.tokens < 1) {
      this.#buckets.set(key, bucket);
      log.warn("rate limited", { limiter: this.#name, key });
      throw errors.rateLimited();
    }

    bucket.tokens -= 1;
    this.#buckets.set(key, bucket);
  }

  /** Called after a success, so a legitimate user isn't penalised for a typo. */
  reset(key: string): void {
    this.#buckets.delete(key);
  }

  /** Drops buckets that have refilled completely, so the map can't grow forever. */
  sweep(): void {
    const fullAfterMs = (this.#config.burst / this.#config.refillPerSecond) * 1000;
    const cutoff = Date.now() - fullAfterMs;
    for (const [key, bucket] of this.#buckets) {
      if (bucket.updatedAt < cutoff) this.#buckets.delete(key);
    }
  }
}

/** Five attempts up front, then roughly one more every twenty seconds. */
export const loginLimiter = new RateLimiter("gm-login", { burst: 5, refillPerSecond: 0.05 });

/** Joining is a little more forgiving: codes get mistyped by people at a table. */
export const joinLimiter = new RateLimiter("session-join", { burst: 10, refillPerSecond: 0.1 });

export function sweepLimiters(): void {
  loginLimiter.sweep();
  joinLimiter.sweep();
}
