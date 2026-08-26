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

/**
 * The HERO System characteristics a library character carries.
 *
 * Named once here because three places speak in them: creating a character,
 * editing one, and seeding a stage slot from the totals.
 */
export interface HeroStats {
  speed: number;
  dexterity: number;
  initiative: number;
  recovery: number;
  endurance: number;
  stun: number;
  body: number;
}

/** Fills in the zero the column would have defaulted to, for a partial set. */
function zeroedStats(stats: Partial<HeroStats> | undefined): HeroStats {
  return {
    speed: stats?.speed ?? 0,
    dexterity: stats?.dexterity ?? 0,
    initiative: stats?.initiative ?? 0,
    recovery: stats?.recovery ?? 0,
    endurance: stats?.endurance ?? 0,
    stun: stats?.stun ?? 0,
    body: stats?.body ?? 0,
  };
}

export const characters = {
  /**
   * The library, in name order.
   *
   * By name alone rather than by kind first: the cards carry a badge saying which
   * is which, so grouping them only made a character harder to find by the one
   * thing the reader knows about it.
   */
  listForGm(gmId: string, campaignId?: string): CharacterRow[] {
    if (campaignId) {
      return db.query<CharacterRow, { gmId: string; campaignId: string }>(`
        SELECT c.* FROM characters c
        JOIN campaigns cp ON cp.id = c.campaign_id
        WHERE cp.gm_id = $gmId AND c.campaign_id = $campaignId
        ORDER BY c.name COLLATE NOCASE
      `).all({ gmId, campaignId });
    }
    return db.query<CharacterRow, { gmId: string }>(`
      SELECT c.* FROM characters c
      JOIN campaigns cp ON cp.id = c.campaign_id
      WHERE cp.gm_id = $gmId
      ORDER BY c.name COLLATE NOCASE
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
    /** The HERO characteristics, each defaulting to the zero the column carries. */
    stats?: Partial<HeroStats>;
  }): CharacterRow {
    const id = newId();
    const timestamp = now();
    const { stats, ...rest } = input;
    db.query(`
      INSERT INTO characters
        (id, campaign_id, kind, name, sheet_upload_id, background_upload_id,
         speed, dexterity, initiative, recovery, endurance, stun, body,
         created_at, updated_at)
      VALUES ($id, $campaignId, $kind, $name, $sheetUploadId, $backgroundUploadId,
         $speed, $dexterity, $initiative, $recovery, $endurance, $stun, $body,
         $timestamp, $timestamp)
    `).run({ ...rest, ...zeroedStats(stats), id, timestamp });
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
    } & Partial<HeroStats>,
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
    // The characteristics take the same one-statement-per-column shape, written
    // out rather than looped so the SQL above stays literal top to bottom.
    if (changes.speed !== undefined) {
      db.query("UPDATE characters SET speed = $value, updated_at = $ts WHERE id = $id")
        .run({ id, ts, value: changes.speed });
    }
    if (changes.dexterity !== undefined) {
      db.query("UPDATE characters SET dexterity = $value, updated_at = $ts WHERE id = $id")
        .run({ id, ts, value: changes.dexterity });
    }
    if (changes.initiative !== undefined) {
      db.query("UPDATE characters SET initiative = $value, updated_at = $ts WHERE id = $id")
        .run({ id, ts, value: changes.initiative });
    }
    if (changes.recovery !== undefined) {
      db.query("UPDATE characters SET recovery = $value, updated_at = $ts WHERE id = $id")
        .run({ id, ts, value: changes.recovery });
    }
    if (changes.endurance !== undefined) {
      db.query("UPDATE characters SET endurance = $value, updated_at = $ts WHERE id = $id")
        .run({ id, ts, value: changes.endurance });
    }
    if (changes.stun !== undefined) {
      db.query("UPDATE characters SET stun = $value, updated_at = $ts WHERE id = $id")
        .run({ id, ts, value: changes.stun });
    }
    if (changes.body !== undefined) {
      db.query("UPDATE characters SET body = $value, updated_at = $ts WHERE id = $id")
        .run({ id, ts, value: changes.body });
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

  /**
   * The campaign's running session, if it has one.
   *
   * A campaign runs one session at a time — enforced by a partial unique index,
   * so this can never be the first of several.
   */
  activeForCampaign(campaignId: string): GameSessionRow | null {
    return db.query<GameSessionRow, { campaignId: string }>(
      "SELECT * FROM game_sessions WHERE campaign_id = $campaignId AND status = 'active'",
    ).get({ campaignId });
  },

  /**
   * The game master's sessions, by campaign name.
   *
   * A session is only ever named after its campaign on screen, so that is what
   * the reader scans for; ordering by age instead made a list of them shuffle
   * itself every time one was started. Campaign names are unique per game
   * master, and a campaign runs one session at a time, so the name settles the
   * order on its own — `created_at` only breaks the tie between an ended session
   * and a later one on the same campaign.
   */
  listForGm(gmId: string): GameSessionRow[] {
    return db.query<GameSessionRow, { gmId: string }>(`
      SELECT s.* FROM game_sessions s
      JOIN campaigns cp ON cp.id = s.campaign_id
      WHERE s.gm_id = $gmId
      ORDER BY cp.name COLLATE NOCASE, s.created_at DESC
    `).all({ gmId });
  },

  create(input: { campaignId: string; gmId: string; code: string }): GameSessionRow {
    const id = newId();
    db.query(`
      INSERT INTO game_sessions (id, campaign_id, gm_id, code, status, turn, segment, created_at)
      VALUES ($id, $campaignId, $gmId, $code, 'active', 1, 12, $ts)
    `).run({ ...input, id, ts: now() });
    return gameSessions.byId(id)!;
  },

  end(id: string): void {
    db.query(
      "UPDATE game_sessions SET status = 'ended', ended_at = $ts WHERE id = $id AND status = 'active'",
    ).run({ id, ts: now() });
  },

  /**
   * Points the turn marker at a stage slot, or nowhere, and says where on the
   * clock that is.
   *
   * The three move together because they are one position: a slot without the
   * turn and segment it was reached on is not a place in the fight, and writing
   * them separately would let a broadcast catch the pair half updated.
   */
  setTurn(id: string, slotId: string | null, turn: number, segment: number): void {
    db.query(
      "UPDATE game_sessions SET active_slot_id = $slotId, turn = $turn, segment = $segment WHERE id = $id",
    ).run({ id, slotId, turn, segment });
  },
};

/* --------------------------------------------------------- session membership */

export const sessionCharacters = {
  /**
   * The stage in initiative order, each slot joined with the character in it.
   *
   * The order is derived rather than stored: HERO runs a segment in DEX order,
   * plus whatever INITIATIVE bonus the sheet carries, highest first. Sorting
   * here rather than writing positions when a character walks on means the list
   * is right the moment a DEX is edited, and there is nowhere for a stored order
   * to drift out of agreement with the characteristics it was built from.
   *
   * `position` survives only as the tiebreak: two characters on the same DEX+INIT
   * go in the order they came on stage, which is stable and is at least a reason.
   */
  list(sessionId: string): SessionCharacterRow[] {
    return db.query<SessionCharacterRow, { sessionId: string }>(`
      SELECT c.*, sc.id AS slot_id, sc.copy_number, sc.position,
             sc.cur_endurance AS cur_endurance, sc.cur_stun AS cur_stun, sc.cur_body AS cur_body
      FROM session_characters sc
      JOIN characters c ON c.id = sc.character_id
      WHERE sc.game_session_id = $sessionId
      ORDER BY (c.dexterity + c.initiative) DESC, sc.position
    `).all({ sessionId });
  },

  /**
   * Whether this character is on the stage at all, in any number of copies.
   *
   * The question the claim paths ask, since a player claims a character rather
   * than one of its slots — and only PCs can be claimed, which never have more
   * than one. Turn-setting asks `slotExists` instead.
   */
  isMember(sessionId: string, characterId: string): boolean {
    const row = db.query<{ character_id: string }, { sessionId: string; characterId: string }>(`
      SELECT character_id FROM session_characters
      WHERE game_session_id = $sessionId AND character_id = $characterId
    `).get({ sessionId, characterId });
    return row !== null;
  },

  /** Whether this slot is one of the session's. */
  slotExists(sessionId: string, slotId: string): boolean {
    const row = db.query<{ id: string }, { sessionId: string; slotId: string }>(
      "SELECT id FROM session_characters WHERE game_session_id = $sessionId AND id = $slotId",
    ).get({ sessionId, slotId });
    return row !== null;
  },

  /**
   * Which character is standing in a slot.
   *
   * What a player's edit is checked against: they may spend their own
   * character's ENDURANCE and take their own STUN, and nobody else's.
   */
  characterInSlot(sessionId: string, slotId: string): string | null {
    const row = db.query<{ character_id: string }, { sessionId: string; slotId: string }>(
      "SELECT character_id FROM session_characters WHERE game_session_id = $sessionId AND id = $slotId",
    ).get({ sessionId, slotId });
    return row?.character_id ?? null;
  },

  /**
   * A Recovery: the character catches their breath, and gets their RECOVERY back
   * in both ENDURANCE and STUN.
   *
   * Neither goes over the character's total, and neither goes down — a slot
   * already above its total (a temporary boost, say) keeps what it has rather
   * than being trimmed to the maximum by a breather. The arithmetic is done in
   * the statement rather than read out and written back, so two people pressing
   * it at once cannot lose one of the two Recoveries.
   */
  takeRecovery(sessionId: string, slotId: string): void {
    db.query(`
      UPDATE session_characters SET
        cur_endurance = MAX(
          cur_endurance,
          MIN(
            (SELECT endurance FROM characters WHERE id = character_id),
            cur_endurance + (SELECT recovery FROM characters WHERE id = character_id)
          )
        ),
        cur_stun = MAX(
          cur_stun,
          MIN(
            (SELECT stun FROM characters WHERE id = character_id),
            cur_stun + (SELECT recovery FROM characters WHERE id = character_id)
          )
        )
      WHERE game_session_id = $sessionId AND id = $slotId
    `).run({ sessionId, slotId });
  },

  /**
   * A rest: back to full ENDURANCE and STUN.
   *
   * Set to the character's totals rather than raised towards them — a night's
   * sleep is the end of the bookkeeping for a fight, so a slot left above its
   * total by some temporary boost comes back to what the character actually is.
   * BODY is untouched: in HERO that heals over days, not overnight, and putting
   * it here would quietly undo a wound the game master is still tracking.
   */
  takeRest(sessionId: string, slotId: string): void {
    db.query(`
      UPDATE session_characters SET
        cur_endurance = (SELECT endurance FROM characters WHERE id = character_id),
        cur_stun = (SELECT stun FROM characters WHERE id = character_id)
      WHERE game_session_id = $sessionId AND id = $slotId
    `).run({ sessionId, slotId });
  },

  /**
   * Writes what a slot has left. Absent values are left as they were, so a
   * screen that edits one box does not have to send the other two.
   *
   * One fixed statement per column, as everywhere else in this file.
   */
  setVitals(
    sessionId: string,
    slotId: string,
    values: { endurance?: number; stun?: number; body?: number },
  ): void {
    if (values.endurance !== undefined) {
      db.query(`
        UPDATE session_characters SET cur_endurance = $value
        WHERE game_session_id = $sessionId AND id = $slotId
      `).run({ sessionId, slotId, value: values.endurance });
    }
    if (values.stun !== undefined) {
      db.query(`
        UPDATE session_characters SET cur_stun = $value
        WHERE game_session_id = $sessionId AND id = $slotId
      `).run({ sessionId, slotId, value: values.stun });
    }
    if (values.body !== undefined) {
      db.query(`
        UPDATE session_characters SET cur_body = $value
        WHERE game_session_id = $sessionId AND id = $slotId
      `).run({ sessionId, slotId, value: values.body });
    }
  },

  /**
   * Puts every player character in the campaign into the session at once.
   *
   * A session all but always opens with the whole party present, so the game
   * master shouldn't have to add them one at a time before the first turn. NPCs
   * stay out — they arrive when the scene calls for them. Ordered by name and
   * appended after anything already in the session: the initiative order is
   * derived from SPD and DEX+INIT by `list`, so `position` is only the tiebreak
   * between equal characters, and by name is a defensible way to settle it.
   * Anyone already there is filtered out rather than left to
   * `ON CONFLICT`, because a skipped row would leave a hole in the positions,
   * which the rest of the code takes to be dense.
   */
  addCampaignPcs(sessionId: string, campaignId: string): void {
    db.query(`
      INSERT INTO session_characters
        (id, game_session_id, character_id, copy_number, position, added_at,
         cur_endurance, cur_stun, cur_body)
      SELECT
        lower(hex(randomblob(16))),
        $sessionId,
        c.id,
        1,
        COALESCE(
          (SELECT MAX(position) + 1 FROM session_characters WHERE game_session_id = $sessionId),
          0
        ) + ROW_NUMBER() OVER (ORDER BY c.name COLLATE NOCASE) - 1,
        $ts,
        c.endurance, c.stun, c.body
      FROM characters c
      WHERE c.campaign_id = $campaignId
        AND c.kind = 'pc'
        AND c.id NOT IN (
          SELECT character_id FROM session_characters WHERE game_session_id = $sessionId
        )
    `).run({ sessionId, campaignId, ts: now() });
  },

  /**
   * Brings a copy of a character on stage.
   *
   * It takes the next `position`, which is not where it lands in the initiative
   * order — `list` derives that from SPD and DEX+INIT — but only its place in
   * the queue of arrivals, used to break a tie with someone on the same DEX+INIT.
   *
   * An NPC can be added over and over — that is the point, a fight has more than
   * one goblin — and each add is a slot of its own with its own turn. A PC is
   * added at most once: a second copy would give one player two seats and break
   * the one-claim-per-character rule the players table enforces, and there is no
   * reading of a party where two of the same hero turn up.
   *
   * The copy number is one more than the highest this session has ever used for
   * that character, not one more than the count. Removing Goblin 2 leaves 1 and
   * 3, and the next add is 4 — so a number, once given, keeps naming the same
   * monster for the whole fight, which is what someone tracking its wounds on
   * paper needs.
   *
   * Returns the new slot, or `null` when a PC was already there.
   */
  add(sessionId: string, characterId: string, kind: CharacterKind): string | null {
    if (kind === "pc" && sessionCharacters.isMember(sessionId, characterId)) return null;

    const id = newId();
    db.query(`
      INSERT INTO session_characters
        (id, game_session_id, character_id, copy_number, position, added_at,
         cur_endurance, cur_stun, cur_body)
      VALUES (
        $id,
        $sessionId,
        $characterId,
        COALESCE((
          SELECT MAX(copy_number) + 1 FROM session_characters
          WHERE game_session_id = $sessionId AND character_id = $characterId
        ), 1),
        COALESCE((SELECT MAX(position) + 1 FROM session_characters WHERE game_session_id = $sessionId), 0),
        $ts,
        (SELECT endurance FROM characters WHERE id = $characterId),
        (SELECT stun FROM characters WHERE id = $characterId),
        (SELECT body FROM characters WHERE id = $characterId)
      )
    `).run({ id, sessionId, characterId, ts: now() });
    return id;
  },

  /**
   * Takes one slot off the stage and closes the gap it leaves in the order, so
   * positions stay dense. Also clears the turn marker if it was pointing here,
   * and releases any player claim on the character that was standing in it.
   *
   * Everything is keyed on the slot rather than the character: removing one
   * goblin must not take its twin with it. The claim release is the exception —
   * it stays character-keyed, which is still right because only PCs are
   * claimable and a PC never has a second slot to go on holding the claim.
   */
  remove: db.transaction((sessionId: string, slotId: string) => {
    const removed = db.query<
      { position: number; character_id: string },
      { sessionId: string; slotId: string }
    >(`
      SELECT position, character_id FROM session_characters
      WHERE game_session_id = $sessionId AND id = $slotId
    `).get({ sessionId, slotId });
    if (!removed) return;

    db.query(
      "DELETE FROM session_characters WHERE game_session_id = $sessionId AND id = $slotId",
    ).run({ sessionId, slotId });

    db.query(`
      UPDATE session_characters SET position = position - 1
      WHERE game_session_id = $sessionId AND position > $position
    `).run({ sessionId, position: removed.position });

    db.query(`
      UPDATE players SET claimed_character_id = NULL
      WHERE game_session_id = $sessionId AND claimed_character_id = $characterId
    `).run({ sessionId, characterId: removed.character_id });

    db.query(
      "UPDATE game_sessions SET active_slot_id = NULL WHERE id = $sessionId AND active_slot_id = $slotId",
    ).run({ sessionId, slotId });
  }),
};

/* ------------------------------------------------------------------- players */

export const players = {
  list(sessionId: string): PlayerRow[] {
    return db.query<PlayerRow, { sessionId: string }>(
      "SELECT * FROM players WHERE game_session_id = $sessionId ORDER BY joined_at",
    ).all({ sessionId });
  },

  /**
   * How many players are in each of a game master's sessions.
   *
   * One grouped query rather than a count per row, so the library page costs the
   * same whether the game master has two sessions behind them or two hundred.
   * Sessions nobody has joined are absent, so read a missing key as zero.
   */
  countsForGm(gmId: string): Map<string, number> {
    const rows = db.query<{ sessionId: string; total: number }, { gmId: string }>(`
      SELECT p.game_session_id AS sessionId, COUNT(*) AS total
      FROM players p
      JOIN game_sessions s ON s.id = p.game_session_id
      WHERE s.gm_id = $gmId
      GROUP BY p.game_session_id
    `).all({ gmId });
    return new Map(rows.map((row) => [row.sessionId, row.total]));
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
