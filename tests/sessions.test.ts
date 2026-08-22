/**
 * Session membership rules: names, claims, and the lifetime of a code.
 */

import { describe, expect, test } from "bun:test";
import { db } from "../src/db/index.ts";
import { characters, gameSessions, players } from "../src/db/queries.ts";
import { makeCharacter, makePlayer, makeSession, unique } from "./helpers.ts";

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
