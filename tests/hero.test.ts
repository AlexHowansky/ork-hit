/**
 * The reading a box of ENDURANCE, STUN or BODY gives at a glance.
 *
 * Thresholds are the kind of thing that drifts a percent at a time under later
 * edits, so the boundaries themselves are pinned here rather than left to the
 * screen that draws them.
 */

import { describe, expect, test } from "bun:test";
import { actsIn, bandFor, segmentsFor, SEGMENTS_PER_TURN, SPEED_CHART } from "../src/lib/hero.ts";

describe("how healthy a characteristic looks", () => {
  test("under a third left is low, two thirds is middling, above that is full", () => {
    expect(bandFor(30, 30)).toBe("full");
    expect(bandFor(21, 30)).toBe("full"); // 70%
    expect(bandFor(20, 30)).toBe("middling"); // 66.7%
    expect(bandFor(15, 30)).toBe("middling"); // 50%
    expect(bandFor(10, 30)).toBe("middling"); // 33.3%
    expect(bandFor(9, 30)).toBe("low"); // 30%
    expect(bandFor(1, 30)).toBe("low");
  });

  test("the boundaries fall where the rule says", () => {
    // A third exactly is not yet low, two thirds exactly is not yet full.
    expect(bandFor(33, 100)).toBe("middling");
    expect(bandFor(32, 100)).toBe("low");
    expect(bandFor(67, 100)).toBe("middling");
    expect(bandFor(68, 100)).toBe("full");
  });

  test("nothing left, or worse than nothing, is low", () => {
    expect(bandFor(0, 25)).toBe("low");
    // A HERO character at -8 STUN is unconscious, not uncoloured.
    expect(bandFor(-8, 25)).toBe("low");
  });

  test("a character nobody has filled in has no reading to give", () => {
    expect(bandFor(0, 0)).toBe("unknown");
  });

  test("more than full is still full", () => {
    // A temporary boost can put a character above their own total.
    expect(bandFor(40, 30)).toBe("full");
  });
});

/**
 * The Speed Chart, written out longhand.
 *
 * Pinned as a table rather than derived, because it is a published table and not
 * a formula — the segments a SPD 7 character gets are not the segments an even
 * spread of seven phases would give them, and a clever reconstruction that came
 * close would be wrong in exactly the places nobody checks.
 */
describe("the speed chart", () => {
  const EXPECTED: number[][] = [
    [],
    [7],
    [6, 12],
    [4, 8, 12],
    [3, 6, 9, 12],
    [3, 5, 8, 10, 12],
    [2, 4, 6, 8, 10, 12],
    [2, 4, 6, 7, 9, 11, 12],
    [2, 3, 5, 6, 8, 9, 11, 12],
    [2, 3, 4, 6, 7, 8, 10, 11, 12],
    [2, 3, 4, 5, 6, 8, 9, 10, 11, 12],
    [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
  ];

  test("every SPD from 0 to 12 gets the segments the rules give it", () => {
    for (let speed = 0; speed <= SEGMENTS_PER_TURN; speed += 1) {
      expect(segmentsFor(speed)).toEqual(EXPECTED[speed]!);
    }
  });

  test("a SPD gets exactly that many phases in a turn", () => {
    for (let speed = 0; speed <= SEGMENTS_PER_TURN; speed += 1) {
      expect(segmentsFor(speed)).toHaveLength(speed);
    }
  });

  test("SPD 0 has no phases at all, and SPD 12 has all twelve", () => {
    expect(segmentsFor(0)).toEqual([]);
    expect(segmentsFor(12)).toHaveLength(12);
  });

  test("every character with a SPD acts in segment 12, except the one that does not", () => {
    // Where a fight opens. SPD 1 is the exception the rules make: its single
    // phase is segment 7, so it does not act in the opening segment at all.
    for (let speed = 2; speed <= SEGMENTS_PER_TURN; speed += 1) {
      expect(actsIn(speed, 12)).toBe(true);
    }
    expect(actsIn(1, 12)).toBe(false);
    expect(actsIn(1, 7)).toBe(true);
  });

  test("actsIn agrees with the chart, segment by segment", () => {
    for (let speed = 0; speed <= SEGMENTS_PER_TURN; speed += 1) {
      for (let segment = 1; segment <= SEGMENTS_PER_TURN; segment += 1) {
        expect(actsIn(speed, segment)).toBe(EXPECTED[speed]!.includes(segment));
      }
    }
  });

  test("a SPD outside the chart clamps into it rather than reading as nothing", () => {
    // The schema bounds SPD to 0–12 on the way in, but a stored number that
    // predates that bound must not come back as `undefined`.
    expect(segmentsFor(-3)).toEqual([]);
    expect(segmentsFor(99)).toEqual(SPEED_CHART[12]!);
    expect(segmentsFor(4.9)).toEqual(SPEED_CHART[4]!);
  });
});
