/**
 * Central configuration, read once at startup from the environment.
 *
 * Everything the app needs to know about its deployment lives here so that no
 * other module reads `process.env` directly.
 */

function bool(value: string | undefined, fallback = false): boolean {
  if (value === undefined) return fallback;
  return value === "1" || value.toLowerCase() === "true";
}

const logLevels = ["debug", "info", "warn", "error"] as const;
export type LogLevel = (typeof logLevels)[number];

function logLevel(value: string | undefined): LogLevel {
  const candidate = (value ?? "info").toLowerCase();
  return (logLevels as readonly string[]).includes(candidate)
    ? (candidate as LogLevel)
    : "info";
}

const appOrigin = (process.env.APP_ORIGIN ?? "http://localhost:3000").replace(/\/+$/, "");

export const config = {
  port: Number(process.env.PORT ?? 3000),
  appOrigin,
  /** Hostname:port pairs accepted in the Origin header of mutating requests. */
  trustedProxy: bool(process.env.TRUSTED_PROXY),
  databasePath: process.env.DATABASE_PATH ?? "./data/app.db",
  uploadDir: process.env.UPLOAD_DIR ?? "./data/uploads",
  logLevel: logLevel(process.env.LOG_LEVEL),
  /** Development escape hatch: serve cookies without the Secure flag over plain HTTP. */
  insecureCookies: bool(process.env.INSECURE_COOKIES),
  isProduction: process.env.NODE_ENV === "production",
} as const;

/** Upload limits, enforced during multipart intake. */
export const limits = {
  sheetBytes: 5 * 1024 * 1024,
  imageBytes: 5 * 1024 * 1024,
  /** Sliding window before a GM has to log in again. */
  gmSessionTtlMs: 7 * 24 * 60 * 60 * 1000,
  /** Hard ceiling regardless of activity. */
  gmSessionMaxMs: 30 * 24 * 60 * 60 * 1000,
  passwordMinLength: 12,
  nameMaxLength: 60,
} as const;
