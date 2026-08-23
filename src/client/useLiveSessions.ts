/**
 * The game master's session list, kept current while the library is open.
 *
 * Sessions come and go from outside this page — the game master ends one from a
 * console in another tab, or starts one there — and the list is only as fresh as
 * the last load without this. The server publishes the whole list whenever it
 * changes, in the same shape `GET /api/sessions` returns, so a list that arrived
 * over the socket needs no special handling.
 *
 * The state lives here rather than in the page so both sources write to one
 * place: `setSessions` is for the initial fetch, and anything the socket sends
 * afterwards supersedes it.
 */

import { useState } from "react";
import { useLiveSocket } from "./useLiveSocket.ts";
import type { GameSession } from "./types.ts";

export function useLiveSessions() {
  const [sessions, setSessions] = useState<GameSession[]>([]);

  useLiveSocket("scope=library", (message) => {
    if (message.type === "sessions" && Array.isArray(message.sessions)) {
      setSessions(message.sessions as GameSession[]);
    }
  });

  return { sessions, setSessions };
}
