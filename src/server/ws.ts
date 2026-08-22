/**
 * Live updates.
 *
 * One WebSocket per open screen, subscribed to a topic named after the session.
 * Any change republishes the whole session snapshot to that topic, so a game
 * master adding an NPC, dragging the initiative order, or moving the turn marker
 * lands on every player's screen without a refresh.
 *
 * Authentication happens at upgrade time, from the same cookies the REST API
 * uses. An unauthenticated upgrade is refused outright — there is no anonymous
 * read of a session.
 */

import type { BunRequest, Server, ServerWebSocket } from "bun";
import { log } from "../lib/log.ts";
import { currentGm, currentPlayer } from "./middleware/auth.ts";
import { buildSnapshot } from "./session-state.ts";
import { gameSessions } from "../db/queries.ts";

/** What a socket is allowed to see, decided once at upgrade and never re-read. */
interface SocketData {
  sessionId: string;
  role: "gm" | "player";
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

/* ------------------------------------------------------------------ publish */

/** Publishes the current snapshot of a session to everyone watching it. */
export function broadcastSession(sessionId: string): void {
  if (!serverRef) return;
  const snapshot = buildSnapshot(sessionId);
  if (!snapshot) return;
  serverRef.publish(topicFor(sessionId), JSON.stringify({ type: "snapshot", ...snapshot }));
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
 * The upgrade endpoint. Declared as a route (rather than in a bare `fetch`) so
 * that `request.cookies` is available and identity resolution is identical to
 * every other endpoint.
 */
export const wsRoute = (request: BunRequest, server: Server<SocketData>): Response | undefined => {
  const sessionId = new URL(request.url).searchParams.get("sessionId");
  if (!sessionId) return new Response("Missing session", { status: 400 });

  const session = gameSessions.byId(sessionId);
  if (!session || session.status !== "active") {
    return new Response("Session not available", { status: 404 });
  }

  let data: SocketData | null = null;

  const gm = currentGm(request);
  if (gm && session.gm_id === gm.id) {
    data = { sessionId, role: "gm", playerId: null, gmId: gm.id };
  } else {
    const player = currentPlayer(request);
    if (player && player.session.id === sessionId) {
      data = { sessionId, role: "player", playerId: player.player.id, gmId: null };
    }
  }

  if (!data) return new Response("Unauthorized", { status: 401 });

  // Bun replies 101 itself when the upgrade succeeds.
  if (server.upgrade(request, { data })) return undefined;
  return new Response("Expected a WebSocket upgrade", { status: 426 });
};

/* ----------------------------------------------------------------- handlers */

export const websocket = {
  open(socket: AppSocket) {
    sockets.add(socket);
    socket.subscribe(topicFor(socket.data.sessionId));

    // Send the current state immediately, so a reconnecting client is correct
    // before the next mutation happens to come along.
    const snapshot = buildSnapshot(socket.data.sessionId);
    if (snapshot) socket.send(JSON.stringify({ type: "snapshot", ...snapshot }));

    log.debug("socket opened", {
      sessionId: socket.data.sessionId,
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
    socket.unsubscribe(topicFor(socket.data.sessionId));
    log.debug("socket closed", { sessionId: socket.data.sessionId, sockets: sockets.size });
  },

  /** Bun sends its own pings on this interval; idle sockets stay alive. */
  idleTimeout: 120,
  maxPayloadLength: 16 * 1024,
};
