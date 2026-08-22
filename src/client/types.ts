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
}

export interface SessionCharacter extends Character {
  position: number;
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
  round: number;
  activeCharacterId: string | null;
  createdAt: string;
  endedAt: string | null;
}

export interface Snapshot {
  session: {
    id: string;
    status: string;
    round: number;
    activeCharacterId: string | null;
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
