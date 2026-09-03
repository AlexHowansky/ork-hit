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
  sessionEvents,
} from "../../db/queries.ts";
import { db } from "../../db/index.ts";
import type { GameSessionRow, PlayerRow, SessionCharacterRow } from "../../db/types.ts";
import {
  actsIn,
  OPENING_SEGMENT,
  POST_SEGMENT_12_NOTICE,
  SEGMENTS_PER_TURN,
  tagLabel,
} from "../../lib/hero.ts";
import {
  GAME_MASTER,
  SESSION_STARTED,
  actionHeld,
  actionTaken,
  gmAddedToScene,
  gmAssigned,
  gmKicked,
  gmReassigned,
  gmRemovedFromScene,
  gmUnassigned,
  playerJoined,
  playerSelected,
  segmentBegan,
  tagsAdded,
  tagsRemoved,
} from "../events.ts";
import { presentSessionForGm } from "../presenters.ts";
import { buildGmSessionList, buildSnapshot } from "../session-state.ts";
import {
  broadcastGmSessions,
  broadcastSession,
  broadcastSessionNotice,
  closeSessionSockets,
  disconnectPlayer,
} from "../ws.ts";

/** The snapshot for a session, or a 404 if it vanished under us. */
function snapshotOr404(sessionId: string) {
  const snapshot = buildSnapshot(sessionId);
  if (!snapshot) throw errors.notFound("We couldn't find that session.");
  return snapshot;
}

/**
 * Who may write a stage slot.
 *
 * The game master runs the fight and may write any slot; a player may write
 * exactly the slot holding the character they claimed, because spending your own
 * END, taking your own STUN and saying you have been knocked prone are the parts
 * of the bookkeeping that belong to the person playing. Shared by every route
 * that writes a slot, so there is one answer to the question rather than four
 * that could drift apart.
 */
function requireSlotAccess(
  request: BunRequest<
    | "/api/sessions/:id/stage/:slotId/vitals"
    | "/api/sessions/:id/stage/:slotId/recover"
    | "/api/sessions/:id/stage/:slotId/rest"
    | "/api/sessions/:id/stage/:slotId/tags"
  >,
): { session: GameSessionRow; asPlayer: boolean; player: PlayerRow | null } {
  const sessionId = request.params.id;
  const identity = currentPlayer(request);
  const asPlayer = identity !== null && identity.session.id === sessionId;

  // Not this session's player, so it has to be the owning game master — and the
  // same rule as every other mutation: an ended session is frozen.
  const session = asPlayer
    ? identity.session
    : requireOwnedActiveSession(request, sessionId).session;

  const characterId = sessionCharacters.characterInSlot(session.id, request.params.slotId);
  if (!characterId) throw errors.badRequest("That character isn't active in this session.");

  if (asPlayer && characterId !== identity.player.claimed_character_id) {
    throw errors.forbidden("You can only change your own character.");
  }

  // The player row comes back too, since a line in the log is written in the
  // name of whoever pressed. Null is the game master, who is the only other
  // reader that gets this far.
  return { session, asPlayer, player: asPlayer ? identity.player : null };
}

/** Publishes the new state and returns it to the caller in the same shape. */
function publish(sessionId: string) {
  const snapshot = snapshotOr404(sessionId);
  broadcastSession(sessionId);
  return json({ snapshot });
}

/* ---------------------------------------------------------------- turn logic */

/**
 * Who acts in one segment, in the order they act.
 *
 * The stage arrives from `list` already in DEX+INIT order, so this only has to
 * drop the characters whose SPD gives them no phase here. A SPD of nought is an
 * empty row of the chart and so is never in the answer — a character nobody has
 * filled in has no phases, and never comes up on turn.
 */
function actorsIn(stage: SessionCharacterRow[], segment: number): SessionCharacterRow[] {
  return stage.filter((row) => actsIn(row.speed, segment));
}

/** The segment after this one, wrapping 12 back to 1. */
function nextSegment(segment: number): number {
  return segment === SEGMENTS_PER_TURN ? 1 : segment + 1;
}

/** And the one before, wrapping 1 back to 12. */
function prevSegment(segment: number): number {
  return segment === 1 ? SEGMENTS_PER_TURN : segment - 1;
}

/**
 * What a slot is called in the log: the character's name, and its copy number
 * when it has one.
 *
 * The stage may hold three of the same goblin, and three identical lines saying
 * one was added would tell a table nothing about which. The rule is the
 * initiative list's — a number only from the second copy on — so the log calls a
 * monster what the console beside it calls the same monster.
 *
 * Answers null for a slot that is not on this stage, which is the same nothing
 * `sessionCharacters.remove` does with one.
 */
function sceneName(sessionId: string, slotId: string): string | null {
  const slot = sessionCharacters.list(sessionId).find((row) => row.slot_id === slotId);
  if (!slot) return null;
  return slot.copy_number > 1 ? `${slot.name} ${slot.copy_number}` : slot.name;
}

/**
 * Moves the turn marker one phase through the HERO clock.
 *
 * A Turn is twelve segments, and which of them a character acts in is their SPD
 * read off the Speed Chart; within a segment they go in DEX+INIT order, highest
 * first. So stepping forward is: the next character acting in this segment, or
 * else the first character of the next segment anybody acts in.
 *
 * The turn counter goes up on *arriving at segment 1*, not on passing segment
 * 12. That is what makes a fight open on Turn 1 Segment 12 and the first Segment
 * 1 belong to Turn 2, which is how HERO starts a combat.
 *
 * Segments nobody acts in are stepped straight over rather than shown empty: a
 * segment with no phases in it is not a moment anyone at the table waits through.
 *
 * All of it is computed here from the stored state rather than in the browser, so
 * two game master tabs cannot disagree about where in the turn the fight is.
 *
 * Answers whether the step finished Segment 12 — whether, in other words, the
 * stage has just taken its Post-Segment 12 Recovery — so the caller can say so
 * on the screens. Stepping back never gives it: `Previous` retraces the path,
 * and a Recovery already taken is not untaken by the game master correcting a
 * click. Where the fight is left is the same either way.
 */
function advanceTurn(sessionId: string, direction: "next" | "prev"): boolean {
  const session = gameSessions.byId(sessionId)!;
  const stage = sessionCharacters.list(sessionId);

  if (stage.length === 0) {
    throw errors.badRequest("Add some characters to the session before tracking turns.");
  }

  // Every walk below looks for the next segment somebody acts in, so a stage
  // where nobody acts at all would search all twelve and find nothing. Said
  // plainly here rather than left to a loop guard, because the fix is on the
  // character sheets and the game master is the one who can make it.
  if (!stage.some((row) => row.speed > 0)) {
    throw errors.badRequest(
      "Nobody on the stage has a SPD above zero, so no one has a phase to take. Fill in their SPEED first.",
    );
  }

  // Nothing happened before the fight started, so there is nowhere for Previous
  // to go from the state Restart leaves behind.
  if (
    direction === "prev" &&
    session.active_slot_id === null &&
    session.turn === 1 &&
    session.segment === OPENING_SEGMENT
  ) {
    return false;
  }

  // A held action taken out of order is an interruption, and the step out of one
  // is back to whoever it interrupted — in either direction, because the marker
  // is standing on the holder rather than anywhere in the order. The character
  // who was up had not finished their phase when the holder cut in, so the fight
  // returns to them rather than walking on past them; the step after that is an
  // ordinary one, from where the order really was.
  if (session.resume_slot_id) {
    gameSessions.setTurn(sessionId, session.resume_slot_id, session.turn, session.segment);
    gameSessions.setResume(sessionId, null);
    return false;
  }

  const step = direction === "next" ? 1 : -1;
  const here = actorsIn(stage, session.segment);

  // Where the marker is in this segment. -1 covers both "no turn set" and a
  // marker left on a character who has since been taken off the stage.
  const index = session.active_slot_id
    ? here.findIndex((row) => row.slot_id === session.active_slot_id)
    : -1;

  // Somewhere still to go inside this segment: the common case, and the only one
  // that leaves the clock alone.
  if (index !== -1) {
    const withinSegment = index + step;
    if (withinSegment >= 0 && withinSegment < here.length) {
      gameSessions.setTurn(sessionId, here[withinSegment]!.slot_id, session.turn, session.segment);
      return false;
    }

    // Stepping back off the very first phase of the fight. There is nothing
    // before it, so this puts the session where Restart leaves it — Turn 1,
    // Segment 12, nobody on turn — rather than walking into a segment that has
    // not happened.
    if (direction === "prev" && session.turn === 1 && session.segment === OPENING_SEGMENT) {
      gameSessions.setTurn(sessionId, null, 1, OPENING_SEGMENT);
      return false;
    }
  } else if (here.length > 0) {
    // No marker, but this segment has phases in it: take the end the direction
    // came from. Stepping forward opens the segment; stepping back closes it.
    const entry = direction === "next" ? here[0]! : here[here.length - 1]!;
    // Nothing to announce: the clock stays where it was, and wherever that is,
    // it said so on the way in — a session and a Restart both write the opening
    // segment as they set it, so the first press of Next is only the marker
    // arriving at the first character of a segment already begun.
    gameSessions.setTurn(sessionId, entry.slot_id, session.turn, session.segment);
    return false;
  }

  // Off the end of the segment, so walk the clock to the next one anybody acts
  // in. Bounded by the twelve segments of a turn: with someone on stage who has
  // a SPD at all, one of them is theirs.
  let segment = session.segment;
  let turn = session.turn;
  let recovered = false;

  for (let hops = 0; hops < SEGMENTS_PER_TURN; hops += 1) {
    if (direction === "next") {
      segment = nextSegment(segment);
      // Arriving at segment 1 is what starts a new turn — and leaving segment 12
      // behind is what everybody on the stage takes a Recovery for. Taken here,
      // as the clock passes, rather than on landing: the phases of the new turn
      // are fought with the ENDURANCE and STUN it hands back, and a stage that
      // walks on through several empty segments still only crossed 12 once.
      if (segment === 1) {
        turn += 1;
        sessionCharacters.takeRecoveryAll(sessionId);
        recovered = true;
      }
    } else {
      // And leaving it is what ends one. Never below turn 1: the start of the
      // fight is a floor, not a wrap.
      if (segment === 1) turn = Math.max(1, turn - 1);
      segment = prevSegment(segment);
    }

    const actors = actorsIn(stage, segment);
    if (actors.length === 0) continue;

    const entry = direction === "next" ? actors[0]! : actors[actors.length - 1]!;
    // Only the walk writes a segment line. The step inside a segment above
    // moves the marker from one character to the next and the clock never
    // leaves where it was, so there is no new segment for it to announce.
    sessionEvents.record(sessionId, segmentBegan(turn, segment));
    gameSessions.setTurn(sessionId, entry.slot_id, turn, segment);
    return recovered;
  }

  return recovered;
}

/* ------------------------------------------------------------------- routes */

export const sessionRoutes = {
  "/api/sessions": {
    GET: handler((request: BunRequest) => {
      const gm = requireGm(request);
      return json({ sessions: buildGmSessionList(gm.id) });
    }),

    POST: handler(async (request: BunRequest, { logger }: RequestContext) => {
      const gm = requireGm(request);
      const body = await parseJsonBody(request, schemas.sessionStart);

      const campaign = campaigns.byId(body.campaignId);
      if (!campaign || campaign.gm_id !== gm.id) {
        throw errors.notFound("We couldn't find that campaign.");
      }

      const running = gameSessions.activeForCampaign(campaign.id);
      if (running) {
        throw errors.conflict(
          "That campaign already has a session running. End it before starting another.",
        );
      }

      // The party and the first line of the log come along with the session: one
      // transaction, so a session can never exist with the roster half built or
      // with a log that does not say when it began.
      const session = db.transaction(() => {
        const created = gameSessions.create({
          campaignId: campaign.id,
          gmId: gm.id,
          code: generateSessionCode(),
        });
        sessionCharacters.addCampaignPcs(created.id, campaign.id);
        // Written here rather than broadcast as a notice because there is nobody
        // to broadcast to yet: the console that started the session has not
        // opened its socket, and the players have not been given the code. The
        // only way this line is ever read is out of the database, in the
        // snapshot every screen gets when it connects.
        sessionEvents.record(created.id, SESSION_STARTED);
        // And where the fight stands: HERO opens a combat in Segment 12, and a
        // session is created sitting there. The clock announces every segment it
        // is put at, this one included, so a log read back later never has a
        // stretch of events belonging to a segment it never named.
        sessionEvents.record(created.id, segmentBegan(created.turn, created.segment));
        return created;
      })();
      logger.info("session started", {
        sessionId: session.id,
        campaignId: campaign.id,
        characters: sessionCharacters.list(session.id).length,
      });

      // Any library this game master has open picks the new session up here.
      broadcastGmSessions(gm.id);

      return json(
        {
          session: presentSessionForGm(session, campaign, 0),
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
      const { gm, session } = requireOwnedSession(request, request.params.id);

      gameSessions.end(session.id);
      logger.info("session ended", { sessionId: session.id });

      // Tell everyone before dropping their connections, so the player screens
      // can explain what happened rather than just going quiet.
      closeSessionSockets(session.id);
      broadcastGmSessions(gm.id);

      return noContent();
    }),
  },

  /* --------------------------------------------------------------- the stage */

  /**
   * The stage: the characters in play, each in a slot of its own.
   *
   * Adding names a character, removing names a slot, and the two routes are
   * shaped to say so. They have to differ: an NPC may stand in three slots at
   * once, so "remove Strahd" is no longer a question with one answer.
   */
  "/api/sessions/:id/stage": {
    POST: handler(
      async (request: BunRequest<"/api/sessions/:id/stage">, { logger }: RequestContext) => {
        const { gm, session } = requireOwnedActiveSession(request, request.params.id);
        const { characterId } = await parseJsonBody(request, schemas.stageAdd);

        const character = characters.byId(characterId);
        // A session belongs to one campaign, so only that campaign's characters
        // can be brought into it.
        if (!character || character.campaign_id !== session.campaign_id) {
          throw errors.notFound("We couldn't find that character in this campaign.");
        }
        const campaign = campaigns.byId(character.campaign_id);
        if (campaign?.gm_id !== gm.id) throw errors.notFound("We couldn't find that character.");

        // A repeated PC comes back null and changes nothing, which is the same
        // no-op the old ON CONFLICT gave and needs no complaint of its own —
        // and nothing happened, so nothing is written down either.
        const slotId = sessionCharacters.add(session.id, character.id, character.kind);
        if (slotId !== null) {
          const staged = sceneName(session.id, slotId) ?? character.name;
          sessionEvents.record(session.id, gmAddedToScene(staged));
        }
        logger.info("character added to session", {
          sessionId: session.id,
          characterId: character.id,
          slotId,
        });

        return publish(session.id);
      },
    ),
  },

  "/api/sessions/:id/stage/:slotId": {
    DELETE: handler(
      (request: BunRequest<"/api/sessions/:id/stage/:slotId">, { logger }: RequestContext) => {
        const { session } = requireOwnedActiveSession(request, request.params.id);
        // Read before the delete, since afterwards there is no row to ask who
        // was standing here. A slot that was never on this stage leaves nothing
        // to say, and `remove` is a no-op for it in the same way.
        const leaving = sceneName(session.id, request.params.slotId);
        // Also closes the gap in the initiative order, releases any claim on the
        // character that was here, and clears the turn marker if it pointed here.
        sessionCharacters.remove(session.id, request.params.slotId);
        if (leaving) sessionEvents.record(session.id, gmRemovedFromScene(leaving));
        logger.info("character removed from session", {
          sessionId: session.id,
          slotId: request.params.slotId,
        });
        return publish(session.id);
      },
    ),
  },

  /**
   * What a stage slot has left: its current ENDURANCE, STUN and BODY.
   *
   * The one route both roles may call. The game master runs the fight and may
   * write any slot; a player may write exactly one — the slot holding the
   * character they claimed — because spending your own END and taking your own
   * STUN is the part of the bookkeeping that belongs to the person playing.
   */
  "/api/sessions/:id/stage/:slotId/vitals": {
    PATCH: handler(
      async (
        request: BunRequest<"/api/sessions/:id/stage/:slotId/vitals">,
        { logger }: RequestContext,
      ) => {
        const { session, asPlayer } = requireSlotAccess(request);
        const values = await parseJsonBody(request, schemas.setVitals);

        sessionCharacters.setVitals(session.id, request.params.slotId, values);
        logger.info("slot vitals set", {
          sessionId: session.id,
          slotId: request.params.slotId,
          by: asPlayer ? "player" : "gm",
        });

        return publish(session.id);
      },
    ),
  },

  /**
   * A Recovery: RECOVERY back into both ENDURANCE and STUN, capped at the
   * character's totals. The arithmetic is the server's, not the button's — two
   * screens are looking at the same monster, and one of them is always a little
   * behind.
   */
  "/api/sessions/:id/stage/:slotId/recover": {
    POST: handler(
      (
        request: BunRequest<"/api/sessions/:id/stage/:slotId/recover">,
        { logger }: RequestContext,
      ) => {
        const { session, asPlayer } = requireSlotAccess(request);

        sessionCharacters.takeRecovery(session.id, request.params.slotId);
        logger.info("recovery taken", {
          sessionId: session.id,
          slotId: request.params.slotId,
          by: asPlayer ? "player" : "gm",
        });

        return publish(session.id);
      },
    ),
  },

  /**
   * A rest: ENDURANCE and STUN back to the character's totals. BODY is left
   * alone — it heals over days in HERO, which is longer than a session.
   */
  "/api/sessions/:id/stage/:slotId/rest": {
    POST: handler(
      (request: BunRequest<"/api/sessions/:id/stage/:slotId/rest">, { logger }: RequestContext) => {
        const { session, asPlayer } = requireSlotAccess(request);

        sessionCharacters.takeRest(session.id, request.params.slotId);
        logger.info("rest taken", {
          sessionId: session.id,
          slotId: request.params.slotId,
          by: asPlayer ? "player" : "gm",
        });

        return publish(session.id);
      },
    ),
  },

  /**
   * A status tag on a stage slot: prone, stunned, dead, or whatever else this
   * table has decided to track.
   *
   * The second kind of thing both roles may change, and for the same reason as
   * the numbers: being knocked down happens to your character, and saying so is
   * part of playing it. The body carries the state the tag should end in rather
   * than an instruction to flip it, so a retry — or two people reaching for
   * Prone at once — leaves one prone character rather than none.
   */
  "/api/sessions/:id/stage/:slotId/tags": {
    PATCH: handler(
      async (
        request: BunRequest<"/api/sessions/:id/stage/:slotId/tags">,
        { logger }: RequestContext,
      ) => {
        const { session, asPlayer, player } = requireSlotAccess(request);
        const { tag, active } = await parseJsonBody(request, schemas.setStatusTag);
        const { slotId } = request.params;

        // Asked before the write, because the body says where the tag should end
        // up rather than "flip it": a press that changes nothing is not
        // something to write down, exactly as re-picking the character you are
        // already holding writes nothing.
        const changed = sessionCharacters.hasTag(session.id, slotId, tag) !== active;

        sessionCharacters.setTag(session.id, slotId, tag, active);

        // The copy number comes with the name, so the log calls a monster what
        // the console beside it calls the same monster.
        const named = sceneName(session.id, slotId);
        if (changed && named) {
          const line = active ? tagsAdded : tagsRemoved;
          sessionEvents.record(
            session.id,
            line(player ? player.name : GAME_MASTER, [tagLabel(tag)], named),
          );
        }

        logger.info("status tag set", {
          sessionId: session.id,
          slotId,
          tag,
          active,
          changed,
          by: asPlayer ? "player" : "gm",
        });

        return publish(session.id);
      },
    ),
  },

  /**
   * A held action: the character waits, and cuts back in when they choose.
   *
   * The third thing both roles may change, and for the same reason as the
   * numbers and the conditions — waiting is a decision about your own character.
   * The body carries the state the hold should end in rather than an instruction
   * to flip it, so a double press leaves one held character rather than none.
   *
   * Both halves move the fight. Holding from your own phase is declining it, so
   * the clock steps on to whoever is next — the table said "I'll wait", and
   * waiting for the button to be pressed again would be the same sentence
   * twice. Taking the hold off cuts back in: whoever is up is noted, the holder
   * is given the turn where they stand, and the next step of the clock hands it
   * back to the character they interrupted.
   *
   * A hold put on a character who is not up changes nothing about the marker.
   * That is a game master saying what somebody will do when their phase comes,
   * and it must not cost whoever is actually up theirs — and a held character is
   * still stopped on at their own place, which is the cue to ask whether they
   * are still waiting.
   */
  "/api/sessions/:id/stage/:slotId/hold": {
    PATCH: handler(
      async (
        request: BunRequest<"/api/sessions/:id/stage/:slotId/hold">,
        { logger }: RequestContext,
      ) => {
        const { session, asPlayer, player } = requireSlotAccess(request);
        const { held } = await parseJsonBody(request, schemas.setHold);
        const { slotId } = request.params;

        // Asked before the write, as the tags route does: a press that changes
        // nothing is not something to write down, and must not move the marker.
        const changed = sessionCharacters.isHeld(session.id, slotId) !== held;

        sessionCharacters.setHeld(session.id, slotId, held);

        if (changed && !held) {
          // Whose turn it is, so the next step can hand it back to them. Only
          // when nothing is pending already: two holders cutting in one after
          // the other still leave one phase to return to, and it is the one
          // that was interrupted first.
          if (
            session.active_slot_id &&
            session.active_slot_id !== slotId &&
            !session.resume_slot_id
          ) {
            gameSessions.setResume(session.id, session.active_slot_id);
          }
          gameSessions.setTurn(session.id, slotId, session.turn, session.segment);
        }

        // Before the clock moves, so the log reads in the order it happened: the
        // hold, and then wherever the fight went next.
        const named = sceneName(session.id, slotId);
        if (changed && named) {
          const line = held ? actionHeld : actionTaken;
          sessionEvents.record(session.id, line(player ? player.name : GAME_MASTER, named));
        }

        // Holding is declining the phase you are in, so the fight moves on
        // without waiting to be told twice. Only from the character's own phase:
        // a game master marking somebody further down the order as waiting is
        // saying what that character will do when their turn comes, and must not
        // cost whoever is up their phase.
        const passed = changed && held && session.active_slot_id === slotId;
        const recovered = passed ? advanceTurn(session.id, "next") : false;

        logger.info("hold set", {
          sessionId: session.id,
          slotId,
          held,
          changed,
          passed,
          by: asPlayer ? "player" : "gm",
        });

        const response = publish(session.id);

        // After the snapshot, as the advance route does it: a screen has the
        // recovered numbers in hand before it is told why they moved.
        if (recovered) broadcastSessionNotice(session.id, POST_SEGMENT_12_NOTICE);

        return response;
      },
    ),
  },

  /* ----------------------------------------------------------- turn marker */

  "/api/sessions/:id/turn": {
    POST: handler(
      async (request: BunRequest<"/api/sessions/:id/turn">, { logger }: RequestContext) => {
        const { session } = requireOwnedActiveSession(request, request.params.id);
        const { slotId } = await parseJsonBody(request, schemas.setTurn);

        if (slotId !== null && !sessionCharacters.slotExists(session.id, slotId)) {
          throw errors.badRequest("That character isn't active in this session.");
        }

        gameSessions.setTurn(session.id, slotId, session.turn, session.segment);
        logger.info("turn set", { sessionId: session.id, slotId });

        return publish(session.id);
      },
    ),
  },

  "/api/sessions/:id/turn/advance": {
    POST: handler(
      async (request: BunRequest<"/api/sessions/:id/turn/advance">, { logger }: RequestContext) => {
        const { session } = requireOwnedActiveSession(request, request.params.id);
        const { direction } = await parseJsonBody(request, schemas.advanceTurn);

        const recovered = advanceTurn(session.id, direction);
        logger.info("turn advanced", { sessionId: session.id, direction, recovered });

        const response = publish(session.id);

        // After the snapshot, so a screen has the recovered numbers in hand
        // before it is told why they moved.
        if (recovered) broadcastSessionNotice(session.id, POST_SEGMENT_12_NOTICE);

        return response;
      },
    ),
  },

  /**
   * Back to the start of the fight: Turn 1, Segment 12, nobody on turn.
   *
   * Segment 12 rather than 1 because that is where HERO opens a combat, so this
   * is the same state a brand new session is created in.
   *
   * The turn marker is cleared rather than parked on the first character, which
   * puts the session in exactly the state it started in: "No turn set yet", and
   * the first press of Next opens Segment 12 with whoever leads it. That matters
   * because the stage may well have changed since the fight began, and restarting
   * should not quietly decide the new leader has already acted.
   *
   * Nothing else is touched — the characters on the stage and who has claimed
   * what all survive, since this restarts the fight rather than the session.
   */
  "/api/sessions/:id/turn/restart": {
    POST: handler(
      (request: BunRequest<"/api/sessions/:id/turn/restart">, { logger }: RequestContext) => {
        const { session } = requireOwnedActiveSession(request, request.params.id);

        gameSessions.setTurn(session.id, null, 1, OPENING_SEGMENT);
        // A fight starting over has nobody waiting and nothing to carry on from:
        // both are about where this fight had got to, and this is the state a
        // brand new session is in.
        gameSessions.setResume(session.id, null);
        sessionCharacters.clearHeld(session.id);
        // The same line a new session writes, because this is the same state:
        // the fight is back at its opening segment with nobody yet up, and the
        // events after this one belong to that segment rather than to whatever
        // segment the log last named.
        sessionEvents.record(session.id, segmentBegan(1, OPENING_SEGMENT));
        logger.info("turn restarted", { sessionId: session.id });

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
      sessionEvents.record(session.id, playerJoined(player.name));
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

        sessionEvents.record(session.id, playerSelected(player.name, character.name));
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

        // Both read before any write: once `setClaim` lands there is nothing left
        // to say what was put down or who it was taken from.
        const held = player.claimed_character_id;
        const wanted = claimedCharacterId !== null ? characters.byId(claimedCharacterId) : null;
        const previousHolder =
          claimedCharacterId !== null ? players.holderOf(session.id, claimedCharacterId) : null;

        if (claimedCharacterId !== null) {
          if (!wanted || !sessionCharacters.isMember(session.id, claimedCharacterId)) {
            throw errors.notFound("We couldn't find that character in this session.");
          }
          if (wanted.kind !== "pc") {
            throw errors.badRequest("Only player characters can be assigned to a player.");
          }
          // Reassigning takes the character off whoever holds it now.
          if (previousHolder && previousHolder.id !== player.id) {
            players.setClaim(previousHolder.id, null);
          }
        }

        players.setClaim(player.id, claimedCharacterId);

        /*
         * A game master re-picking the name already in the box has changed
         * nothing, and a log that says so twice is a log somebody stops reading.
         *
         * Otherwise it is two lines at most, and only when this player was
         * already holding somebody: what they put down, then what they picked
         * up. The pickup is a reassignment rather than an assignment when it
         * came off another player, because that was one action and there was
         * never a moment when the character was held by nobody.
         */
        if (claimedCharacterId !== held) {
          if (held !== null) {
            const before = characters.byId(held);
            if (before) sessionEvents.record(session.id, gmUnassigned(before.name, player.name));
          }
          if (wanted) {
            sessionEvents.record(
              session.id,
              previousHolder && previousHolder.id !== player.id
                ? gmReassigned(wanted.name, previousHolder.name, player.name)
                : gmAssigned(wanted.name, player.name),
            );
          }
        }

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
        sessionEvents.record(session.id, gmKicked(player.name));
        logger.info("player kicked", { sessionId: session.id, playerId: player.id });

        disconnectPlayer(player.id);
        return publish(session.id);
      },
    ),
  },
};

export { advanceTurn };
