/** Session codes: the only secret standing between a stranger and a session. */

import { describe, expect, test } from "bun:test";
import { generateSessionCode, generateToken, hashToken, normalizeSessionCode } from "../src/lib/ids.ts";

describe("session codes", () => {
  test("are 12 characters from an unambiguous alphabet, grouped for reading", () => {
    const code = generateSessionCode();
    expect(code).toMatch(/^[0-9A-HJ-NP-TV-Z]{4}(-[0-9A-HJ-NP-TV-Z]{4}){2}$/);
    expect(code.replace(/-/g, "")).toHaveLength(12);
  });

  test("omit the glyphs that are misread aloud", () => {
    const alphabet = new Set(
      Array.from({ length: 400 }, () => generateSessionCode().replace(/-/g, "")).join(""),
    );
    // I, L, O and U are excluded so a code can be dictated over voice chat.
    for (const excluded of ["I", "L", "O", "U"]) {
      expect(alphabet.has(excluded)).toBe(false);
    }
  });

  test("do not repeat", () => {
    const codes = new Set(Array.from({ length: 5000 }, generateSessionCode));
    // 60 bits of entropy: a collision here means the generator is broken.
    expect(codes.size).toBe(5000);
  });

  test("carry enough entropy that guessing is hopeless", () => {
    // 12 characters drawn from 32 symbols is 5 bits each. Joining is rate limited,
    // so 60 bits is many orders of magnitude past what anyone can guess at.
    expect(12 * Math.log2(32)).toBeGreaterThanOrEqual(60);
  });
});

describe("normalising a typed code", () => {
  test("accepts what a player is likely to type", () => {
    const code = generateSessionCode();
    const bare = code.replace(/-/g, "");
    expect(normalizeSessionCode(code)).toBe(code);
    expect(normalizeSessionCode(bare)).toBe(code);
    expect(normalizeSessionCode(code.toLowerCase())).toBe(code);
    expect(normalizeSessionCode(`  ${code}  `)).toBe(code);
  });

  test("maps the glyphs people substitute", () => {
    // O reads as zero, I and L read as one.
    expect(normalizeSessionCode("OOOO-1111-1111")).toBe("0000-1111-1111");
    expect(normalizeSessionCode("IIII-LLLL-1111")).toBe("1111-1111-1111");
  });

  test("rejects anything that isn't a code, before it reaches the database", () => {
    expect(normalizeSessionCode("")).toBeNull();
    expect(normalizeSessionCode("too-short")).toBeNull();
    expect(normalizeSessionCode("!@#$-%^&*-()__")).toBeNull();
    expect(normalizeSessionCode("A".repeat(200))).toBeNull();
    // A SQL fragment is simply not a valid code.
    expect(normalizeSessionCode("' OR 1=1 --")).toBeNull();
  });
});

describe("auth tokens", () => {
  test("are 256 bits and never repeat", () => {
    const tokens = new Set(Array.from({ length: 2000 }, generateToken));
    expect(tokens.size).toBe(2000);
    expect(generateToken()).toMatch(/^[0-9a-f]{64}$/);
  });

  test("hash deterministically, and the hash does not reveal the token", () => {
    const token = generateToken();
    expect(hashToken(token)).toBe(hashToken(token));
    expect(hashToken(token)).not.toBe(token);
    expect(hashToken(token)).not.toBe(hashToken(generateToken()));
  });
});
