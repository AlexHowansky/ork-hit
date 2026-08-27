/**
 * Session membership rules: names, claims, and the lifetime of a code.
 */

import { describe, expect, test } from "bun:test";
import { db } from "../src/db/index.ts";
import { campaigns, characters, gameSessions, players, sessionCharacters } from "../src/db/queries.ts";
import { generateSessionCode } from "../src/lib/ids.ts";
import { normalizeTag } from "../src/lib/hero.ts";
import {
  makeCampaign,
  makeCharacter,
  makeGm,
  makePlayer,
  makeSession,
  tagsOf,
  unique,
  vitalsOf,
} from "./helpers.ts";

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

  test("several sessions can run at once, one per campaign, each with its own code", () => {
    const sessions = [makeSession(1), makeSession(1), makeSession(1)];
    const codes = new Set(sessions.map((entry) => entry.session.code));
    expect(codes.size).toBe(3);

    gameSessions.end(sessions[1]!.session.id);

    expect(gameSessions.activeByCode(sessions[0]!.session.code)).not.toBeNull();
    expect(gameSessions.activeByCode(sessions[1]!.session.code)).toBeNull();
    expect(gameSessions.activeByCode(sessions[2]!.session.code)).not.toBeNull();
  });
});

describe("one active session per campaign", () => {
  test("the database refuses a second one even if a check is skipped", () => {
    const { campaign } = makeSession(1);

    expect(() =>
      gameSessions.create({
        campaignId: campaign.id,
        gmId: campaign.gm_id,
        code: generateSessionCode(),
      }),
    ).toThrow(/UNIQUE constraint/i);
  });

  test("ending the first frees the campaign for another", () => {
    const { campaign, session } = makeSession(1);
    gameSessions.end(session.id);

    const next = gameSessions.create({
      campaignId: campaign.id,
      gmId: campaign.gm_id,
      code: generateSessionCode(),
    });

    expect(gameSessions.activeForCampaign(campaign.id)!.id).toBe(next.id);
  });

  test("a campaign with nothing running has no active session", () => {
    const campaign = makeCampaign();
    expect(gameSessions.activeForCampaign(campaign.id)).toBeNull();
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
    sessionCharacters.add(session.id, early.id, "pc");
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

describe("the session list", () => {
  test("comes back by campaign name, ignoring case", () => {
    const gm = makeGm();
    for (const name of ["ravenloft", "Avernus", "Waterdeep", "barovia"]) {
      const campaign = campaigns.create({ gmId: gm.id, name, backgroundUploadId: null });
      gameSessions.create({ campaignId: campaign.id, gmId: gm.id, code: generateSessionCode() });
    }

    const names = gameSessions
      .listForGm(gm.id)
      .map((session) => campaigns.byId(session.campaign_id)!.name);
    expect(names).toEqual(["Avernus", "barovia", "ravenloft", "Waterdeep"]);
  });

  test("puts the newest first where one campaign has run more than one session", () => {
    const gm = makeGm();
    const campaign = campaigns.create({
      gmId: gm.id,
      name: unique("Campaign"),
      backgroundUploadId: null,
    });
    // Only one session may be active at a time, so the older one is ended first.
    const older = gameSessions.create({
      campaignId: campaign.id,
      gmId: gm.id,
      code: generateSessionCode(),
    });
    gameSessions.end(older.id);
    // Both rows can otherwise land in the same millisecond, which would leave
    // the tie unbroken and the assertion up to chance.
    db.query("UPDATE game_sessions SET created_at = '2020-01-01T00:00:00.000Z' WHERE id = $id")
      .run({ id: older.id });
    const newer = gameSessions.create({
      campaignId: campaign.id,
      gmId: gm.id,
      code: generateSessionCode(),
    });

    expect(gameSessions.listForGm(gm.id).map((session) => session.id)).toEqual([
      newer.id,
      older.id,
    ]);
  });
});

describe("what a stage slot has left", () => {
  test("is seeded from the character's totals when it walks on", () => {
    const { session, campaign } = makeSession(1);
    const goblin = makeCharacter(campaign.id, "npc", unique("Goblin"), {
      endurance: 20,
      stun: 15,
      body: 8,
    });

    sessionCharacters.add(session.id, goblin.id, "npc");

    expect(vitalsOf(session.id).at(-1)).toEqual({ end: 20, stun: 15, body: 8 });
  });

  test("is each copy's own number", () => {
    const { session, campaign } = makeSession(1);
    const goblin = makeCharacter(campaign.id, "npc", unique("Goblin"), {
      endurance: 20,
      stun: 15,
      body: 8,
    });
    const first = sessionCharacters.add(session.id, goblin.id, "npc")!;
    sessionCharacters.add(session.id, goblin.id, "npc");

    sessionCharacters.setVitals(session.id, first, { stun: 3 });

    // One goblin is nearly down; the other is untouched.
    expect(vitalsOf(session.id).slice(-2)).toEqual([
      { end: 20, stun: 3, body: 8 },
      { end: 20, stun: 15, body: 8 },
    ]);
  });

  test("survives an edit to the character it was seeded from", () => {
    const { session, campaign } = makeSession(1);
    const hero = makeCharacter(campaign.id, "npc", unique("Ogre"), {
      endurance: 30,
      stun: 25,
      body: 12,
    });
    const slot = sessionCharacters.add(session.id, hero.id, "npc")!;
    sessionCharacters.setVitals(session.id, slot, { stun: 4 });

    // The game master corrects the library mid-session: the total moves, what
    // this copy has left does not, so nobody is quietly healed.
    characters.update(hero.id, { stun: 40 });

    const row = sessionCharacters.list(session.id).find((entry) => entry.slot_id === slot)!;
    expect(row.stun).toBe(40);
    expect(row.cur_stun).toBe(4);
  });

  test("a Recovery gives back RECOVERY, and stops at the totals", () => {
    const { session, campaign } = makeSession(1);
    const brick = makeCharacter(campaign.id, "npc", unique("Brick"), {
      recovery: 8,
      endurance: 30,
      stun: 25,
      body: 12,
    });
    const slot = sessionCharacters.add(session.id, brick.id, "npc")!;
    sessionCharacters.setVitals(session.id, slot, { endurance: 4, stun: -6 });

    sessionCharacters.takeRecovery(session.id, slot);
    expect(vitalsOf(session.id).at(-1)).toEqual({ end: 12, stun: 2, body: 12 });

    // Repeated until both are full, and no further: BODY is not a Recovery's business.
    for (let i = 0; i < 5; i += 1) sessionCharacters.takeRecovery(session.id, slot);
    expect(vitalsOf(session.id).at(-1)).toEqual({ end: 30, stun: 25, body: 12 });
  });

  test("a rest sets END and STUN to full, and leaves BODY where it is", () => {
    const { session, campaign } = makeSession(1);
    const hero = makeCharacter(campaign.id, "npc", unique("Knight"), {
      recovery: 6,
      endurance: 30,
      stun: 25,
      body: 12,
    });
    const slot = sessionCharacters.add(session.id, hero.id, "npc")!;
    sessionCharacters.setVitals(session.id, slot, { endurance: 1, stun: -4, body: 7 });

    sessionCharacters.takeRest(session.id, slot);

    // BODY heals over days in HERO, which is longer than a night's sleep.
    expect(vitalsOf(session.id).at(-1)).toEqual({ end: 30, stun: 25, body: 7 });
  });

  test("a rest brings a boosted character back down to their own total", () => {
    const { session, campaign } = makeSession(1);
    const npc = makeCharacter(campaign.id, "npc", unique("Sprite"), {
      endurance: 20,
      stun: 20,
      body: 10,
    });
    const slot = sessionCharacters.add(session.id, npc.id, "npc")!;
    sessionCharacters.setVitals(session.id, slot, { endurance: 45 });

    sessionCharacters.takeRest(session.id, slot);

    expect(vitalsOf(session.id).at(-1)).toEqual({ end: 20, stun: 20, body: 10 });
  });

  test("a Recovery never takes anything away", () => {
    const { session, campaign } = makeSession(1);
    const buffed = makeCharacter(campaign.id, "npc", unique("Buffed"), {
      recovery: 5,
      endurance: 20,
      stun: 20,
      body: 10,
    });
    const slot = sessionCharacters.add(session.id, buffed.id, "npc")!;
    // Above the total, as a temporary boost leaves a character.
    sessionCharacters.setVitals(session.id, slot, { endurance: 40 });

    sessionCharacters.takeRecovery(session.id, slot);

    expect(vitalsOf(session.id).at(-1)).toEqual({ end: 40, stun: 20, body: 10 });
  });

  test("leaves the values a patch does not mention alone", () => {
    const { session, campaign } = makeSession(1);
    const npc = makeCharacter(campaign.id, "npc", unique("Wolf"), {
      endurance: 10,
      stun: 10,
      body: 5,
    });
    const slot = sessionCharacters.add(session.id, npc.id, "npc")!;

    sessionCharacters.setVitals(session.id, slot, { endurance: 2 });

    expect(vitalsOf(session.id).at(-1)).toEqual({ end: 2, stun: 10, body: 5 });
  });
});

describe("what condition a stage slot is in", () => {
  test("a tag is put on one slot and nobody else", () => {
    const { session, campaign } = makeSession(1);
    const goblin = makeCharacter(campaign.id, "npc", unique("Goblin"));
    const first = sessionCharacters.add(session.id, goblin.id, "npc")!;
    sessionCharacters.add(session.id, goblin.id, "npc");

    sessionCharacters.setTag(session.id, first, "prone", true);

    // Two copies of one character, and only the one that fell over is prone.
    expect(tagsOf(session.id).slice(-2)).toEqual([["prone"], []]);
  });

  test("saying it twice says it once", () => {
    const { session, campaign } = makeSession(0);
    const npc = makeCharacter(campaign.id, "npc", unique("Wolf"));
    const slot = sessionCharacters.add(session.id, npc.id, "npc")!;

    sessionCharacters.setTag(session.id, slot, "stunned", true);
    expect(() => sessionCharacters.setTag(session.id, slot, "stunned", true)).not.toThrow();

    expect(tagsOf(session.id)).toEqual([["stunned"]]);
  });

  test("and clearing one that was never there is not an error", () => {
    const { session, campaign } = makeSession(0);
    const npc = makeCharacter(campaign.id, "npc", unique("Wolf"));
    const slot = sessionCharacters.add(session.id, npc.id, "npc")!;

    expect(() => sessionCharacters.setTag(session.id, slot, "prone", false)).not.toThrow();
    expect(tagsOf(session.id)).toEqual([[]]);
    expect(sessionCharacters.hasTag(session.id, slot, "prone")).toBe(false);
  });

  test("they are drawn in one order however they arrived", () => {
    const { session, campaign } = makeSession(0);
    const npc = makeCharacter(campaign.id, "npc", unique("Wolf"));
    const slot = sessionCharacters.add(session.id, npc.id, "npc")!;

    for (const tag of ["stunned", "On fire", "dead", "prone", "Bleeding"]) {
      sessionCharacters.setTag(session.id, slot, tag, true);
    }

    // The known conditions in the order the app lists them, then the typed ones
    // alphabetically — not the order the game master pressed the buttons in.
    expect(tagsOf(session.id)).toEqual([["dead", "prone", "stunned", "Bleeding", "On fire"]]);
  });

  test("a typed tag that spells a known one is that one", () => {
    const { session, campaign } = makeSession(0);
    const npc = makeCharacter(campaign.id, "npc", unique("Wolf"));
    const slot = sessionCharacters.add(session.id, npc.id, "npc")!;

    sessionCharacters.setTag(session.id, slot, "prone", true);
    sessionCharacters.setTag(session.id, slot, normalizeTag("  Prone "), true);

    // One prone character, not a prone one standing beside a Prone one.
    expect(tagsOf(session.id)).toEqual([["prone"]]);
  });

  test("leaving the stage takes the conditions with it", () => {
    const { session, campaign } = makeSession(0);
    const goblin = makeCharacter(campaign.id, "npc", unique("Goblin"));
    const first = sessionCharacters.add(session.id, goblin.id, "npc")!;
    const second = sessionCharacters.add(session.id, goblin.id, "npc")!;
    sessionCharacters.setTag(session.id, first, "prone", true);
    sessionCharacters.setTag(session.id, second, "dead", true);

    sessionCharacters.remove(session.id, first);

    // The survivor keeps its own; nothing of the other's is left behind for the
    // next copy to inherit.
    expect(tagsOf(session.id)).toEqual([["dead"]]);
    expect(
      db.query<{ n: number }, { sessionId: string }>(`
        SELECT COUNT(*) AS n FROM session_character_tags t
        JOIN session_characters sc ON sc.id = t.session_character_id
        WHERE sc.game_session_id = $sessionId
      `).get({ sessionId: session.id })!.n,
    ).toBe(1);
  });

  test("a slot belonging to another session cannot be tagged through this one", () => {
    const { session: mine, campaign } = makeSession(0);
    const { session: theirs } = makeSession(0);
    const npc = makeCharacter(campaign.id, "npc", unique("Wolf"));
    const slot = sessionCharacters.add(mine.id, npc.id, "npc")!;

    sessionCharacters.setTag(theirs.id, slot, "prone", true);

    expect(tagsOf(mine.id)).toEqual([[]]);
  });
});
