/**
 * The reading a box of ENDURANCE, STUN or BODY gives at a glance.
 *
 * Thresholds are the kind of thing that drifts a percent at a time under later
 * edits, so the boundaries themselves are pinned here rather than left to the
 * screen that draws them.
 */

import { describe, expect, test } from "bun:test";
import { bandFor } from "../src/lib/hero.ts";

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
