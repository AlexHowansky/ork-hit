/**
 * Builds the snapshot that describes a session at a moment in time.
 *
 * Every mutation republishes this whole object rather than a diff. The lists are
 * a dozen rows at most, and sending the complete state means a client can never
 * end up merging updates in the wrong order — a reorder racing a turn change
 * cannot leave someone highlighting the wrong row.
 */

import { db } from "../db/index.ts";
import { gameSessions, players, sessionCharacters } from "../db/queries.ts";
import { presentCharacter, presentPlayer } from "./presenters.ts";

export interface SessionSnapshot {
  session: {
    id: string;
    status: string;
    round: number;
    activeCharacterId: string | null;
  };
  players: ReturnType<typeof presentPlayer>[];
  /** Active characters, already sorted into initiative order. */
  characters: (ReturnType<typeof presentCharacter> & {
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
      activeCharacterId: session.active_character_id,
    },
    players: roster.map(presentPlayer),
    characters: sessionCharacters.list(sessionId).map((character) => {
      const holder = claims.get(character.id) ?? null;
      return {
        ...presentCharacter(character),
        position: character.position,
        claimedByPlayerId: holder?.id ?? null,
        claimedByPlayerName: holder?.name ?? null,
      };
    }),
  };
}

/** The active sessions a character currently appears in. */
export function sessionIdsWith(characterId: string): string[] {
  return db.query<{ game_session_id: string }, { characterId: string }>(`
    SELECT sc.game_session_id
    FROM session_characters sc
    JOIN game_sessions gs ON gs.id = sc.game_session_id
    WHERE sc.character_id = $characterId AND gs.status = 'active'
  `).all({ characterId }).map((row) => row.game_session_id);
}
