/** Fixtures for the database-backed tests. */

import {
  campaigns,
  characters,
  gameSessions,
  gms,
  players,
  sessionCharacters,
  uploads,
} from "../src/db/queries.ts";
import type { HeroStats } from "../src/db/queries.ts";
import { generateSessionCode, generateToken, hashToken } from "../src/lib/ids.ts";

let counter = 0;
/** Unique across a run, so tests sharing one database can't collide on names. */
export function unique(prefix: string): string {
  counter += 1;
  return `${prefix}-${counter}-${Math.random().toString(36).slice(2, 8)}`;
}

export function makeGm() {
  return gms.create(`${unique("gm")}@example.com`, "not-a-real-hash");
}

export function makeCampaign(gmId?: string) {
  const gm = gmId ?? makeGm().id;
  return campaigns.create({ gmId: gm, name: unique("Campaign"), backgroundUploadId: null });
}

export function makeCharacter(
  campaignId: string,
  kind: "pc" | "npc" = "pc",
  name?: string,
  stats?: Partial<HeroStats>,
) {
  // Characters need an upload row to point at; the file itself is irrelevant here.
  const uploadId = makeUpload();
  return characters.create({
    campaignId,
    kind,
    name: name ?? unique(kind === "pc" ? "Hero" : "Villain"),
    sheetUploadId: uploadId,
    backgroundUploadId: null,
    stats,
  });
}

function makeUpload(): string {
  return uploads.create({
    kind: "sheet",
    diskPath: `/dev/null/${unique("sheet")}`,
    mime: "text/html",
    byteSize: 10,
    sha256: "0".repeat(64),
    originalName: "sheet.html",
  }).id;
}

/** A session with `count` characters already in it, in a known order. */
export function makeSession(count = 3) {
  const gm = makeGm();
  const campaign = makeCampaign(gm.id);
  const session = gameSessions.create({
    campaignId: campaign.id,
    gmId: gm.id,
    code: generateSessionCode(),
  });
  const members = Array.from({ length: count }, (_, index) =>
    makeCharacter(campaign.id, index === count - 1 && count > 1 ? "npc" : "pc"),
  );
  for (const member of members) sessionCharacters.add(session.id, member.id, member.kind);
  return { gm, campaign, session, characters: members };
}

export function makePlayer(sessionId: string, name?: string) {
  return players.create({
    sessionId,
    name: name ?? unique("Player"),
    tokenHash: hashToken(generateToken()),
  });
}

/** The current initiative order as a list of names, for readable assertions. */
export function orderOf(sessionId: string): string[] {
  return sessionCharacters.list(sessionId).map((character) => character.name);
}

/** The stage as slot ids, which is what a reorder and the turn marker name. */
export function slotsOf(sessionId: string): string[] {
  return sessionCharacters.list(sessionId).map((row) => row.slot_id);
}

/** The copy number of each slot, in initiative order. */
export function copiesOf(sessionId: string): number[] {
  return sessionCharacters.list(sessionId).map((row) => row.copy_number);
}

/** What each slot has left, in initiative order. */
export function vitalsOf(sessionId: string): { end: number; stun: number; body: number }[] {
  return sessionCharacters.list(sessionId).map((row) => ({
    end: row.cur_endurance,
    stun: row.cur_stun,
    body: row.cur_body,
  }));
}

/** The stored positions, to assert they stay dense and gap-free. */
export function positionsOf(sessionId: string): number[] {
  return sessionCharacters.list(sessionId).map((character) => character.position);
}
