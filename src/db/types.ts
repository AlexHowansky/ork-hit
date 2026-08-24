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
  active_slot_id: string | null;
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

/**
 * A slot on the stage, joined with the library character standing in it.
 *
 * `id` is inherited from `CharacterRow` and is still the *character*; the slot's
 * own identity is `slot_id`. They are different things now that one character can
 * occupy two slots, and the join is the only place both are in hand.
 */
export interface SessionCharacterRow extends CharacterRow {
  slot_id: string;
  copy_number: number;
  position: number;
}
