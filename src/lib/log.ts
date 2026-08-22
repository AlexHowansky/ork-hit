/**
 * Structured JSON-line logging.
 *
 * Every line carries a level, a message and whatever context the caller attaches.
 * Secrets are redacted defensively so that a careless `log.info("...", req.body)`
 * can never leak a password or a session code into the log stream.
 */

import { config, type LogLevel } from "./config.ts";

const severity: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const threshold = severity[config.logLevel];

/** Keys whose values are never safe to write to a log. */
const REDACTED_KEYS = new Set([
  "password",
  "newPassword",
  "passwordHash",
  "password_hash",
  "token",
  "tokenHash",
  "token_hash",
  "cookie",
  "authorization",
  // Session codes only. Not a bare "code": that is also the name of the error
  // code field, which is one of the more useful things in these logs.
  "sessionCode",
  "joinCode",
  "gm_sid",
  "player_sid",
]);

export type LogContext = Record<string, unknown>;

function redact(value: unknown, depth = 0): unknown {
  if (depth > 4) return "[deep]";
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }
  if (Array.isArray(value)) return value.map((entry) => redact(entry, depth + 1));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      out[key] = REDACTED_KEYS.has(key) ? "[redacted]" : redact(entry, depth + 1);
    }
    return out;
  }
  return value;
}

function emit(level: LogLevel, msg: string, context?: LogContext): void {
  if (severity[level] < threshold) return;
  const line = {
    ts: new Date().toISOString(),
    level,
    msg,
    ...(context ? (redact(context) as LogContext) : {}),
  };
  const serialized = JSON.stringify(line);
  if (level === "error" || level === "warn") console.error(serialized);
  else console.log(serialized);
}

export const log = {
  debug: (msg: string, context?: LogContext) => emit("debug", msg, context),
  info: (msg: string, context?: LogContext) => emit("info", msg, context),
  warn: (msg: string, context?: LogContext) => emit("warn", msg, context),
  error: (msg: string, context?: LogContext) => emit("error", msg, context),
  /** Returns a logger that stamps every line with the given base context. */
  child(base: LogContext) {
    return {
      debug: (msg: string, context?: LogContext) => emit("debug", msg, { ...base, ...context }),
      info: (msg: string, context?: LogContext) => emit("info", msg, { ...base, ...context }),
      warn: (msg: string, context?: LogContext) => emit("warn", msg, { ...base, ...context }),
      error: (msg: string, context?: LogContext) => emit("error", msg, { ...base, ...context }),
    };
  },
};

export type Logger = ReturnType<typeof log.child>;
