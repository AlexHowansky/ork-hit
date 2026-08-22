/**
 * Initiative order and the turn tracker.
 *
 * These are the invariants the drag-and-drop UI and the turn buttons depend on:
 * positions stay dense, the order survives adds and removes, and stepping through
 * it wraps predictably.
 */

import { beforeEach, describe, expect, test } from "bun:test";
import { gameSessions, players, sessionCharacters } from "../src/db/queries.ts";
import { advanceTurn } from "../src/server/routes/sessions.ts";
import { makeCharacter, makePlayer, makeSession, orderOf, positionsOf } from "./helpers.ts";

describe("initiative order", () => {
  test("characters are appended in the order they are added", () => {
    const { session, characters } = makeSession(3);
    expect(orderOf(session.id)).toEqual(characters.map((c) => c.name));
    expect(positionsOf(session.id)).toEqual([0, 1, 2]);
  });

  test("adding the same character twice is a no-op", () => {
    const { session, characters } = makeSession(2);
    sessionCharacters.add(session.id, characters[0]!.id);
    expect(orderOf(session.id)).toHaveLength(2);
    expect(positionsOf(session.id)).toEqual([0, 1]);
  });

  test("a reorder rewrites positions densely", () => {
    const { session, characters } = makeSession(4);
    const [a, b, c, d] = characters;
    sessionCharacters.reorder(session.id, [d!.id, b!.id, a!.id, c!.id]);

    expect(orderOf(session.id)).toEqual([d!.name, b!.name, a!.name, c!.name]);
    expect(positionsOf(session.id)).toEqual([0, 1, 2, 3]);
  });

  test("removing from the middle closes the gap", () => {
    const { session, characters } = makeSession(4);
    sessionCharacters.remove(session.id, characters[1]!.id);

    expect(positionsOf(session.id)).toEqual([0, 1, 2]);
    expect(orderOf(session.id)).toEqual([
      characters[0]!.name,
      characters[2]!.name,
      characters[3]!.name,
    ]);
  });

  test("a character added after a removal lands at the end", () => {
    const { session, campaign, characters } = makeSession(3);
    sessionCharacters.remove(session.id, characters[0]!.id);
    const late = makeCharacter(campaign.id, "npc");
    sessionCharacters.add(session.id, late.id);

    expect(positionsOf(session.id)).toEqual([0, 1, 2]);
    expect(orderOf(session.id).at(-1)).toBe(late.name);
  });

  test("removing a character releases the player holding it", () => {
    const { session, characters } = makeSession(2);
    const player = makePlayer(session.id);
    players.setClaim(player.id, characters[0]!.id);

    sessionCharacters.remove(session.id, characters[0]!.id);

    expect(players.byId(player.id)!.claimed_character_id).toBeNull();
  });

  test("removing the character whose turn it is clears the turn", () => {
    const { session, characters } = makeSession(3);
    gameSessions.setTurn(session.id, characters[1]!.id, 1);

    sessionCharacters.remove(session.id, characters[1]!.id);

    expect(gameSessions.byId(session.id)!.active_character_id).toBeNull();
  });

  test("removing a different character leaves the turn alone", () => {
    const { session, characters } = makeSession(3);
    gameSessions.setTurn(session.id, characters[0]!.id, 1);

    sessionCharacters.remove(session.id, characters[2]!.id);

    expect(gameSessions.byId(session.id)!.active_character_id).toBe(characters[0]!.id);
  });
});

describe("advancing the turn", () => {
  let fixture: ReturnType<typeof makeSession>;
  const turnName = () => {
    const session = gameSessions.byId(fixture.session.id)!;
    return sessionCharacters
      .list(fixture.session.id)
      .find((character) => character.id === session.active_character_id)?.name ?? null;
  };
  const round = () => gameSessions.byId(fixture.session.id)!.round;

  beforeEach(() => {
    fixture = makeSession(3);
  });

  test("stepping forward from nothing starts at the top of the order", () => {
    advanceTurn(fixture.session.id, "next");
    expect(turnName()).toBe(fixture.characters[0]!.name);
    expect(round()).toBe(1);
  });

  test("stepping backward from nothing starts at the bottom", () => {
    advanceTurn(fixture.session.id, "prev");
    expect(turnName()).toBe(fixture.characters[2]!.name);
    expect(round()).toBe(1);
  });

  test("wrapping past the end advances the round", () => {
    for (let i = 0; i < 3; i += 1) advanceTurn(fixture.session.id, "next");
    expect(turnName()).toBe(fixture.characters[2]!.name);
    expect(round()).toBe(1);

    advanceTurn(fixture.session.id, "next");
    expect(turnName()).toBe(fixture.characters[0]!.name);
    expect(round()).toBe(2);
  });

  test("wrapping backward past the start takes the round back", () => {
    for (let i = 0; i < 4; i += 1) advanceTurn(fixture.session.id, "next");
    expect(round()).toBe(2);

    advanceTurn(fixture.session.id, "prev");
    expect(turnName()).toBe(fixture.characters[2]!.name);
    expect(round()).toBe(1);
  });

  test("the round never falls below one", () => {
    for (let i = 0; i < 10; i += 1) advanceTurn(fixture.session.id, "prev");
    expect(round()).toBe(1);
  });

  test("the turn follows the initiative order, not the order characters were added", () => {
    const [a, b, c] = fixture.characters;
    sessionCharacters.reorder(fixture.session.id, [c!.id, a!.id, b!.id]);

    advanceTurn(fixture.session.id, "next");
    expect(turnName()).toBe(c!.name);
    advanceTurn(fixture.session.id, "next");
    expect(turnName()).toBe(a!.name);
  });

  test("an empty session cannot track turns", () => {
    const { session } = makeSession(0);
    expect(() => advanceTurn(session.id, "next")).toThrow(
      "Add some characters to the session before tracking turns.",
    );
  });
});
