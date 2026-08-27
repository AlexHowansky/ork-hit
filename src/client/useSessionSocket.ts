/**
 * Subscribes to a session's live updates.
 *
 * The server publishes a complete snapshot on every change, so this hook simply
 * replaces its state each time one arrives — there is no merging to get wrong.
 *
 * The connection itself, including reconnecting after a drop, is `useLiveSocket`.
 */

import { useCallback, useState } from "react";
import { useLiveSocket } from "./useLiveSocket.ts";
import type { Snapshot } from "./types.ts";

export type { ConnectionState } from "./useLiveSocket.ts";

/**
 * `onNotice` is called with something the server wants said out loud on every
 * screen in the session — the Post-Segment 12 Recovery, so far. It is an event
 * rather than part of the state, so it is handed straight to the caller to toast
 * rather than being kept: nothing on the page is drawn from it.
 */
export function useSessionSocket(
  sessionId: string | null,
  onNotice?: (message: string) => void,
) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);

  const { connection, finish } = useLiveSocket(
    sessionId ? `sessionId=${encodeURIComponent(sessionId)}` : null,
    (message) => {
      switch (message.type) {
        case "snapshot": {
          const { session, players, characters } = message as unknown as Partial<Snapshot>;
          if (session && players && characters) setSnapshot({ session, players, characters });
          break;
        }
        case "notice": {
          if (typeof message.message === "string") onNotice?.(message.message);
          break;
        }
        case "session:ended":
          finish("ended");
          break;
        case "player:kicked":
          finish("kicked");
          break;
      }
    },
  );

  /**
   * Lets a caller apply the result of its own mutation immediately, rather than
   * waiting for the broadcast to make the round trip.
   */
  const applySnapshot = useCallback((next: Snapshot) => setSnapshot(next), []);

  return { snapshot, connection, applySnapshot };
}
