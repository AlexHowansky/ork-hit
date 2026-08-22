/**
 * Authentication.
 *
 * Two independent identities exist. A game master signs in with email and
 * password and gets a long-lived cookie. A player redeems a session code, names
 * themselves, and gets a cookie scoped to that one session — so a refresh or a
 * dropped connection resumes the same identity and the same character claim.
 *
 * Both cookies hold a 256-bit random token; only its SHA-256 is stored, so a
 * leaked database cannot be replayed as live sessions.
 */

import type { BunRequest } from "bun";
import { config } from "../../lib/config.ts";
import { errors } from "../../lib/errors.ts";
import { generateToken, hashToken } from "../../lib/ids.ts";
import { campaigns, gameSessions, gmAuthSessions, players } from "../../db/queries.ts";
import type { GameSessionRow, GmRow, PlayerRow } from "../../db/types.ts";

export const GM_COOKIE = "gm_sid";
export const PLAYER_COOKIE = "player_sid";

interface CookieOptions {
  maxAge?: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite: "lax" | "strict" | "none";
  path: string;
}

function cookieOptions(maxAgeSeconds?: number): CookieOptions {
  return {
    ...(maxAgeSeconds === undefined ? {} : { maxAge: maxAgeSeconds }),
    httpOnly: true,
    // Dropped only for local development over plain HTTP; see INSECURE_COOKIES.
    secure: !config.insecureCookies,
    sameSite: "lax",
    path: "/",
  };
}

/* ------------------------------------------------------------- game masters */

export interface GmIdentity {
  kind: "gm";
  gm: GmRow;
}

/** Issues a fresh sign-in cookie and records its hash. */
export function startGmSession(request: BunRequest, gmId: string, maxAgeSeconds: number): void {
  const token = generateToken();
  gmAuthSessions.create(gmId, hashToken(token));
  request.cookies.set(GM_COOKIE, token, cookieOptions(maxAgeSeconds));
}

export function endGmSession(request: BunRequest): void {
  const token = request.cookies.get(GM_COOKIE);
  if (token) gmAuthSessions.remove(hashToken(token));
  request.cookies.delete(GM_COOKIE, { path: "/" });
}

/** The signed-in game master, or null. Extends the sliding session window. */
export function currentGm(request: BunRequest): GmRow | null {
  const token = request.cookies.get(GM_COOKIE);
  if (!token) return null;
  const resolved = gmAuthSessions.resolve(hashToken(token));
  if (!resolved) return null;
  gmAuthSessions.touch(resolved.session.id);
  return resolved.gm;
}

export function requireGm(request: BunRequest): GmRow {
  const gm = currentGm(request);
  if (!gm) throw errors.unauthorized("Please sign in as a game master to continue.");
  return gm;
}

/* ------------------------------------------------------------------ players */

export interface PlayerIdentity {
  kind: "player";
  player: PlayerRow;
  session: GameSessionRow;
}

export function startPlayerSession(request: BunRequest, sessionId: string, name: string): PlayerRow {
  const token = generateToken();
  const player = players.create({ sessionId, name, tokenHash: hashToken(token) });
  // No maxAge: a player's identity is a browser-session cookie, because it is
  // only meaningful for the sitting that is currently in progress.
  request.cookies.set(PLAYER_COOKIE, token, cookieOptions());
  return player;
}

export function endPlayerSession(request: BunRequest): void {
  request.cookies.delete(PLAYER_COOKIE, { path: "/" });
}

/**
 * The current player and the session they belong to, or null. A player whose
 * session has ended — or who was kicked, removing their row — resolves to null.
 */
export function currentPlayer(
  request: BunRequest,
): { player: PlayerRow; session: GameSessionRow } | null {
  const token = request.cookies.get(PLAYER_COOKIE);
  if (!token) return null;
  const player = players.byTokenHash(hashToken(token));
  if (!player) return null;
  const session = gameSessions.byId(player.game_session_id);
  if (!session || session.status !== "active") return null;
  return { player, session };
}

export function requirePlayer(request: BunRequest): { player: PlayerRow; session: GameSessionRow } {
  const identity = currentPlayer(request);
  if (!identity) {
    throw errors.unauthorized("Your session has ended. Ask your game master for a new code.");
  }
  return identity;
}

/* -------------------------------------------------------------------- either */

export type Identity = GmIdentity | PlayerIdentity;

/** Resolves whichever identity the request carries, preferring the game master. */
export function currentIdentity(request: BunRequest): Identity | null {
  const gm = currentGm(request);
  if (gm) return { kind: "gm", gm };
  const player = currentPlayer(request);
  if (player) return { kind: "player", player: player.player, session: player.session };
  return null;
}

/**
 * A game master may only touch their own session. Throws 404 rather than 403 so
 * that probing for another GM's session ids reveals nothing.
 */
export function requireOwnedSession(request: BunRequest, sessionId: string): {
  gm: GmRow;
  session: GameSessionRow;
} {
  const gm = requireGm(request);
  const session = gameSessions.byId(sessionId);
  if (!session || session.gm_id !== gm.id) throw errors.notFound("We couldn't find that session.");
  return { gm, session };
}

/**
 * As above, but also insists the session is still running.
 *
 * An ended session is frozen: its record and history stay readable, but nothing
 * about it can be changed. Every mutating session route goes through this.
 */
export function requireOwnedActiveSession(request: BunRequest, sessionId: string): {
  gm: GmRow;
  session: GameSessionRow;
} {
  const owned = requireOwnedSession(request, sessionId);
  if (owned.session.status !== "active") {
    throw errors.conflict("That session has already ended.");
  }
  return owned;
}

/** Same rule for a campaign. */
export function requireOwnedCampaign(request: BunRequest, campaignId: string) {
  const gm = requireGm(request);
  const campaign = campaigns.byId(campaignId);
  if (!campaign || campaign.gm_id !== gm.id) {
    throw errors.notFound("We couldn't find that campaign.");
  }
  return { gm, campaign };
}
