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

/** A positive number, or the fallback: a misconfigured duration is worse than none. */
function duration(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
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
  /**
   * How long a player may have no connection open before they are dropped from
   * the session. Long enough to cover a reload, a tunnel, or a phone waking up;
   * short enough that a closed browser doesn't sit in the list all evening.
   */
  playerGraceMs: duration(process.env.PLAYER_GRACE_MS, 30_000),
  isProduction: process.env.NODE_ENV === "production",
} as const;

/** Upload limits, enforced during multipart intake. */
export const limits = {
  sheetBytes: 5 * 1024 * 1024,
  imageBytes: 5 * 1024 * 1024,
  /**
   * The shorter side a stored image is scaled down to.
   *
   * Every picture the app shows is a square card 11rem — 176px — across, cropped
   * from whatever was uploaded, so the shorter side is what has to cover it.
   * 512 leaves room for a card at three times that density, or the full-width
   * card a phone shows, without keeping a 4000px photograph to draw a thumbnail.
   */
  cardImagePx: 512,
  /** Sliding window before a GM has to log in again. */
  gmSessionTtlMs: 7 * 24 * 60 * 60 * 1000,
  /** Hard ceiling regardless of activity. */
  gmSessionMaxMs: 30 * 24 * 60 * 60 * 1000,
  passwordMinLength: 12,
  nameMaxLength: 60,
} as const;
