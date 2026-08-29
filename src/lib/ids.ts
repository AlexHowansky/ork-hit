/**
 * Identifier and token generation. Everything here draws from the CSPRNG.
 */

/**
 * Crockford base32 minus the ambiguous glyphs (I, L, O, U are already excluded by
 * the alphabet). Session codes get read aloud over voice chat, so the alphabet
 * avoids characters that sound or look alike.
 */
const CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** Characters in a session code. 12 x 5 bits = 60 bits of entropy. */
const CODE_LENGTH = 12;

/** Groups of 4, hyphen separated, so a human can transcribe it without losing place. */
const CODE_GROUP = 4;

function randomFromAlphabet(alphabet: string, length: number): string {
  const bytes = new Uint8Array(length);
  const out: string[] = [];
  // Reject-and-resample so every character is uniformly distributed. With a
  // 32-character alphabet and a 256-value byte, 256 is an exact multiple of 32,
  // so no byte is ever rejected — but the guard keeps this correct if the
  // alphabet ever changes length.
  const limit = Math.floor(256 / alphabet.length) * alphabet.length;
  while (out.length < length) {
    crypto.getRandomValues(bytes);
    for (const byte of bytes) {
      if (out.length === length) break;
      if (byte >= limit) continue;
      out.push(alphabet[byte % alphabet.length]!);
    }
  }
  return out.join("");
}

/** A fresh session code, formatted for display: `XXXX-XXXX-XXXX`. */
export function generateSessionCode(): string {
  const raw = randomFromAlphabet(CODE_ALPHABET, CODE_LENGTH);
  const groups: string[] = [];
  for (let i = 0; i < raw.length; i += CODE_GROUP) {
    groups.push(raw.slice(i, i + CODE_GROUP));
  }
  return groups.join("-");
}

/**
 * Canonicalizes a code typed by a player: uppercases, strips separators and
 * whitespace, and maps the glyphs people commonly substitute (O for 0, I/L for 1).
 * Returns null when the result isn't a plausible code, so the caller can reject
 * without touching the database.
 */
export function normalizeSessionCode(input: string): string | null {
  const cleaned = input
    .toUpperCase()
    .replace(/[\s-]/g, "")
    .replace(/O/g, "0")
    .replace(/[IL]/g, "1");
  if (cleaned.length !== CODE_LENGTH) return null;
  for (const char of cleaned) {
    if (!CODE_ALPHABET.includes(char)) return null;
  }
  const groups: string[] = [];
  for (let i = 0; i < cleaned.length; i += CODE_GROUP) {
    groups.push(cleaned.slice(i, i + CODE_GROUP));
  }
  return groups.join("-");
}

/** A 256-bit opaque bearer token, hex encoded, for auth cookies. */
export function generateToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return bytes.toHex();
}

/**
 * Hashes an auth token for storage. Tokens are already high-entropy random
 * values, so a fast hash is the right tool — this defends against a leaked
 * database being replayed as live sessions, not against guessing.
 */
export function hashToken(token: string): string {
  return new Bun.CryptoHasher("sha256").update(token).digest("hex");
}

/** A primary key. UUIDv7 so rows sort by creation time in an index. */
export function newId(): string {
  return Bun.randomUUIDv7();
}
