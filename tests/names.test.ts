/**
 * The order names are read in.
 *
 * One rule, shared by the server that sends a library and the browser that files
 * a new character into one without asking for it again (`src/lib/names.ts`), so
 * the cases here are the ones the two must not disagree about.
 */

import { describe, expect, test } from "bun:test";
import { compareNames, nameSortKey } from "../src/lib/names.ts";

/** The names, put in order the way every caller of this does it. */
const ordered = (...names: string[]) => [...names].sort(compareNames);

describe("a name files under its first real word", () => {
  test("so the article in front of it is not what decides", () => {
    expect(ordered("Zarina", "The Crimson Fist", "Anvil"))
      .toEqual(["Anvil", "The Crimson Fist", "Zarina"]);
  });

  test("whatever case it was typed in", () => {
    // The article is not a name and is not read as one, however it is written.
    expect(ordered("Bruenor", "the anvil", "THE Zarina"))
      .toEqual(["the anvil", "Bruenor", "THE Zarina"]);
  });

  test("and whatever space follows it", () => {
    // A double space is a typo nobody notices making, and a tab is what arrives
    // when a name is pasted out of a spreadsheet.
    expect(nameSortKey("The  Anvil")).toBe("Anvil");
    expect(nameSortKey("The\tAnvil")).toBe("Anvil");
  });
});

describe("the words it must not take for an article", () => {
  test("a name that merely starts with those three letters", () => {
    // `Theodore` is the case this rule is written to survive: the article is a
    // word, not a prefix, which is what the space after it is doing.
    expect(nameSortKey("Theodore")).toBe("Theodore");
    expect(ordered("Theodore", "The Anvil")).toEqual(["The Anvil", "Theodore"]);
  });

  test("an article anywhere but the front", () => {
    // "Sword of the Morning" is filed under S, and the one inside it is part of
    // the name like every other word.
    expect(nameSortKey("Sword of the Morning")).toBe("Sword of the Morning");
    expect(ordered("Sword of the Morning", "The Rat")).toEqual(["The Rat", "Sword of the Morning"]);
  });

  test("or the article standing on its own as the whole name", () => {
    // Nothing follows it, so it is not an article in front of anything — it is
    // the name, and it files under T.
    expect(nameSortKey("The")).toBe("The");
    expect(ordered("The", "Sam")).toEqual(["Sam", "The"]);
  });
});

describe("names that file in the same place", () => {
  test("are still put in a fixed order", () => {
    // Both file under R. Left there the pair would come out in whichever order
    // they arrived in, and the same library would not list the same way twice.
    expect(ordered("The Ravager", "Ravager")).toEqual(["Ravager", "The Ravager"]);
    expect(ordered("Ravager", "The Ravager")).toEqual(["Ravager", "The Ravager"]);
  });

  test("and case alone never decides one", () => {
    // `sensitivity: "base"`, which is what the database's `COLLATE NOCASE` gave
    // this list before the rule moved out of SQL.
    expect(compareNames("elara", "Elara")).toBe(0);
    expect(compareNames("The elara", "Elara")).not.toBe(0);
  });
});
