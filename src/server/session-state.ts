/**
 * Builds the snapshot that describes a session at a moment in time.
 *
 * Every mutation republishes this whole object rather than a diff. The lists are
 * a dozen rows at most, and sending the complete state means a client can never
 * end up merging updates in the wrong order — a reorder racing a turn change
 * cannot leave someone highlighting the wrong row.
 */

import { db } from "../db/index.ts";
import { campaigns, gameSessions, players, sessionCharacters } from "../db/queries.ts";
import { presentCharacter, presentPlayer, presentSessionForGm } from "./presenters.ts";

export interface SessionSnapshot {
  session: {
    id: string;
    status: string;
    round: number;
    /** The stage slot whose turn it is — not a character; one may fill two slots. */
    activeSlotId: string | null;
  };
  players: ReturnType<typeof presentPlayer>[];
  /**
   * The stage, already sorted into initiative order.
   *
   * `id` is the **slot**, because the slot is what this is a list of: it is the
   * React key, the drag id, and what a reorder, a turn or a removal names. The
   * character standing in it is `characterId`, which is what a claim and a sheet
   * are about. Keeping `id` on the slot is what lets every id-keyed thing on the
   * client stay as it was and simply mean the right thing now.
   */
  characters: (ReturnType<typeof presentCharacter> & {
    characterId: string;
    copyNumber: number;
    position: number;
    claimedByPlayerId: string | null;
    claimedByPlayerName: string | null;
  })[];
}

export function buildSnapshot(sessionId: string): SessionSnapshot | null {
  const session = gameSessions.byId(sessionId);
  if (!session) return null;

  const roster = players.list(sessionId);
  const claims = new Map(
    roster
      .filter((player) => player.claimed_character_id !== null)
      .map((player) => [player.claimed_character_id!, player]),
  );

  return {
    session: {
      id: session.id,
      status: session.status,
      round: session.round,
      activeSlotId: session.active_slot_id,
    },
    players: roster.map(presentPlayer),
    characters: sessionCharacters.list(sessionId).map((row) => {
      // `presented.id` and `presented.sheetUrl` are both the character's; only
      // the outer `id` moves to the slot.
      const presented = presentCharacter(row);
      const holder = claims.get(presented.id) ?? null;
      return {
        ...presented,
        id: row.slot_id,
        characterId: presented.id,
        copyNumber: row.copy_number,
        position: row.position,
        claimedByPlayerId: holder?.id ?? null,
        claimedByPlayerName: holder?.name ?? null,
      };
    }),
  };
}

/**
 * Every session belonging to a game master, as their library lists them.
 *
 * This is what `GET /api/sessions` answers with and what is published to the
 * library socket when a session starts or ends, so a list that arrived over the
 * socket is indistinguishable from one that was fetched. A session whose campaign
 * has been deleted is left out rather than listed with no name.
 */
export function buildGmSessionList(gmId: string): ReturnType<typeof presentSessionForGm>[] {
  const counts = players.countsForGm(gmId);
  return gameSessions.listForGm(gmId).flatMap((session) => {
    const campaign = campaigns.byId(session.campaign_id);
    return campaign ? [presentSessionForGm(session, campaign, counts.get(session.id) ?? 0)] : [];
  });
}

/** The active sessions a character currently appears in. */
export function sessionIdsWith(characterId: string): string[] {
  return db.query<{ game_session_id: string }, { characterId: string }>(`
    SELECT DISTINCT sc.game_session_id
    FROM session_characters sc
    JOIN game_sessions gs ON gs.id = sc.game_session_id
    WHERE sc.character_id = $characterId AND gs.status = 'active'
  `).all({ characterId }).map((row) => row.game_session_id);
}
