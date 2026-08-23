/**
 * The migration runner against a database that predates a migration.
 *
 * The scratch database the rest of the suite uses is migrated all at once, so it
 * can never exercise a backfill. These build the older shape by hand and let the
 * runner bring it forward.
 */

import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { migrate } from "../src/db/migrate.ts";

const MIGRATIONS = join(import.meta.dir, "../src/db/migrations");

/** A database on 001 only, with the runner told that much has been applied. */
function atInitialSchema(): Database {
  const target = new Database(":memory:", { strict: true });
  target.exec("PRAGMA foreign_keys = ON");
  target.exec(readFileSync(join(MIGRATIONS, "001_init.sql"), "utf8"));
  target.exec(`
    CREATE TABLE schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL);
    INSERT INTO schema_migrations VALUES ('001_init.sql', '2026-01-01T00:00:00.000Z');
    INSERT INTO gms VALUES ('gm1', 'gm@example.com', 'hash', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
    INSERT INTO campaigns (id, gm_id, name, created_at, updated_at)
      VALUES ('c1', 'gm1', 'Campaign', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
  `);
  return target;
}

/** One active session on campaign c1, created at the given time. */
function addActiveSession(target: Database, id: string, createdAt: string): void {
  target.query(`
    INSERT INTO game_sessions (id, campaign_id, gm_id, code, status, round, created_at)
    VALUES ($id, 'c1', 'gm1', $code, 'active', 1, $createdAt)
  `).run({ id, code: id.toUpperCase(), createdAt });
}

describe("one active session per campaign", () => {
  test("the migration keeps the newest and ends the rest", () => {
    const target = atInitialSchema();
    addActiveSession(target, "old", "2026-01-01T10:00:00.000Z");
    addActiveSession(target, "mid", "2026-01-01T11:00:00.000Z");
    addActiveSession(target, "new", "2026-01-01T12:00:00.000Z");

    expect(migrate(target)).toBe(1);

    const statuses = Object.fromEntries(
      target.query<{ id: string; status: string }, []>(
        "SELECT id, status FROM game_sessions",
      ).all().map((row) => [row.id, row.status]),
    );
    expect(statuses).toEqual({ old: "ended", mid: "ended", new: "active" });

    // Ended by the migration, so they carry the timestamp the app writes.
    const endedAt = target.query<{ ended_at: string | null }, []>(
      "SELECT ended_at FROM game_sessions WHERE id = 'old'",
    ).get()!.ended_at;
    expect(endedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  test("and then refuses a second one", () => {
    const target = atInitialSchema();
    addActiveSession(target, "only", "2026-01-01T10:00:00.000Z");
    migrate(target);

    expect(() => addActiveSession(target, "second", "2026-01-01T13:00:00.000Z"))
      .toThrow(/UNIQUE constraint/i);
  });

  test("a campaign that was already well behaved is left alone", () => {
    const target = atInitialSchema();
    addActiveSession(target, "only", "2026-01-01T10:00:00.000Z");
    migrate(target);

    const row = target.query<{ status: string; ended_at: string | null }, []>(
      "SELECT status, ended_at FROM game_sessions WHERE id = 'only'",
    ).get()!;
    expect(row).toEqual({ status: "active", ended_at: null });
  });
});
