/**
 * Forward-only migration runner.
 *
 * Migrations are `.sql` files in ./migrations, applied in filename order and
 * recorded in `schema_migrations` so each runs exactly once. Each file is applied
 * inside a transaction, so a failure leaves the database on the previous version.
 */

import { Database } from "bun:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { db, now } from "./index.ts";
import { log } from "../lib/log.ts";

const MIGRATIONS_DIR = join(import.meta.dir, "migrations");

export function migrate(target: Database = db): number {
  target.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name       TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    )
  `);

  const applied = new Set(
    target.query<{ name: string }, []>("SELECT name FROM schema_migrations").all()
      .map((row) => row.name),
  );

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith(".sql"))
    .sort();

  let count = 0;
  for (const file of files) {
    if (applied.has(file)) continue;
    const contents = readFileSync(join(MIGRATIONS_DIR, file), "utf8");

    const run = target.transaction(() => {
      target.exec(contents);
      target
        .query("INSERT INTO schema_migrations (name, applied_at) VALUES ($name, $appliedAt)")
        .run({ name: file, appliedAt: now() });
    });
    run();

    log.info("migration applied", { migration: file });
    count += 1;
  }

  if (count === 0) log.info("database is up to date");
  return count;
}

if (import.meta.main) {
  const count = migrate();
  console.log(count === 0 ? "Database is already up to date." : `Applied ${count} migration(s).`);
}
