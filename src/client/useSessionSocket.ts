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

export function useSessionSocket(sessionId: string | null) {
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
