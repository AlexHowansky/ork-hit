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
import {
  copiesOf,
  makeCharacter,
  makePlayer,
  makeSession,
  orderOf,
  positionsOf,
  slotsOf,
} from "./helpers.ts";

describe("initiative order", () => {
  test("characters are appended in the order they are added", () => {
    const { session, characters } = makeSession(3);
    expect(orderOf(session.id)).toEqual(characters.map((c) => c.name));
    expect(positionsOf(session.id)).toEqual([0, 1, 2]);
  });

  test("an NPC can be brought on more than once", () => {
    const { session, campaign } = makeSession(1);
    const goblin = makeCharacter(campaign.id, "npc", "Goblin");

    sessionCharacters.add(session.id, goblin.id, "npc");
    sessionCharacters.add(session.id, goblin.id, "npc");
    sessionCharacters.add(session.id, goblin.id, "npc");

    expect(orderOf(session.id).filter((name) => name === "Goblin")).toHaveLength(3);
    expect(positionsOf(session.id)).toEqual([0, 1, 2, 3]);
    // Each copy is a slot of its own, which is what gives it its own turn.
    expect(new Set(slotsOf(session.id)).size).toBe(4);
  });

  test("copies are numbered in the order they arrive", () => {
    const { session, campaign } = makeSession(0);
    const goblin = makeCharacter(campaign.id, "npc", "Goblin");
    for (let i = 0; i < 3; i += 1) sessionCharacters.add(session.id, goblin.id, "npc");

    expect(copiesOf(session.id)).toEqual([1, 2, 3]);
  });

  test("a copy keeps its number when another is taken off", () => {
    const { session, campaign } = makeSession(0);
    const goblin = makeCharacter(campaign.id, "npc", "Goblin");
    for (let i = 0; i < 3; i += 1) sessionCharacters.add(session.id, goblin.id, "npc");

    // Goblin 2 leaves; the other two are still Goblin 1 and Goblin 3, because a
    // number is a name for the whole fight rather than a place in the list.
    sessionCharacters.remove(session.id, slotsOf(session.id)[1]!);
    expect(copiesOf(session.id)).toEqual([1, 3]);

    // And the next one along is 4, not the 2 that just came free.
    sessionCharacters.add(session.id, goblin.id, "npc");
    expect(copiesOf(session.id)).toEqual([1, 3, 4]);
  });

  test("a player character is only ever on the stage once", () => {
    const { session, characters } = makeSession(2);
    const pc = characters.find((character) => character.kind === "pc")!;

    sessionCharacters.add(session.id, pc.id, "pc");

    expect(orderOf(session.id)).toHaveLength(2);
    expect(positionsOf(session.id)).toEqual([0, 1]);
  });

  test("a reorder rewrites positions densely", () => {
    const { session, characters } = makeSession(4);
    const [a, b, c, d] = slotsOf(session.id);
    sessionCharacters.reorder(session.id, [d!, b!, a!, c!]);

    expect(orderOf(session.id)).toEqual([
      characters[3]!.name,
      characters[1]!.name,
      characters[0]!.name,
      characters[2]!.name,
    ]);
    expect(positionsOf(session.id)).toEqual([0, 1, 2, 3]);
  });

  test("removing from the middle closes the gap", () => {
    const { session, characters } = makeSession(4);
    sessionCharacters.remove(session.id, slotsOf(session.id)[1]!);

    expect(positionsOf(session.id)).toEqual([0, 1, 2]);
    expect(orderOf(session.id)).toEqual([
      characters[0]!.name,
      characters[2]!.name,
      characters[3]!.name,
    ]);
  });

  test("a character added after a removal lands at the end", () => {
    const { session, campaign } = makeSession(3);
    sessionCharacters.remove(session.id, slotsOf(session.id)[0]!);
    const late = makeCharacter(campaign.id, "npc");
    sessionCharacters.add(session.id, late.id, "npc");

    expect(positionsOf(session.id)).toEqual([0, 1, 2]);
    expect(orderOf(session.id).at(-1)).toBe(late.name);
  });

  test("removing a character releases the player holding it", () => {
    const { session, characters } = makeSession(2);
    const player = makePlayer(session.id);
    players.setClaim(player.id, characters[0]!.id);

    sessionCharacters.remove(session.id, slotsOf(session.id)[0]!);

    expect(players.byId(player.id)!.claimed_character_id).toBeNull();
  });

  test("removing the character whose turn it is clears the turn", () => {
    const { session } = makeSession(3);
    const slots = slotsOf(session.id);
    gameSessions.setTurn(session.id, slots[1]!, 1);

    sessionCharacters.remove(session.id, slots[1]!);

    expect(gameSessions.byId(session.id)!.active_slot_id).toBeNull();
  });

  test("removing a different character leaves the turn alone", () => {
    const { session } = makeSession(3);
    const slots = slotsOf(session.id);
    gameSessions.setTurn(session.id, slots[0]!, 1);

    sessionCharacters.remove(session.id, slots[2]!);

    expect(gameSessions.byId(session.id)!.active_slot_id).toBe(slots[0]!);
  });

  test("one copy leaving does not take its twin's turn with it", () => {
    const { session, campaign } = makeSession(0);
    const goblin = makeCharacter(campaign.id, "npc", "Goblin");
    sessionCharacters.add(session.id, goblin.id, "npc");
    sessionCharacters.add(session.id, goblin.id, "npc");

    const [first, second] = slotsOf(session.id);
    gameSessions.setTurn(session.id, second!, 1);

    sessionCharacters.remove(session.id, first!);

    // Same character, different slot: the marker stays where it was.
    expect(gameSessions.byId(session.id)!.active_slot_id).toBe(second!);
    expect(orderOf(session.id)).toEqual(["Goblin"]);
  });
});

describe("advancing the turn", () => {
  let fixture: ReturnType<typeof makeSession>;
  const turnName = () => {
    const session = gameSessions.byId(fixture.session.id)!;
    return sessionCharacters
      .list(fixture.session.id)
      .find((row) => row.slot_id === session.active_slot_id)?.name ?? null;
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
    const [slotA, slotB, slotC] = slotsOf(fixture.session.id);
    sessionCharacters.reorder(fixture.session.id, [slotC!, slotA!, slotB!]);

    advanceTurn(fixture.session.id, "next");
    expect(turnName()).toBe(c!.name);
    advanceTurn(fixture.session.id, "next");
    expect(turnName()).toBe(a!.name);
  });

  test("every copy of an NPC gets its own turn", () => {
    const { session, campaign } = makeSession(0);
    const goblin = makeCharacter(campaign.id, "npc", "Goblin");
    for (let i = 0; i < 3; i += 1) sessionCharacters.add(session.id, goblin.id, "npc");

    const slots = slotsOf(session.id);
    const visited: (string | null)[] = [];
    for (let i = 0; i < 3; i += 1) {
      advanceTurn(session.id, "next");
      visited.push(gameSessions.byId(session.id)!.active_slot_id);
    }

    // Three goblins, three turns. Matching on the character rather than the slot
    // would find the first one every time and the other two would never act.
    expect(visited).toEqual(slots);
    expect(gameSessions.byId(session.id)!.round).toBe(1);

    // And the fourth step comes back round to the first, a round later.
    advanceTurn(session.id, "next");
    expect(gameSessions.byId(session.id)!.active_slot_id).toBe(slots[0]!);
    expect(gameSessions.byId(session.id)!.round).toBe(2);
  });

  test("an empty session cannot track turns", () => {
    const { session } = makeSession(0);
    expect(() => advanceTurn(session.id, "next")).toThrow(
      "Add some characters to the session before tracking turns.",
    );
  });
});
