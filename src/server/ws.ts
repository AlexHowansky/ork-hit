/**
 * Live updates.
 *
 * One WebSocket per open screen, subscribed to one topic. There are two kinds:
 *
 * - A session socket, subscribed to a topic named after the session. Any change
 *   republishes the whole session snapshot to that topic, so a game master adding
 *   an NPC, dragging the initiative order, or moving the turn marker lands on
 *   every player's screen without a refresh.
 * - A library socket, subscribed to a topic named after the game master, carrying
 *   the list of their sessions. Starting or ending a session republishes that list,
 *   so a library open in another tab follows along instead of showing a session
 *   that finished ten minutes ago.
 *
 * Authentication happens at upgrade time, from the same cookies the REST API
 * uses. An unauthenticated upgrade is refused outright — there is no anonymous
 * read of a session.
 */

import type { BunRequest, Server, ServerWebSocket } from "bun";
import { log } from "../lib/log.ts";
import { currentGm, currentPlayer } from "./middleware/auth.ts";
import { buildGmSessionList, buildSnapshot } from "./session-state.ts";
import { gameSessions } from "../db/queries.ts";

/** What a socket is allowed to see, decided once at upgrade and never re-read. */
interface SocketData {
  /** The one topic this socket subscribes to, fixed for its lifetime. */
  topic: string;
  /** Null on a library socket, which follows a game master rather than a session. */
  sessionId: string | null;
  role: "gm" | "player" | "library";
  /** Set for players, so a kick can find and close their sockets. */
  playerId: string | null;
  gmId: string | null;
}

type AppSocket = ServerWebSocket<SocketData>;

/** Live sockets, so a specific player can be disconnected on a kick. */
const sockets = new Set<AppSocket>();

/** Set once the server is constructed; publishing needs the server handle. */
let serverRef: Server<SocketData> | null = null;

export function registerServer(server: Server<SocketData>): void {
  serverRef = server;
}

function topicFor(sessionId: string): string {
  return `session:${sessionId}`;
}

function libraryTopicFor(gmId: string): string {
  return `library:${gmId}`;
}

/* ------------------------------------------------------------------ publish */

/** Publishes the current snapshot of a session to everyone watching it. */
export function broadcastSession(sessionId: string): void {
  if (!serverRef) return;
  const snapshot = buildSnapshot(sessionId);
  if (!snapshot) return;
  serverRef.publish(topicFor(sessionId), JSON.stringify({ type: "snapshot", ...snapshot }));
}

/**
 * Publishes a game master's session list to every library screen they have open.
 *
 * Called wherever the list itself changes — a session started or ended, a campaign
 * renamed or deleted — rather than on the changes inside a session, which each row
 * already follows through its own socket.
 */
export function broadcastGmSessions(gmId: string): void {
  serverRef?.publish(
    libraryTopicFor(gmId),
    JSON.stringify({ type: "sessions", sessions: buildGmSessionList(gmId) }),
  );
}

/**
 * Tells everyone the session is over, then closes their sockets. The message goes
 * first so a player screen can explain what happened instead of just going quiet.
 */
export function closeSessionSockets(sessionId: string): void {
  serverRef?.publish(
    topicFor(sessionId),
    JSON.stringify({ type: "session:ended" }),
  );
  for (const socket of sockets) {
    if (socket.data.sessionId === sessionId) socket.close(1000, "Session ended");
  }
}

/** Drops a kicked player's connections. Other people in the session stay put. */
export function disconnectPlayer(playerId: string): void {
  for (const socket of sockets) {
    if (socket.data.playerId !== playerId) continue;
    socket.send(JSON.stringify({ type: "player:kicked" }));
    socket.close(4001, "Removed from session");
  }
}

/* ------------------------------------------------------------------ upgrade */

/**
 * Who may watch a session: its game master, or a player who is in it. Returns a
 * `Response` where the reason is worth stating, `null` where it is not — a socket
 * is never told whether the session it was refused exists.
 */
function sessionUpgrade(request: BunRequest, sessionId: string | null): SocketData | Response | null {
  if (!sessionId) return new Response("Missing session", { status: 400 });

  const session = gameSessions.byId(sessionId);
  if (!session || session.status !== "active") {
    return new Response("Session not available", { status: 404 });
  }

  const gm = currentGm(request);
  if (gm && session.gm_id === gm.id) {
    return { topic: topicFor(sessionId), sessionId, role: "gm", playerId: null, gmId: gm.id };
  }

  const player = currentPlayer(request);
  if (player && player.session.id === sessionId) {
    return {
      topic: topicFor(sessionId),
      sessionId,
      role: "player",
      playerId: player.player.id,
      gmId: null,
    };
  }

  return null;
}

/** The library socket follows the signed-in game master, and nobody else. */
function libraryUpgrade(request: BunRequest): SocketData | null {
  const gm = currentGm(request);
  if (!gm) return null;
  return {
    topic: libraryTopicFor(gm.id),
    sessionId: null,
    role: "library",
    playerId: null,
    gmId: gm.id,
  };
}

/**
 * The upgrade endpoint. Declared as a route (rather than in a bare `fetch`) so
 * that `request.cookies` is available and identity resolution is identical to
 * every other endpoint.
 */
export const wsRoute = (request: BunRequest, server: Server<SocketData>): Response | undefined => {
  const params = new URL(request.url).searchParams;
  const data = params.get("scope") === "library"
    ? libraryUpgrade(request)
    : sessionUpgrade(request, params.get("sessionId"));

  if (data instanceof Response) return data;
  if (!data) return new Response("Unauthorized", { status: 401 });

  // Bun replies 101 itself when the upgrade succeeds.
  if (server.upgrade(request, { data })) return undefined;
  return new Response("Expected a WebSocket upgrade", { status: 426 });
};

/* ----------------------------------------------------------------- handlers */

export const websocket = {
  open(socket: AppSocket) {
    sockets.add(socket);
    socket.subscribe(socket.data.topic);

    // Send the current state immediately, so a reconnecting client is correct
    // before the next mutation happens to come along.
    if (socket.data.role === "library") {
      socket.send(
        JSON.stringify({ type: "sessions", sessions: buildGmSessionList(socket.data.gmId!) }),
      );
    } else {
      const snapshot = buildSnapshot(socket.data.sessionId!);
      if (snapshot) socket.send(JSON.stringify({ type: "snapshot", ...snapshot }));
    }

    log.debug("socket opened", {
      topic: socket.data.topic,
      role: socket.data.role,
      sockets: sockets.size,
    });
  },

  message(socket: AppSocket, message: string | Buffer) {
    // Clients are read-only over the socket: every change goes through the API,
    // where it is authorised and validated. The only thing accepted here is a
    // liveness ping.
    if (typeof message === "string" && message === "ping") {
      socket.send(JSON.stringify({ type: "pong" }));
    }
  },

  close(socket: AppSocket) {
    sockets.delete(socket);
    socket.unsubscribe(socket.data.topic);
    log.debug("socket closed", { topic: socket.data.topic, sockets: sockets.size });
  },

  /** Bun sends its own pings on this interval; idle sockets stay alive. */
  idleTimeout: 120,
  maxPayloadLength: 16 * 1024,
};
