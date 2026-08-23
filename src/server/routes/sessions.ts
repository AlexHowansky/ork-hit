/**
 * Sessions: starting and ending them, who is in them, which characters are
 * active, the initiative order, and whose turn it is.
 *
 * Every handler that changes something ends by republishing the session snapshot,
 * which is how player screens stay current without a refresh.
 */

import type { BunRequest } from "bun";
import { handler, json, noContent, type RequestContext } from "../http.ts";
import { parse, parseJsonBody, schemas } from "../../lib/validate.ts";
import { errors } from "../../lib/errors.ts";
import { config } from "../../lib/config.ts";
import { generateSessionCode, normalizeSessionCode } from "../../lib/ids.ts";
import { joinLimiter } from "../middleware/ratelimit.ts";
import {
  currentPlayer,
  requireGm,
  requireOwnedActiveSession,
  requireOwnedSession,
  requirePlayer,
  startPlayerSession,
} from "../middleware/auth.ts";
import {
  campaigns,
  characters,
  gameSessions,
  players,
  sessionCharacters,
} from "../../db/queries.ts";
import { db } from "../../db/index.ts";
import { presentSessionForGm } from "../presenters.ts";
import { buildSnapshot } from "../session-state.ts";
import { broadcastSession, closeSessionSockets, disconnectPlayer } from "../ws.ts";

/** The snapshot for a session, or a 404 if it vanished under us. */
function snapshotOr404(sessionId: string) {
  const snapshot = buildSnapshot(sessionId);
  if (!snapshot) throw errors.notFound("We couldn't find that session.");
  return snapshot;
}

/** Publishes the new state and returns it to the caller in the same shape. */
function publish(sessionId: string) {
  const snapshot = snapshotOr404(sessionId);
  broadcastSession(sessionId);
  return json({ snapshot });
}

/* ---------------------------------------------------------------- turn logic */

/**
 * Moves the turn marker one step through the initiative order.
 *
 * Wrapping past the end advances the round; wrapping backwards past the start
 * takes it back, never below one. Computed from the stored order on the server so
 * that two game master tabs can't disagree about whose turn it is.
 */
function advanceTurn(sessionId: string, direction: "next" | "prev") {
  const session = gameSessions.byId(sessionId)!;
  const order = sessionCharacters.list(sessionId);

  if (order.length === 0) {
    throw errors.badRequest("Add some characters to the session before tracking turns.");
  }

  const currentIndex = session.active_character_id
    ? order.findIndex((character) => character.id === session.active_character_id)
    : -1;

  // With no turn set yet, stepping forward starts at the top of the order and
  // stepping back starts at the bottom.
  if (currentIndex === -1) {
    const startIndex = direction === "next" ? 0 : order.length - 1;
    gameSessions.setTurn(sessionId, order[startIndex]!.id, session.round);
    return;
  }

  const step = direction === "next" ? 1 : -1;
  const nextIndex = (currentIndex + step + order.length) % order.length;

  let round = session.round;
  if (direction === "next" && nextIndex === 0) round += 1;
  if (direction === "prev" && currentIndex === 0) round = Math.max(1, round - 1);

  gameSessions.setTurn(sessionId, order[nextIndex]!.id, round);
}

/* ------------------------------------------------------------------- routes */

export const sessionRoutes = {
  "/api/sessions": {
    GET: handler((request: BunRequest) => {
      const gm = requireGm(request);
      const list = gameSessions.listForGm(gm.id).flatMap((session) => {
        const campaign = campaigns.byId(session.campaign_id);
        return campaign ? [presentSessionForGm(session, campaign)] : [];
      });
      return json({ sessions: list });
    }),

    POST: handler(async (request: BunRequest, { logger }: RequestContext) => {
      const gm = requireGm(request);
      const body = await parseJsonBody(request, schemas.sessionStart);

      const campaign = campaigns.byId(body.campaignId);
      if (!campaign || campaign.gm_id !== gm.id) {
        throw errors.notFound("We couldn't find that campaign.");
      }

      // The party comes along with the session: one transaction, so a session can
      // never exist with the roster half built.
      const session = db.transaction(() => {
        const created = gameSessions.create({
          campaignId: campaign.id,
          gmId: gm.id,
          code: generateSessionCode(),
        });
        sessionCharacters.addCampaignPcs(created.id, campaign.id);
        return created;
      })();
      logger.info("session started", {
        sessionId: session.id,
        campaignId: campaign.id,
        characters: sessionCharacters.list(session.id).length,
      });

      return json(
        {
          session: presentSessionForGm(session, campaign),
          joinUrl: `${config.appOrigin}/join?code=${encodeURIComponent(session.code)}`,
        },
        { status: 201 },
      );
    }),
  },

  /** The live state of a session, for whoever is entitled to see it. */
  "/api/sessions/:id": {
    GET: handler((request: BunRequest<"/api/sessions/:id">) => {
      const sessionId = request.params.id;
      const player = currentPlayer(request);

      if (!player || player.session.id !== sessionId) {
        // Not the player's own session, so this has to be the owning GM.
        requireOwnedSession(request, sessionId);
      }

      return json({ snapshot: snapshotOr404(sessionId) });
    }),
  },

  "/api/sessions/:id/end": {
    POST: handler((request: BunRequest<"/api/sessions/:id/end">, { logger }: RequestContext) => {
      const { session } = requireOwnedSession(request, request.params.id);

      gameSessions.end(session.id);
      logger.info("session ended", { sessionId: session.id });

      // Tell everyone before dropping their connections, so the player screens
      // can explain what happened rather than just going quiet.
      closeSessionSockets(session.id);

      return noContent();
    }),
  },

  /* ------------------------------------------------ active character roster */

  "/api/sessions/:id/characters/:characterId": {
    POST: handler(
      (
        request: BunRequest<"/api/sessions/:id/characters/:characterId">,
        { logger }: RequestContext,
      ) => {
        const { gm, session } = requireOwnedActiveSession(request, request.params.id);

        const character = characters.byId(request.params.characterId);
        // A session belongs to one campaign, so only that campaign's characters
        // can be brought into it.
        if (!character || character.campaign_id !== session.campaign_id) {
          throw errors.notFound("We couldn't find that character in this campaign.");
        }
        const campaign = campaigns.byId(character.campaign_id);
        if (campaign?.gm_id !== gm.id) throw errors.notFound("We couldn't find that character.");

        sessionCharacters.add(session.id, character.id);
        logger.info("character added to session", {
          sessionId: session.id,
          characterId: character.id,
        });

        return publish(session.id);
      },
    ),

    DELETE: handler(
      (
        request: BunRequest<"/api/sessions/:id/characters/:characterId">,
        { logger }: RequestContext,
      ) => {
        const { session } = requireOwnedActiveSession(request, request.params.id);
        // Also closes the gap in the initiative order, releases any claim on the
        // character, and clears the turn marker if it was pointing here.
        sessionCharacters.remove(session.id, request.params.characterId);
        logger.info("character removed from session", {
          sessionId: session.id,
          characterId: request.params.characterId,
        });
        return publish(session.id);
      },
    ),
  },

  /* ------------------------------------------------------ initiative order */

  "/api/sessions/:id/order": {
    PUT: handler(
      async (request: BunRequest<"/api/sessions/:id/order">, { logger }: RequestContext) => {
        const { session } = requireOwnedActiveSession(request, request.params.id);
        const { order } = await parseJsonBody(request, schemas.reorder);

        const current = sessionCharacters.list(session.id).map((character) => character.id);

        // The request must describe exactly the current membership. Rejecting a
        // stale list is what keeps two game master tabs from fighting: the loser
        // is told to re-read rather than silently dropping a character.
        const submitted = new Set(order);
        const matches =
          submitted.size === order.length &&
          order.length === current.length &&
          current.every((id) => submitted.has(id));

        if (!matches) {
          throw errors.conflict(
            "The session changed while you were reordering. It has been refreshed — please try again.",
          );
        }

        sessionCharacters.reorder(session.id, order);
        logger.info("initiative reordered", { sessionId: session.id, count: order.length });

        return publish(session.id);
      },
    ),
  },

  /* ----------------------------------------------------------- turn marker */

  "/api/sessions/:id/turn": {
    POST: handler(
      async (request: BunRequest<"/api/sessions/:id/turn">, { logger }: RequestContext) => {
        const { session } = requireOwnedActiveSession(request, request.params.id);
        const { characterId } = await parseJsonBody(request, schemas.setTurn);

        if (characterId !== null && !sessionCharacters.isMember(session.id, characterId)) {
          throw errors.badRequest("That character isn't active in this session.");
        }

        gameSessions.setTurn(session.id, characterId, session.round);
        logger.info("turn set", { sessionId: session.id, characterId });

        return publish(session.id);
      },
    ),
  },

  "/api/sessions/:id/turn/advance": {
    POST: handler(
      async (request: BunRequest<"/api/sessions/:id/turn/advance">, { logger }: RequestContext) => {
        const { session } = requireOwnedActiveSession(request, request.params.id);
        const { direction } = await parseJsonBody(request, schemas.advanceTurn);

        advanceTurn(session.id, direction);
        logger.info("turn advanced", { sessionId: session.id, direction });

        return publish(session.id);
      },
    ),
  },

  /* ---------------------------------------------------------- joining, PCs */

  "/api/sessions/join": {
    POST: handler(async (request: BunRequest, { logger, ip }: RequestContext) => {
      joinLimiter.check(ip);

      const body = await parseJsonBody(request, schemas.sessionJoin);
      const code = normalizeSessionCode(body.code);
      // A malformed code never reaches the database.
      const session = code ? gameSessions.activeByCode(code) : null;

      if (!session) {
        logger.warn("session join failed");
        throw errors.notFound(
          "That code isn't valid. Check it with your game master — sessions stop accepting their code once they end.",
        );
      }

      if (players.nameTaken(session.id, body.name)) {
        throw errors.conflict(
          `Someone in this session is already called “${body.name}”. Please pick another name.`,
        );
      }

      joinLimiter.reset(ip);
      const player = startPlayerSession(request, session.id, body.name);
      logger.info("player joined", { sessionId: session.id, playerId: player.id });

      broadcastSession(session.id);
      return json(
        {
          player: { id: player.id, name: player.name, sessionId: session.id },
          snapshot: snapshotOr404(session.id),
        },
        { status: 201 },
      );
    }),
  },

  /** A player takes a player character for the rest of the session. */
  "/api/sessions/:id/claim": {
    POST: handler(
      async (request: BunRequest<"/api/sessions/:id/claim">, { logger }: RequestContext) => {
        const { player, session } = requirePlayer(request);
        if (session.id !== request.params.id) throw errors.forbidden();

        const { characterId } = await parseJsonBody(request, schemas.claim);

        const character = characters.byId(characterId);
        if (!character || !sessionCharacters.isMember(session.id, characterId)) {
          throw errors.notFound("We couldn't find that character in this session.");
        }
        if (character.kind !== "pc") {
          throw errors.badRequest("Only player characters can be played by a player.");
        }

        // Checking and claiming in one transaction is what makes two players
        // racing for the same character resolve to exactly one winner; the unique
        // index on (session, claimed character) is the backstop.
        const claim = db.transaction(() => {
          const holder = players.holderOf(session.id, characterId);
          if (holder && holder.id !== player.id) return false;
          players.setClaim(player.id, characterId);
          return true;
        });

        let won = false;
        try {
          won = claim();
        } catch {
          won = false;
        }

        if (!won) {
          throw errors.conflict("Another player just took that character. Please choose another.");
        }

        logger.info("character claimed", {
          sessionId: session.id,
          playerId: player.id,
          characterId,
        });
        return publish(session.id);
      },
    ),
  },

  /* -------------------------------------------------- game master oversight */

  "/api/sessions/:id/players/:playerId": {
    /** Release a claim, or hand the character to this player instead. */
    PATCH: handler(
      async (
        request: BunRequest<"/api/sessions/:id/players/:playerId">,
        { logger }: RequestContext,
      ) => {
        const { session } = requireOwnedActiveSession(request, request.params.id);
        const player = players.byId(request.params.playerId);
        if (!player || player.game_session_id !== session.id) {
          throw errors.notFound("We couldn't find that player.");
        }

        const { claimedCharacterId } = await parseJsonBody(request, schemas.playerUpdate);

        if (claimedCharacterId !== null) {
          const character = characters.byId(claimedCharacterId);
          if (!character || !sessionCharacters.isMember(session.id, claimedCharacterId)) {
            throw errors.notFound("We couldn't find that character in this session.");
          }
          if (character.kind !== "pc") {
            throw errors.badRequest("Only player characters can be assigned to a player.");
          }
          // Reassigning takes the character off whoever holds it now.
          const holder = players.holderOf(session.id, claimedCharacterId);
          if (holder && holder.id !== player.id) players.setClaim(holder.id, null);
        }

        players.setClaim(player.id, claimedCharacterId);
        logger.info("player claim changed by gm", {
          sessionId: session.id,
          playerId: player.id,
          characterId: claimedCharacterId,
        });

        return publish(session.id);
      },
    ),

    /** Remove a player from the session and disconnect them. */
    DELETE: handler(
      (request: BunRequest<"/api/sessions/:id/players/:playerId">, { logger }: RequestContext) => {
        const { session } = requireOwnedActiveSession(request, request.params.id);
        const player = players.byId(request.params.playerId);
        if (!player || player.game_session_id !== session.id) {
          throw errors.notFound("We couldn't find that player.");
        }

        // Removing the row releases the claim (the column is ON DELETE SET NULL
        // for others, and the row itself is what held it) and invalidates the
        // player's cookie, since it resolves through this row.
        players.remove(player.id);
        logger.info("player kicked", { sessionId: session.id, playerId: player.id });

        disconnectPlayer(player.id);
        return publish(session.id);
      },
    ),
  },
};

export { advanceTurn };
