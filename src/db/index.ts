/**
 * SQLite connection.
 *
 * A single shared connection in WAL mode. Bun's SQLite driver is synchronous and
 * the workload here is tiny (a handful of rows per game table), so there is no
 * pool to manage.
 */

import { Database } from "bun:sqlite";
import { dirname } from "node:path";
import { mkdirSync } from "node:fs";
import { config } from "../lib/config.ts";

function open(path: string): Database {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const database = new Database(path, { create: true, strict: true });
  database.exec("PRAGMA journal_mode = WAL");
  database.exec("PRAGMA foreign_keys = ON");
  // Wait rather than fail when another writer holds the lock.
  database.exec("PRAGMA busy_timeout = 5000");
  database.exec("PRAGMA synchronous = NORMAL");
  return database;
}

export const db = open(config.databasePath);

/** Timestamps are stored as ISO-8601 UTC strings so they compare lexicographically. */
export function now(): string {
  return new Date().toISOString();
}

/** ISO timestamp `ms` milliseconds from now. */
export function fromNow(ms: number): string {
  return new Date(Date.now() + ms).toISOString();
}
