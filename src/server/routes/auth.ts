/**
 * Sign-in and identity routes.
 */

import type { BunRequest } from "bun";
import { handler, json, noContent, type RequestContext } from "../http.ts";
import { parseJsonBody, schemas } from "../../lib/validate.ts";
import { errors } from "../../lib/errors.ts";
import { loginLimiter } from "../middleware/ratelimit.ts";
import { currentGm, currentPlayer, endGmSession, endPlayerSession, startGmSession } from "../middleware/auth.ts";
import { gms, players, sessionEvents } from "../../db/queries.ts";
import { playerLeft } from "../events.ts";
import { broadcastSession } from "../ws.ts";
import { limits } from "../../lib/config.ts";

/**
 * A valid argon2id hash of a value nobody knows. Verifying against this when the
 * email is unknown keeps a failed sign-in the same cost as a real one, so timing
 * doesn't reveal which addresses have accounts.
 */
const DUMMY_HASH = await Bun.password.hash(
  crypto.randomUUID() + crypto.randomUUID(),
  { algorithm: "argon2id" },
);

const INVALID_CREDENTIALS = "Email or password is incorrect.";

export const authRoutes = {
  "/api/auth/gm/login": {
    POST: handler(async (request: BunRequest, { logger, ip }: RequestContext) => {
      loginLimiter.check(ip);

      const body = await parseJsonBody(request, schemas.gmLogin);
      const email = body.email.trim().toLowerCase();
      const gm = gms.byEmail(email);

      // Always run a verify, even for an unknown address, so both paths cost the same.
      const ok = await Bun.password.verify(body.password, gm?.password_hash ?? DUMMY_HASH);

      if (!gm || !ok) {
        logger.warn("gm sign-in failed", { email });
        // One message for every cause: never confirm that an address exists.
        throw errors.unauthorized(INVALID_CREDENTIALS);
      }

      loginLimiter.reset(ip);
      startGmSession(request, gm.id, Math.floor(limits.gmSessionTtlMs / 1000));
      logger.info("gm signed in", { gmId: gm.id });

      // The same shape `/api/auth/me` answers with, settings and all: signing in
      // and arriving already signed in should put the console in the same state.
      return json({ gm: { id: gm.id, email: gm.email, cardImagePx: gm.card_image_px } });
    }),
  },

  "/api/auth/gm/logout": {
    POST: handler((request: BunRequest, { logger }: RequestContext) => {
      const gm = currentGm(request);
      endGmSession(request);
      if (gm) logger.info("gm signed out", { gmId: gm.id });
      return noContent();
    }),
  },

  /**
   * A player deliberately leaving.
   *
   * Their row goes with them, which frees both their name and the character they
   * were holding — otherwise someone who left could never rejoin, because their
   * own name would still be taken. This is not the same as closing the tab: a
   * refresh or a dropped connection keeps the cookie, and with it the same
   * identity and character for as long as the session runs.
   */
  "/api/auth/player/leave": {
    POST: handler((request: BunRequest, { logger }: RequestContext) => {
      const identity = currentPlayer(request);
      endPlayerSession(request);

      if (identity) {
        players.remove(identity.player.id);
        sessionEvents.record(identity.session.id, playerLeft(identity.player.name));
        logger.info("player left", {
          sessionId: identity.session.id,
          playerId: identity.player.id,
        });
        broadcastSession(identity.session.id);
      }

      return noContent();
    }),
  },

  /**
   * Who the caller is. The client uses this on boot to decide whether to show the
   * sign-in screen, the game master console, or a player's session.
   */
  "/api/auth/me": {
    GET: handler((request: BunRequest) => {
      const gm = currentGm(request);
      // The settings ride along with the identity: the console needs the card
      // size before it draws a card, and this is the call it already makes.
      if (gm) {
        return json({
          kind: "gm",
          gm: { id: gm.id, email: gm.email, cardImagePx: gm.card_image_px },
        });
      }

      const player = currentPlayer(request);
      if (player) {
        return json({
          kind: "player",
          player: {
            id: player.player.id,
            name: player.player.name,
            sessionId: player.session.id,
            claimedCharacterId: player.player.claimed_character_id,
          },
        });
      }

      return json({ kind: "anonymous" });
    }),
  },
};
