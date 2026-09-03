/**
 * Builds the snapshot that describes a session at a moment in time.
 *
 * Every mutation republishes this whole object rather than a diff. The lists are
 * a dozen rows at most, and sending the complete state means a client can never
 * end up merging updates in the wrong order — a reorder racing a turn change
 * cannot leave someone highlighting the wrong row.
 */

import { db } from "../db/index.ts";
import { campaigns, gameSessions, players, sessionCharacters, sessionEvents } from "../db/queries.ts";
import { presentCharacter, presentPlayer, presentSessionForGm } from "./presenters.ts";

export interface SessionSnapshot {
  session: {
    id: string;
    status: string;
    /** How many HERO Turns of twelve segments the fight has reached. */
    turn: number;
    /**
     * Which of those twelve segments it is on.
     *
     * Always 1–12, and a fight that has not begun sits on 12 with no active
     * slot, because HERO opens combat on Segment 12 rather than Segment 1.
     */
    segment: number;
    /**
     * What the players call the game they are in. The campaign's name rather
     * than the session's, because a session has no name of its own — and it is
     * what heads a player's screen, who otherwise has nothing on the page
     * saying which table this is.
     */
    campaignName: string;
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
    /**
     * What this slot has left, as against the totals the character carries.
     * Per slot rather than per character: two goblins take their own wounds.
     */
    currentEndurance: number;
    currentStun: number;
    currentBody: number;
    /**
     * What condition this copy is in: the tags the app knows by name, then any
     * the table typed for itself. Per slot, like the numbers above — one goblin
     * can be prone while its twin is standing — and always a list, empty rather
     * than absent when there is nothing on them.
     */
    statusTags: string[];
    /**
     * Whether this copy is holding its action, waiting to cut back into the
     * order. Per slot like the rest of them, and on the wire because both
     * screens draw it: the console's control, and the badge every reader sees.
     */
    isHeld: boolean;
    claimedByPlayerId: string | null;
    claimedByPlayerName: string | null;
  })[];
  /**
   * The log: what has happened at this table, oldest first.
   *
   * State rather than a notice, and that is the whole distinction. A notice is a
   * toast about something the table has already moved on from, so a client that
   * reconnects is deliberately not told about it again. The log is a history, and
   * a reconnecting screen must get all of it back — which is also the only way
   * anybody ever sees the first line, since a session is started before there is
   * a screen watching it.
   *
   * Only the tail; see `LOG_LIMIT` in queries.ts for why the wire is bounded
   * where the table is not.
   */
  events: { id: string; message: string; at: string }[];
}

export function buildSnapshot(sessionId: string): SessionSnapshot | null {
  const session = gameSessions.byId(sessionId);
  if (!session) return null;

  const roster = players.list(sessionId);
  const tags = sessionCharacters.tags(sessionId);
  const claims = new Map(
    roster
      .filter((player) => player.claimed_character_id !== null)
      .map((player) => [player.claimed_character_id!, player]),
  );

  return {
    session: {
      id: session.id,
      status: session.status,
      turn: session.turn,
      segment: session.segment,
      campaignName: campaigns.byId(session.campaign_id)?.name ?? "",
      activeSlotId: session.active_slot_id,
    },
    players: roster.map(presentPlayer),
    events: sessionEvents.list(sessionId).map((row) => ({
      id: row.id,
      message: row.message,
      // Sent as the ISO instant it was written. What o'clock that is belongs to
      // the reader's own machine, which is the only thing that knows what time
      // zone they are sitting in.
      at: row.created_at,
    })),
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
        currentEndurance: row.cur_endurance,
        currentStun: row.cur_stun,
        currentBody: row.cur_body,
        statusTags: tags.get(row.slot_id) ?? [],
        isHeld: row.held === 1,
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
