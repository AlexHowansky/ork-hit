/** Password handling and the lifetime of a sign-in. */

import { describe, expect, test } from "bun:test";
import { gmAuthSessions, gms } from "../src/db/queries.ts";
import { db } from "../src/db/index.ts";
import { generateToken, hashToken } from "../src/lib/ids.ts";
import { unique } from "./helpers.ts";

async function hash(password: string) {
  return await Bun.password.hash(password, { algorithm: "argon2id" });
}

describe("passwords", () => {
  test("verify against their own hash and nothing else", async () => {
    const stored = await hash("a-perfectly-fine-password");
    expect(await Bun.password.verify("a-perfectly-fine-password", stored)).toBe(true);
    expect(await Bun.password.verify("a-perfectly-fine-passwore", stored)).toBe(false);
    expect(await Bun.password.verify("", stored)).toBe(false);
  });

  test("are hashed with argon2id and salted per account", async () => {
    const first = await hash("identical-password-here");
    const second = await hash("identical-password-here");
    expect(first).toStartWith("$argon2id$");
    // Distinct salts mean identical passwords never share a hash.
    expect(first).not.toBe(second);
  });

  test("are never recoverable from the stored record", async () => {
    const gm = gms.create(`${unique("gm")}@example.com`, await hash("secret-password-here"));
    expect(gm.password_hash).not.toContain("secret-password-here");
  });
});

describe("sign-in sessions", () => {
  test("resolve from the token, and only the hash is stored", () => {
    const gm = gms.create(`${unique("gm")}@example.com`, "hash");
    const token = generateToken();
    const session = gmAuthSessions.create(gm.id, hashToken(token));

    expect(session.token_hash).not.toBe(token);
    expect(gmAuthSessions.resolve(hashToken(token))!.gm.id).toBe(gm.id);
    expect(gmAuthSessions.resolve(hashToken(generateToken()))).toBeNull();
  });

  test("stop resolving once expired", () => {
    const gm = gms.create(`${unique("gm")}@example.com`, "hash");
    const token = generateToken();
    const session = gmAuthSessions.create(gm.id, hashToken(token));

    db.query("UPDATE gm_auth_sessions SET expires_at = $past WHERE id = $id")
      .run({ id: session.id, past: new Date(Date.now() - 1000).toISOString() });

    expect(gmAuthSessions.resolve(hashToken(token))).toBeNull();
  });

  test("respect the absolute cap even when recently used", () => {
    const gm = gms.create(`${unique("gm")}@example.com`, "hash");
    const token = generateToken();
    const session = gmAuthSessions.create(gm.id, hashToken(token));

    // Still inside the sliding window, but past the hard ceiling.
    db.query("UPDATE gm_auth_sessions SET absolute_expires_at = $past WHERE id = $id")
      .run({ id: session.id, past: new Date(Date.now() - 1000).toISOString() });

    expect(gmAuthSessions.resolve(hashToken(token))).toBeNull();
  });

  test("signing out revokes only that one session", () => {
    const gm = gms.create(`${unique("gm")}@example.com`, "hash");
    const phone = generateToken();
    const laptop = generateToken();
    gmAuthSessions.create(gm.id, hashToken(phone));
    gmAuthSessions.create(gm.id, hashToken(laptop));

    gmAuthSessions.remove(hashToken(phone));

    expect(gmAuthSessions.resolve(hashToken(phone))).toBeNull();
    expect(gmAuthSessions.resolve(hashToken(laptop))).not.toBeNull();
  });

  test("changing a password signs every browser out", async () => {
    const gm = gms.create(`${unique("gm")}@example.com`, await hash("old-password-here"));
    const token = generateToken();
    gmAuthSessions.create(gm.id, hashToken(token));

    gms.update(gm.id, { passwordHash: await hash("new-password-here") });

    expect(gmAuthSessions.resolve(hashToken(token))).toBeNull();
  });

  test("deleting an account takes its sessions with it", () => {
    const gm = gms.create(`${unique("gm")}@example.com`, "hash");
    const token = generateToken();
    gmAuthSessions.create(gm.id, hashToken(token));

    gms.remove(gm.id);

    expect(gmAuthSessions.resolve(hashToken(token))).toBeNull();
  });
});

describe("email addresses", () => {
  test("match case-insensitively, so sign-in isn't case sensitive", () => {
    const address = `${unique("Mixed")}@Example.COM`;
    const gm = gms.create(address.toLowerCase(), "hash");

    expect(gms.byEmail(address.toUpperCase())!.id).toBe(gm.id);
    expect(gms.byEmail(address.toLowerCase())!.id).toBe(gm.id);
  });
});
