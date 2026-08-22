/** Row shapes as they come back from SQLite. */

export type CharacterKind = "pc" | "npc";
export type SessionStatus = "active" | "ended";
export type UploadKind = "sheet" | "image";

export interface GmRow {
  id: string;
  email: string;
  password_hash: string;
  created_at: string;
  updated_at: string;
}

export interface GmAuthSessionRow {
  id: string;
  gm_id: string;
  token_hash: string;
  created_at: string;
  expires_at: string;
  absolute_expires_at: string;
  last_seen_at: string;
}

export interface UploadRow {
  id: string;
  kind: UploadKind;
  disk_path: string;
  mime: string;
  byte_size: number;
  sha256: string;
  original_name: string;
  created_at: string;
}

export interface CampaignRow {
  id: string;
  gm_id: string;
  name: string;
  background_upload_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface CharacterRow {
  id: string;
  campaign_id: string;
  kind: CharacterKind;
  name: string;
  sheet_upload_id: string;
  background_upload_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface GameSessionRow {
  id: string;
  campaign_id: string;
  gm_id: string;
  code: string;
  status: SessionStatus;
  active_character_id: string | null;
  round: number;
  created_at: string;
  ended_at: string | null;
}

export interface PlayerRow {
  id: string;
  game_session_id: string;
  name: string;
  token_hash: string;
  claimed_character_id: string | null;
  joined_at: string;
}

/** A character in a session, joined with its initiative position. */
export interface SessionCharacterRow extends CharacterRow {
  position: number;
}
