/**
 * The server's shape: every route, and the WebSocket handlers.
 *
 * Kept apart from index.ts so that the entry point owns starting a listener and
 * the tests can start their own on an ephemeral port.
 */

import index from "../client/index.html";
import { authRoutes } from "./routes/auth.ts";
import { campaignRoutes } from "./routes/campaigns.ts";
import { characterRoutes } from "./routes/characters.ts";
import { sessionRoutes } from "./routes/sessions.ts";
import { fileRoutes } from "./routes/files.ts";
import { websocket, wsRoute } from "./ws.ts";
import { log } from "../lib/log.ts";

/**
 * Client-side routes, each served the same bundled document. Listed explicitly
 * rather than as a catch-all, so an unknown path still returns a 404.
 */
const PAGES = ["/", "/join", "/gm", "/gm/sessions/:id", "/play"];

export const routes = {
  ...Object.fromEntries(PAGES.map((path) => [path, index])),
  ...authRoutes,
  ...campaignRoutes,
  ...characterRoutes,
  ...sessionRoutes,
  ...fileRoutes,
  "/ws": wsRoute,
};

export const serverOptions = {
  routes,
  websocket,

  /** Anything that matched no route at all. */
  fetch() {
    return new Response("Not found", { status: 404 });
  },

  error(error: Error) {
    log.error("server error", { error });
    return new Response("Something went wrong on our end. Please try again.", { status: 500 });
  },
};
