/**
 * Shapes database rows into the JSON the client consumes.
 *
 * Kept separate from the routes so that the WebSocket snapshot and the REST
 * responses describe a character the same way, and so neither has to import the
 * other.
 */

import type { CampaignRow, CharacterRow, GameSessionRow, PlayerRow } from "../db/types.ts";

export function presentCampaign(campaign: CampaignRow) {
  return {
    id: campaign.id,
    name: campaign.name,
    backgroundUrl: campaign.background_upload_id
      ? `/uploads/images/${campaign.background_upload_id}`
      : null,
    createdAt: campaign.created_at,
  };
}

export function presentCharacter(character: CharacterRow) {
  return {
    id: character.id,
    campaignId: character.campaign_id,
    kind: character.kind,
    name: character.name,
    sheetUrl: `/sheets/${character.id}`,
    backgroundUrl: character.background_upload_id
      ? `/uploads/images/${character.background_upload_id}`
      : null,
    // The HERO characteristics. `endurance`, `stun` and `body` are the full
    // totals; what a copy of this character has left in a session is a separate
    // number, carried on the stage slot rather than here.
    speed: character.speed,
    dexterity: character.dexterity,
    initiative: character.initiative,
    recovery: character.recovery,
    endurance: character.endurance,
    stun: character.stun,
    body: character.body,
  };
}

/**
 * The game master's view of a session, including the code they hand out.
 *
 * `playerCount` is passed in rather than looked up here, so a list of sessions
 * can count them all in one query.
 */
export function presentSessionForGm(
  session: GameSessionRow,
  campaign: CampaignRow,
  playerCount: number,
) {
  return {
    id: session.id,
    campaignId: session.campaign_id,
    campaignName: campaign.name,
    code: session.code,
    status: session.status,
    round: session.round,
    playerCount,
    createdAt: session.created_at,
    endedAt: session.ended_at,
  };
}

export function presentPlayer(player: PlayerRow) {
  return {
    id: player.id,
    name: player.name,
    claimedCharacterId: player.claimed_character_id,
  };
}
