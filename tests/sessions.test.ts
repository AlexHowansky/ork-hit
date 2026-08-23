/**
 * Session membership rules: names, claims, and the lifetime of a code.
 */

import { describe, expect, test } from "bun:test";
import { db } from "../src/db/index.ts";
import { characters, gameSessions, players, sessionCharacters } from "../src/db/queries.ts";
import { generateSessionCode } from "../src/lib/ids.ts";
import { makeCampaign, makeCharacter, makeGm, makePlayer, makeSession, unique } from "./helpers.ts";

describe("player names", () => {
  test("are unique within a session, ignoring case", () => {
    const { session } = makeSession(1);
    makePlayer(session.id, "Alice");

    expect(players.nameTaken(session.id, "Alice")).toBe(true);
    expect(players.nameTaken(session.id, "alice")).toBe(true);
    expect(players.nameTaken(session.id, "ALICE")).toBe(true);
    expect(players.nameTaken(session.id, "Alicia")).toBe(false);
  });

  test("the database refuses a duplicate even if a check is skipped", () => {
    const { session } = makeSession(1);
    makePlayer(session.id, "Bob");
    expect(() => makePlayer(session.id, "bob")).toThrow(/UNIQUE constraint/i);
  });

  test("the same name in a different session is fine", () => {
    const first = makeSession(1);
    const second = makeSession(1);
    makePlayer(first.session.id, "Carol");
    expect(() => makePlayer(second.session.id, "Carol")).not.toThrow();
  });
});

describe("character claims", () => {
  test("two players cannot hold the same character", () => {
    const { session, characters: members } = makeSession(2);
    const target = members[0]!.id;
    const first = makePlayer(session.id);
    const second = makePlayer(session.id);

    players.setClaim(first.id, target);
    expect(() => players.setClaim(second.id, target)).toThrow(/UNIQUE constraint/i);
    expect(players.holderOf(session.id, target)!.id).toBe(first.id);
  });

  test("a race for one character resolves to exactly one winner", () => {
    const { session, characters: members } = makeSession(2);
    const target = members[0]!.id;
    const contenders = [makePlayer(session.id), makePlayer(session.id), makePlayer(session.id)];

    // The same check-then-claim transaction the claim endpoint runs.
    const attempt = (playerId: string) =>
      db.transaction(() => {
        const holder = players.holderOf(session.id, target);
        if (holder && holder.id !== playerId) return false;
        players.setClaim(playerId, target);
        return true;
      });

    const winners = contenders.filter((player) => {
      try {
        return attempt(player.id)();
      } catch {
        return false;
      }
    });

    expect(winners).toHaveLength(1);
    expect(players.holderOf(session.id, target)!.id).toBe(winners[0]!.id);
  });

  test("releasing a claim frees the character for someone else", () => {
    const { session, characters: members } = makeSession(2);
    const target = members[0]!.id;
    const first = makePlayer(session.id);
    const second = makePlayer(session.id);

    players.setClaim(first.id, target);
    players.setClaim(first.id, null);

    expect(() => players.setClaim(second.id, target)).not.toThrow();
    expect(players.holderOf(session.id, target)!.id).toBe(second.id);
  });

  test("removing a player releases whatever they held", () => {
    const { session, characters: members } = makeSession(2);
    const target = members[0]!.id;
    const player = makePlayer(session.id);
    players.setClaim(player.id, target);

    players.remove(player.id);

    expect(players.holderOf(session.id, target)).toBeNull();
  });
});

describe("session codes and lifetime", () => {
  test("an active session resolves from its code", () => {
    const { session } = makeSession(1);
    expect(gameSessions.activeByCode(session.code)!.id).toBe(session.id);
  });

  test("ending a session revokes its code", () => {
    const { session } = makeSession(1);
    gameSessions.end(session.id);

    expect(gameSessions.activeByCode(session.code)).toBeNull();
    // The record itself is kept, so history survives.
    expect(gameSessions.byId(session.id)!.status).toBe("ended");
    expect(gameSessions.byId(session.id)!.ended_at).not.toBeNull();
  });

  test("several sessions can run at once, each with its own code", () => {
    const sessions = [makeSession(1), makeSession(1), makeSession(1)];
    const codes = new Set(sessions.map((entry) => entry.session.code));
    expect(codes.size).toBe(3);

    gameSessions.end(sessions[1]!.session.id);

    expect(gameSessions.activeByCode(sessions[0]!.session.code)).not.toBeNull();
    expect(gameSessions.activeByCode(sessions[1]!.session.code)).toBeNull();
    expect(gameSessions.activeByCode(sessions[2]!.session.code)).not.toBeNull();
  });
});

describe("character names", () => {
  test("are unique within a campaign, ignoring case", () => {
    const { campaign } = makeSession(0);
    const name = unique("Gandalf");
    makeCharacter(campaign.id, "pc", name);

    expect(characters.nameTaken(campaign.id, name)).toBe(true);
    expect(characters.nameTaken(campaign.id, name.toUpperCase())).toBe(true);
    expect(characters.nameTaken(campaign.id, `${name}x`)).toBe(false);
  });

  test("the same name may exist in another campaign", () => {
    const first = makeSession(0);
    const second = makeSession(0);
    const name = unique("Shared");

    makeCharacter(first.campaign.id, "pc", name);
    expect(() => makeCharacter(second.campaign.id, "pc", name)).not.toThrow();
  });
});

describe("the starting roster", () => {
  /** Starts a session on a fresh campaign the way the POST handler does. */
  const start = (campaignId: string, gmId: string) => {
    const session = gameSessions.create({
      campaignId,
      gmId,
      code: generateSessionCode(),
    });
    sessionCharacters.addCampaignPcs(session.id, campaignId);
    return session;
  };

  test("holds every player character in the campaign, in name order", () => {
    const campaign = makeCampaign();
    makeCharacter(campaign.id, "pc", "Zarina");
    makeCharacter(campaign.id, "pc", "elara");
    makeCharacter(campaign.id, "pc", "Bruenor");

    const session = start(campaign.id, campaign.gm_id);
    const roster = sessionCharacters.list(session.id);

    expect(roster.map((character) => character.name)).toEqual(["Bruenor", "elara", "Zarina"]);
    expect(roster.map((character) => character.position)).toEqual([0, 1, 2]);
  });

  test("leaves the NPCs in the library", () => {
    const campaign = makeCampaign();
    makeCharacter(campaign.id, "pc", "Thorin");
    makeCharacter(campaign.id, "npc", "Strahd");

    const session = start(campaign.id, campaign.gm_id);
    expect(sessionCharacters.list(session.id).map((c) => c.name)).toEqual(["Thorin"]);
  });

  test("is empty when the campaign has no player characters", () => {
    const campaign = makeCampaign();
    makeCharacter(campaign.id, "npc", "Strahd");

    const session = start(campaign.id, campaign.gm_id);
    expect(sessionCharacters.list(session.id)).toEqual([]);
  });

  test("appends rather than colliding when the session already has someone", () => {
    const campaign = makeCampaign();
    const early = makeCharacter(campaign.id, "pc", "Aaron");
    const session = gameSessions.create({
      campaignId: campaign.id,
      gmId: campaign.gm_id,
      code: generateSessionCode(),
    });
    sessionCharacters.add(session.id, early.id);
    makeCharacter(campaign.id, "pc", "Beatrix");

    sessionCharacters.addCampaignPcs(session.id, campaign.id);
    const roster = sessionCharacters.list(session.id);

    expect(roster.map((character) => character.name)).toEqual(["Aaron", "Beatrix"]);
    expect(roster.map((character) => character.position)).toEqual([0, 1]);
  });
});

describe("the character library", () => {
  test("comes back in name order, ignoring case and kind", () => {
    const campaign = makeCampaign();
    for (const [name, kind] of [
      ["zarina", "npc"],
      ["Bruenor", "pc"],
      ["strahd", "npc"],
      ["Elara", "pc"],
    ] as const) {
      makeCharacter(campaign.id, kind, name);
    }

    const listed = characters.listForGm(campaign.gm_id, campaign.id).map((c) => c.name);
    expect(listed).toEqual(["Bruenor", "Elara", "strahd", "zarina"]);
  });

  test("is ordered the same way across campaigns", () => {
    const gm = makeGm();
    makeCharacter(makeCampaign(gm.id).id, "npc", "Yorick");
    makeCharacter(makeCampaign(gm.id).id, "pc", "Alwin");

    expect(characters.listForGm(gm.id).map((c) => c.name)).toEqual(["Alwin", "Yorick"]);
  });
});
