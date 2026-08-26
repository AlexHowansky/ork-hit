/** Shapes returned by the API, mirroring src/server/presenters.ts. */

export type CharacterKind = "pc" | "npc";

export interface Campaign {
  id: string;
  name: string;
  backgroundUrl: string | null;
  createdAt: string;
}

export interface Character {
  id: string;
  campaignId: string;
  kind: CharacterKind;
  name: string;
  sheetUrl: string;
  backgroundUrl: string | null;
  /**
   * The HERO System characteristics. `endurance`, `stun` and `body` are the
   * character's full totals; what one copy of them has left in a session is on
   * `SessionCharacter` instead.
   */
  speed: number;
  dexterity: number;
  initiative: number;
  recovery: number;
  endurance: number;
  stun: number;
  body: number;
}

/**
 * A slot on the stage.
 *
 * `id` is the slot, not the character: it is the React key, and what a turn or a
 * removal names. The character in it is `characterId` —
 * what a claim is about, and what two copies of one NPC share. `sheetUrl` is the
 * character's too, so both copies open the same sheet.
 */
export interface SessionCharacter extends Character {
  characterId: string;
  /** Which copy of that character this is. Shown only when there is more than one. */
  copyNumber: number;
  /** The order it came on stage. Only the tiebreak between equal DEX+INIT. */
  position: number;
  /** What this slot has left, against the totals above. Two goblins differ. */
  currentEndurance: number;
  currentStun: number;
  currentBody: number;
  claimedByPlayerId: string | null;
  claimedByPlayerName: string | null;
}

export interface SessionPlayer {
  id: string;
  name: string;
  claimedCharacterId: string | null;
}

export interface GameSession {
  id: string;
  campaignId: string;
  campaignName: string;
  code: string;
  status: "active" | "ended";
  turn: number;
  segment: number;
  playerCount: number;
  createdAt: string;
  endedAt: string | null;
}

export interface Snapshot {
  session: {
    id: string;
    status: string;
    /** How many HERO Turns of twelve segments the fight has reached. */
    turn: number;
    /** Which of those twelve segments it is on. Always 1–12. */
    segment: number;
    /** The campaign's name: what heads a player's screen. */
    campaignName: string;
    activeSlotId: string | null;
  };
  players: SessionPlayer[];
  characters: SessionCharacter[];
}

export type Identity =
  | { kind: "anonymous" }
  | { kind: "gm"; gm: { id: string; email: string } }
  | {
      kind: "player";
      player: { id: string; name: string; sessionId: string; claimedCharacterId: string | null };
    };
