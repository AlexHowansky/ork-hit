/**
 * One reconnecting WebSocket, shared by everything on the client that watches
 * something live.
 *
 * The server has two kinds of socket — a session and a game master's library —
 * and they differ only in what they carry: both authenticate from the same
 * cookies, both are sent the current state the moment they open, and both need to
 * come back after a drop. That machinery lives here, and the hooks above it are
 * left to interpret messages.
 *
 * A dropped connection reconnects with backoff, and because the server sends the
 * current state on open, reconnecting is also how the client catches up on
 * anything it missed while away.
 */

import { useCallback, useEffect, useRef, useState } from "react";

export type ConnectionState = "connecting" | "open" | "reconnecting" | "ended" | "kicked";

/** Every message is a tagged object; the caller knows what its own tags mean. */
export type LiveMessage = { type?: string } & Record<string, unknown>;

const INITIAL_BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 15_000;
const PING_INTERVAL_MS = 30_000;

/**
 * `query` is the query string identifying what to watch (`sessionId=…`,
 * `scope=library`), or null to stay disconnected. Changing it reconnects.
 */
export function useLiveSocket(query: string | null, onMessage: (message: LiveMessage) => void) {
  const [connection, setConnection] = useState<ConnectionState>("connecting");

  const socketRef = useRef<WebSocket | null>(null);
  const backoffRef = useRef(INITIAL_BACKOFF_MS);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Set when there is definitively nothing more to watch, so we stop trying to
  // return.
  const stoppedRef = useRef(false);

  // Held in a ref so a caller can pass an inline handler without the socket
  // tearing down and reconnecting on every render.
  const handlerRef = useRef(onMessage);
  handlerRef.current = onMessage;

  const cleanup = useCallback(() => {
    if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
    if (pingTimerRef.current) clearInterval(pingTimerRef.current);
    retryTimerRef.current = null;
    pingTimerRef.current = null;
    socketRef.current?.close();
    socketRef.current = null;
  }, []);

  /** Settles on a final state: no more reconnecting, and the socket goes. */
  const finish = useCallback(
    (state: "ended" | "kicked") => {
      stoppedRef.current = true;
      setConnection(state);
      cleanup();
    },
    [cleanup],
  );

  useEffect(() => {
    if (!query) return;

    stoppedRef.current = false;
    let disposed = false;

    const connect = () => {
      if (disposed || stoppedRef.current) return;

      const protocol = location.protocol === "https:" ? "wss:" : "ws:";
      const socket = new WebSocket(`${protocol}//${location.host}/ws?${query}`);
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
        let message: LiveMessage;
        try {
          message = JSON.parse(String(event.data));
        } catch {
          return;
        }
        handlerRef.current(message);
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
  }, [query, cleanup]);

  return { connection, finish };
}
