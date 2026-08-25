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

    expect(migrate(target)).toBe(3);

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

describe("copies of an NPC on the stage", () => {
  test("the stage is rebuilt with a slot id and a copy number", () => {
    const target = atInitialSchema();
    addActiveSession(target, "only", "2026-01-01T10:00:00.000Z");
    migrate(target);

    const columns = target.query<{ name: string }, []>(
      "SELECT name FROM pragma_table_info('session_characters')",
    ).all().map((row) => row.name);
    expect(columns).toContain("id");
    expect(columns).toContain("copy_number");

    // The turn marker moved off the character and onto the slot.
    const sessionColumns = target.query<{ name: string }, []>(
      "SELECT name FROM pragma_table_info('game_sessions')",
    ).all().map((row) => row.name);
    expect(sessionColumns).toContain("active_slot_id");
    expect(sessionColumns).not.toContain("active_character_id");
  });

  test("the same character can now be on the stage twice", () => {
    const target = atInitialSchema();
    addActiveSession(target, "only", "2026-01-01T10:00:00.000Z");
    migrate(target);

    target.exec(`
      INSERT INTO uploads
        (id, kind, disk_path, mime, byte_size, sha256, original_name, created_at)
        VALUES ('u1', 'sheet', 'p', 'text/html', 1, 'x', 'sheet.html', '2026-01-01T00:00:00.000Z');
      INSERT INTO characters (id, campaign_id, kind, name, sheet_upload_id, created_at, updated_at)
        VALUES ('goblin', 'c1', 'npc', 'Goblin', 'u1', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
    `);

    const add = (id: string, copy: number, position: number) =>
      target.query(`
        INSERT INTO session_characters
          (id, game_session_id, character_id, copy_number, position, added_at)
        VALUES ($id, 'only', 'goblin', $copy, $position, '2026-01-01T00:00:00.000Z')
      `).run({ id, copy, position });

    // Two rows naming one character: the pair that used to be the primary key.
    add("s1", 1, 0);
    expect(() => add("s2", 2, 1)).not.toThrow();

    expect(
      target.query<{ n: number }, []>(
        "SELECT COUNT(*) AS n FROM session_characters WHERE character_id = 'goblin'",
      ).get()!.n,
    ).toBe(2);
  });
});

describe("HERO characteristics", () => {
  test("a character from before the migration reads as zeros, not nulls", () => {
    const target = atInitialSchema();
    target.exec(`
      INSERT INTO uploads
        (id, kind, disk_path, mime, byte_size, sha256, original_name, created_at)
        VALUES ('u1', 'sheet', 'p', 'text/html', 1, 'x', 'sheet.html', '2026-01-01T00:00:00.000Z');
      INSERT INTO characters (id, campaign_id, kind, name, sheet_upload_id, created_at, updated_at)
        VALUES ('old', 'c1', 'pc', 'Thorin', 'u1', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
    `);

    migrate(target);

    expect(
      target.query<Record<string, number>, []>(
        "SELECT speed, dexterity, recovery, endurance, stun, body FROM characters WHERE id = 'old'",
      ).get(),
    ).toEqual({ speed: 0, dexterity: 0, recovery: 0, endurance: 0, stun: 0, body: 0 });
  });
});
