/**
 * Subscribes to a session's live updates.
 *
 * The server publishes a complete snapshot on every change, so this hook simply
 * replaces its state each time one arrives — there is no merging to get wrong.
 *
 * A dropped connection reconnects with backoff, and because the server sends a
 * snapshot the moment a socket opens, reconnecting is also how the client catches
 * up on anything it missed while away.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { Snapshot } from "./types.ts";

export type ConnectionState = "connecting" | "open" | "reconnecting" | "ended" | "kicked";

const INITIAL_BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 15_000;
const PING_INTERVAL_MS = 30_000;

export function useSessionSocket(sessionId: string | null) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [connection, setConnection] = useState<ConnectionState>("connecting");

  const socketRef = useRef<WebSocket | null>(null);
  const backoffRef = useRef(INITIAL_BACKOFF_MS);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Set when the session has definitively finished, so we stop trying to return.
  const stoppedRef = useRef(false);

  const cleanup = useCallback(() => {
    if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
    if (pingTimerRef.current) clearInterval(pingTimerRef.current);
    retryTimerRef.current = null;
    pingTimerRef.current = null;
    socketRef.current?.close();
    socketRef.current = null;
  }, []);

  useEffect(() => {
    if (!sessionId) return;

    stoppedRef.current = false;
    let disposed = false;

    const connect = () => {
      if (disposed || stoppedRef.current) return;

      const protocol = location.protocol === "https:" ? "wss:" : "ws:";
      const socket = new WebSocket(
        `${protocol}//${location.host}/ws?sessionId=${encodeURIComponent(sessionId)}`,
      );
      socketRef.current = socket;

      socket.onopen = () => {
        if (disposed) return;
        backoffRef.current = INITIAL_BACKOFF_MS;
        setConnection("open");

        pingTimerRef.current = setInterval(() => {
          if (socket.readyState === WebSocket.OPEN) socket.send("ping");
        }, PING_INTERVAL_MS);
      };

      socket.onmessage = (event) => {
        if (disposed) return;
        let message: { type?: string } & Partial<Snapshot>;
        try {
          message = JSON.parse(String(event.data));
        } catch {
          return;
        }

        switch (message.type) {
          case "snapshot":
            if (message.session && message.players && message.characters) {
              setSnapshot({
                session: message.session,
                players: message.players,
                characters: message.characters,
              });
            }
            break;
          case "session:ended":
            stoppedRef.current = true;
            setConnection("ended");
            break;
          case "player:kicked":
            stoppedRef.current = true;
            setConnection("kicked");
            break;
        }
      };

      socket.onclose = () => {
        if (disposed || stoppedRef.current) return;
        if (pingTimerRef.current) clearInterval(pingTimerRef.current);
        setConnection("reconnecting");

        // Exponential backoff with jitter, so a server restart doesn't bring
        // every client back in the same instant.
        const delay = Math.min(backoffRef.current, MAX_BACKOFF_MS);
        backoffRef.current = Math.min(delay * 2, MAX_BACKOFF_MS);
        retryTimerRef.current = setTimeout(connect, delay + Math.random() * 250);
      };
    };

    connect();

    return () => {
      disposed = true;
      cleanup();
    };
  }, [sessionId, cleanup]);

  /**
   * Lets a caller apply the result of its own mutation immediately, rather than
   * waiting for the broadcast to make the round trip.
   */
  const applySnapshot = useCallback((next: Snapshot) => setSnapshot(next), []);

  return { snapshot, connection, applySnapshot };
}
