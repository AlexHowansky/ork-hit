/**
 * Every SQL statement in the application lives here.
 *
 * Keeping them in one module means the parameterisation can be audited in one
 * place: there is no string interpolation into SQL anywhere in this file, and no
 * other module builds SQL of its own.
 */

import { db, fromNow, now } from "./index.ts";
import { limits } from "../lib/config.ts";
import { newId } from "../lib/ids.ts";
import type {
  CampaignRow,
  CharacterKind,
  CharacterRow,
  GameSessionRow,
  GmAuthSessionRow,
  GmRow,
  PlayerRow,
  SessionCharacterRow,
  UploadKind,
  UploadRow,
} from "./types.ts";

/* ---------------------------------------------------------------- game masters */

export const gms = {
  byEmail(email: string): GmRow | null {
    return db.query<GmRow, { email: string }>("SELECT * FROM gms WHERE email = $email")
      .get({ email });
  },

  byId(id: string): GmRow | null {
    return db.query<GmRow, { id: string }>("SELECT * FROM gms WHERE id = $id").get({ id });
  },

  all(): GmRow[] {
    return db.query<GmRow, []>("SELECT * FROM gms ORDER BY email").all();
  },

  create(email: string, passwordHash: string): GmRow {
    const timestamp = now();
    const id = newId();
    db.query(`
      INSERT INTO gms (id, email, password_hash, created_at, updated_at)
      VALUES ($id, $email, $passwordHash, $timestamp, $timestamp)
    `).run({ id, email, passwordHash, timestamp });
    return gms.byId(id)!;
  },

  update(id: string, changes: { email?: string; passwordHash?: string }): void {
    if (changes.email !== undefined) {
      db.query("UPDATE gms SET email = $email, updated_at = $ts WHERE id = $id")
        .run({ id, email: changes.email, ts: now() });
    }
    if (changes.passwordHash !== undefined) {
      db.query("UPDATE gms SET password_hash = $hash, updated_at = $ts WHERE id = $id")
        .run({ id, hash: changes.passwordHash, ts: now() });
      // A password change invalidates every existing browser session.
      db.query("DELETE FROM gm_auth_sessions WHERE gm_id = $id").run({ id });
    }
  },

  remove(id: string): void {
    db.query("DELETE FROM gms WHERE id = $id").run({ id });
  },
};

/* -------------------------------------------------------------- gm auth sessions */

export const gmAuthSessions = {
  create(gmId: string, tokenHash: string): GmAuthSessionRow {
    const id = newId();
    const timestamp = now();
    db.query(`
      INSERT INTO gm_auth_sessions
        (id, gm_id, token_hash, created_at, expires_at, absolute_expires_at, last_seen_at)
      VALUES ($id, $gmId, $tokenHash, $ts, $expires, $absolute, $ts)
    `).run({
      id,
      gmId,
      tokenHash,
      ts: timestamp,
      expires: fromNow(limits.gmSessionTtlMs),
      absolute: fromNow(limits.gmSessionMaxMs),
    });
    return db.query<GmAuthSessionRow, { id: string }>(
      "SELECT * FROM gm_auth_sessions WHERE id = $id",
    ).get({ id })!;
  },

  /** Returns the GM behind a live token, or null if it is unknown or expired. */
  resolve(tokenHash: string): { session: GmAuthSessionRow; gm: GmRow } | null {
    const session = db.query<GmAuthSessionRow, { tokenHash: string; ts: string }>(`
      SELECT * FROM gm_auth_sessions
      WHERE token_hash = $tokenHash
        AND expires_at > $ts
        AND absolute_expires_at > $ts
    `).get({ tokenHash, ts: now() });
    if (!session) return null;
    const gm = gms.byId(session.gm_id);
    return gm ? { session, gm } : null;
  },

  /** Extends the sliding window, never past the absolute expiry. */
  touch(id: string): void {
    db.query(`
      UPDATE gm_auth_sessions
      SET last_seen_at = $ts,
          expires_at = MIN($slidingExpiry, absolute_expires_at)
      WHERE id = $id
    `).run({ id, ts: now(), slidingExpiry: fromNow(limits.gmSessionTtlMs) });
  },

  remove(tokenHash: string): void {
    db.query("DELETE FROM gm_auth_sessions WHERE token_hash = $tokenHash").run({ tokenHash });
  },

  /** Housekeeping: drop rows that can no longer authenticate anyone. */
  purgeExpired(): number {
    return db.query(
      "DELETE FROM gm_auth_sessions WHERE expires_at <= $ts OR absolute_expires_at <= $ts",
    ).run({ ts: now() }).changes;
  },
};

/* ------------------------------------------------------------------- uploads */

export const uploads = {
  create(input: {
    kind: UploadKind;
    diskPath: string;
    mime: string;
    byteSize: number;
    sha256: string;
    originalName: string;
  }): UploadRow {
    const id = newId();
    db.query(`
      INSERT INTO uploads (id, kind, disk_path, mime, byte_size, sha256, original_name, created_at)
      VALUES ($id, $kind, $diskPath, $mime, $byteSize, $sha256, $originalName, $ts)
    `).run({ ...input, id, ts: now() });
    return uploads.byId(id)!;
  },

  byId(id: string): UploadRow | null {
    return db.query<UploadRow, { id: string }>("SELECT * FROM uploads WHERE id = $id").get({ id });
  },

  remove(id: string): void {
    db.query("DELETE FROM uploads WHERE id = $id").run({ id });
  },

  /**
   * Upload rows that nothing references any more. The caller deletes the files
   * from disk and then removes these rows.
   */
  orphaned(): UploadRow[] {
    return db.query<UploadRow, []>(`
      SELECT * FROM uploads
      WHERE id NOT IN (SELECT background_upload_id FROM campaigns WHERE background_upload_id IS NOT NULL)
        AND id NOT IN (SELECT background_upload_id FROM characters WHERE background_upload_id IS NOT NULL)
        AND id NOT IN (SELECT sheet_upload_id FROM characters)
    `).all();
  },
};

/* ------------------------------------------------------------------ campaigns */

export const campaigns = {
  listForGm(gmId: string): CampaignRow[] {
    return db.query<CampaignRow, { gmId: string }>(
      "SELECT * FROM campaigns WHERE gm_id = $gmId ORDER BY name COLLATE NOCASE",
    ).all({ gmId });
  },

  byId(id: string): CampaignRow | null {
    return db.query<CampaignRow, { id: string }>("SELECT * FROM campaigns WHERE id = $id")
      .get({ id });
  },

  create(input: { gmId: string; name: string; backgroundUploadId: string | null }): CampaignRow {
    const id = newId();
    const timestamp = now();
    db.query(`
      INSERT INTO campaigns (id, gm_id, name, background_upload_id, created_at, updated_at)
      VALUES ($id, $gmId, $name, $backgroundUploadId, $timestamp, $timestamp)
    `).run({ ...input, id, timestamp });
    return campaigns.byId(id)!;
  },

  update(
    id: string,
    changes: { name?: string; backgroundUploadId?: string | null },
  ): CampaignRow | null {
    if (changes.name !== undefined) {
      db.query("UPDATE campaigns SET name = $name, updated_at = $ts WHERE id = $id")
        .run({ id, name: changes.name, ts: now() });
    }
    if (changes.backgroundUploadId !== undefined) {
      db.query(
        "UPDATE campaigns SET background_upload_id = $upload, updated_at = $ts WHERE id = $id",
      ).run({ id, upload: changes.backgroundUploadId, ts: now() });
    }
    return campaigns.byId(id);
  },

  remove(id: string): void {
    db.query("DELETE FROM campaigns WHERE id = $id").run({ id });
  },

  /** Whether another campaign already holds this name (names are globally unique). */
  nameTaken(name: string, exceptId?: string): boolean {
    const row = db.query<{ id: string }, { name: string; exceptId: string }>(
      "SELECT id FROM campaigns WHERE name = $name AND id != $exceptId",
    ).get({ name, exceptId: exceptId ?? "" });
    return row !== null;
  },
};

/* ----------------------------------------------------------------- characters */

export const characters = {
  listForGm(gmId: string, campaignId?: string): CharacterRow[] {
    if (campaignId) {
      return db.query<CharacterRow, { gmId: string; campaignId: string }>(`
        SELECT c.* FROM characters c
        JOIN campaigns cp ON cp.id = c.campaign_id
        WHERE cp.gm_id = $gmId AND c.campaign_id = $campaignId
        ORDER BY c.kind, c.name COLLATE NOCASE
      `).all({ gmId, campaignId });
    }
    return db.query<CharacterRow, { gmId: string }>(`
      SELECT c.* FROM characters c
      JOIN campaigns cp ON cp.id = c.campaign_id
      WHERE cp.gm_id = $gmId
      ORDER BY c.kind, c.name COLLATE NOCASE
    `).all({ gmId });
  },

  byId(id: string): CharacterRow | null {
    return db.query<CharacterRow, { id: string }>("SELECT * FROM characters WHERE id = $id")
      .get({ id });
  },

  create(input: {
    campaignId: string;
    kind: CharacterKind;
    name: string;
    sheetUploadId: string;
    backgroundUploadId: string | null;
  }): CharacterRow {
    const id = newId();
    const timestamp = now();
    db.query(`
      INSERT INTO characters
        (id, campaign_id, kind, name, sheet_upload_id, background_upload_id, created_at, updated_at)
      VALUES ($id, $campaignId, $kind, $name, $sheetUploadId, $backgroundUploadId, $timestamp, $timestamp)
    `).run({ ...input, id, timestamp });
    return characters.byId(id)!;
  },

  update(
    id: string,
    changes: {
      campaignId?: string;
      kind?: CharacterKind;
      name?: string;
      sheetUploadId?: string;
      backgroundUploadId?: string | null;
    },
  ): CharacterRow | null {
    // One fixed statement per column, rather than assembling a SET clause. It is
    // more lines, but it keeps the invariant for this whole file simple enough to
    // check at a glance: no SQL here is ever built by string concatenation.
    const ts = now();
    if (changes.campaignId !== undefined) {
      db.query("UPDATE characters SET campaign_id = $value, updated_at = $ts WHERE id = $id")
        .run({ id, ts, value: changes.campaignId });
    }
    if (changes.kind !== undefined) {
      db.query("UPDATE characters SET kind = $value, updated_at = $ts WHERE id = $id")
        .run({ id, ts, value: changes.kind });
    }
    if (changes.name !== undefined) {
      db.query("UPDATE characters SET name = $value, updated_at = $ts WHERE id = $id")
        .run({ id, ts, value: changes.name });
    }
    if (changes.sheetUploadId !== undefined) {
      db.query("UPDATE characters SET sheet_upload_id = $value, updated_at = $ts WHERE id = $id")
        .run({ id, ts, value: changes.sheetUploadId });
    }
    if (changes.backgroundUploadId !== undefined) {
      db.query("UPDATE characters SET background_upload_id = $value, updated_at = $ts WHERE id = $id")
        .run({ id, ts, value: changes.backgroundUploadId });
    }
    return characters.byId(id);
  },

  remove(id: string): void {
    db.query("DELETE FROM characters WHERE id = $id").run({ id });
  },

  nameTaken(campaignId: string, name: string, exceptId?: string): boolean {
    const row = db.query<{ id: string }, { campaignId: string; name: string; exceptId: string }>(`
      SELECT id FROM characters
      WHERE campaign_id = $campaignId AND name = $name AND id != $exceptId
    `).get({ campaignId, name, exceptId: exceptId ?? "" });
    return row !== null;
  },
};

/* -------------------------------------------------------------- game sessions */

export const gameSessions = {
  byId(id: string): GameSessionRow | null {
    return db.query<GameSessionRow, { id: string }>("SELECT * FROM game_sessions WHERE id = $id")
      .get({ id });
  },

  /** Only an active session resolves from a code; ending one revokes it. */
  activeByCode(code: string): GameSessionRow | null {
    return db.query<GameSessionRow, { code: string }>(
      "SELECT * FROM game_sessions WHERE code = $code AND status = 'active'",
    ).get({ code });
  },

  listForGm(gmId: string): GameSessionRow[] {
    return db.query<GameSessionRow, { gmId: string }>(
      "SELECT * FROM game_sessions WHERE gm_id = $gmId ORDER BY created_at DESC",
    ).all({ gmId });
  },

  create(input: { campaignId: string; gmId: string; code: string }): GameSessionRow {
    const id = newId();
    db.query(`
      INSERT INTO game_sessions (id, campaign_id, gm_id, code, status, round, created_at)
      VALUES ($id, $campaignId, $gmId, $code, 'active', 1, $ts)
    `).run({ ...input, id, ts: now() });
    return gameSessions.byId(id)!;
  },

  end(id: string): void {
    db.query(
      "UPDATE game_sessions SET status = 'ended', ended_at = $ts WHERE id = $id AND status = 'active'",
    ).run({ id, ts: now() });
  },

  setTurn(id: string, characterId: string | null, round: number): void {
    db.query(
      "UPDATE game_sessions SET active_character_id = $characterId, round = $round WHERE id = $id",
    ).run({ id, characterId, round });
  },
};

/* --------------------------------------------------------- session membership */

export const sessionCharacters = {
  /** Active characters in initiative order, joined with their library record. */
  list(sessionId: string): SessionCharacterRow[] {
    return db.query<SessionCharacterRow, { sessionId: string }>(`
      SELECT c.*, sc.position
      FROM session_characters sc
      JOIN characters c ON c.id = sc.character_id
      WHERE sc.game_session_id = $sessionId
      ORDER BY sc.position
    `).all({ sessionId });
  },

  isMember(sessionId: string, characterId: string): boolean {
    const row = db.query<{ character_id: string }, { sessionId: string; characterId: string }>(`
      SELECT character_id FROM session_characters
      WHERE game_session_id = $sessionId AND character_id = $characterId
    `).get({ sessionId, characterId });
    return row !== null;
  },

  /** Appends a character at the end of the initiative order. */
  add(sessionId: string, characterId: string): void {
    db.query(`
      INSERT INTO session_characters (game_session_id, character_id, position, added_at)
      VALUES (
        $sessionId,
        $characterId,
        COALESCE((SELECT MAX(position) + 1 FROM session_characters WHERE game_session_id = $sessionId), 0),
        $ts
      )
      ON CONFLICT (game_session_id, character_id) DO NOTHING
    `).run({ sessionId, characterId, ts: now() });
  },

  /**
   * Removes a character and closes the gap it leaves in the order, so positions
   * stay dense. Also releases any player claim on it, and clears the active turn
   * if it was that character's.
   */
  remove: db.transaction((sessionId: string, characterId: string) => {
    const removed = db.query<{ position: number }, { sessionId: string; characterId: string }>(`
      SELECT position FROM session_characters
      WHERE game_session_id = $sessionId AND character_id = $characterId
    `).get({ sessionId, characterId });
    if (!removed) return;

    db.query(
      "DELETE FROM session_characters WHERE game_session_id = $sessionId AND character_id = $characterId",
    ).run({ sessionId, characterId });

    db.query(`
      UPDATE session_characters SET position = position - 1
      WHERE game_session_id = $sessionId AND position > $position
    `).run({ sessionId, position: removed.position });

    db.query(`
      UPDATE players SET claimed_character_id = NULL
      WHERE game_session_id = $sessionId AND claimed_character_id = $characterId
    `).run({ sessionId, characterId });

    db.query(`
      UPDATE game_sessions SET active_character_id = NULL
      WHERE id = $sessionId AND active_character_id = $characterId
    `).run({ sessionId, characterId });
  }),

  /**
   * Rewrites the whole initiative order. The caller has already checked that
   * `orderedIds` is exactly the session's current membership.
   *
   * Positions are first pushed into a range that cannot collide with the final
   * one, then written down into 0..n-1. Without that two-pass approach an
   * intermediate state could momentarily duplicate a position.
   */
  reorder: db.transaction((sessionId: string, orderedIds: string[]) => {
    const offset = orderedIds.length + 1000;
    db.query(`
      UPDATE session_characters SET position = position + $offset
      WHERE game_session_id = $sessionId
    `).run({ sessionId, offset });

    const setPosition = db.query(`
      UPDATE session_characters SET position = $position
      WHERE game_session_id = $sessionId AND character_id = $characterId
    `);
    orderedIds.forEach((characterId, position) => {
      setPosition.run({ sessionId, characterId, position });
    });
  }),
};

/* ------------------------------------------------------------------- players */

export const players = {
  list(sessionId: string): PlayerRow[] {
    return db.query<PlayerRow, { sessionId: string }>(
      "SELECT * FROM players WHERE game_session_id = $sessionId ORDER BY joined_at",
    ).all({ sessionId });
  },

  byId(id: string): PlayerRow | null {
    return db.query<PlayerRow, { id: string }>("SELECT * FROM players WHERE id = $id").get({ id });
  },

  byTokenHash(tokenHash: string): PlayerRow | null {
    return db.query<PlayerRow, { tokenHash: string }>(
      "SELECT * FROM players WHERE token_hash = $tokenHash",
    ).get({ tokenHash });
  },

  nameTaken(sessionId: string, name: string): boolean {
    const row = db.query<{ id: string }, { sessionId: string; name: string }>(
      "SELECT id FROM players WHERE game_session_id = $sessionId AND name = $name",
    ).get({ sessionId, name });
    return row !== null;
  },

  create(input: { sessionId: string; name: string; tokenHash: string }): PlayerRow {
    const id = newId();
    db.query(`
      INSERT INTO players (id, game_session_id, name, token_hash, joined_at)
      VALUES ($id, $sessionId, $name, $tokenHash, $ts)
    `).run({ ...input, id, ts: now() });
    return players.byId(id)!;
  },

  setClaim(id: string, characterId: string | null): void {
    db.query("UPDATE players SET claimed_character_id = $characterId WHERE id = $id")
      .run({ id, characterId });
  },

  remove(id: string): void {
    db.query("DELETE FROM players WHERE id = $id").run({ id });
  },

  /** The player holding a character in a session, if any. */
  holderOf(sessionId: string, characterId: string): PlayerRow | null {
    return db.query<PlayerRow, { sessionId: string; characterId: string }>(`
      SELECT * FROM players
      WHERE game_session_id = $sessionId AND claimed_character_id = $characterId
    `).get({ sessionId, characterId });
  },
};
