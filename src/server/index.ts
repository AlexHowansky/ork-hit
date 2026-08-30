/**
 * Application entry point.
 *
 * A single Bun server handles the bundled React client, the JSON API, authorised
 * file delivery and the live-update WebSocket.
 */

import { config, configWarnings } from "../lib/config.ts";
import { log } from "../lib/log.ts";
import { migrate } from "../db/migrate.ts";
import { gmAuthSessions } from "../db/queries.ts";
import { sweepLimiters } from "./middleware/ratelimit.ts";
import { serverOptions } from "./app.ts";
import { registerServer } from "./ws.ts";

// Settings that were set but unusable. `config` cannot log them itself — the
// logger reads it — so it collects them and they are reported here instead.
for (const warning of configWarnings) log.warn("configuration ignored", { detail: warning });

migrate();

const server = Bun.serve({
  ...serverOptions,
  port: config.port,
  development: !config.isProduction,
});

// The WebSocket layer needs the server handle in order to publish to topics.
registerServer(server);

log.info("server started", {
  url: String(server.url),
  origin: config.appOrigin,
  production: config.isProduction,
});

// Housekeeping: expired sign-ins, and rate-limit buckets that have refilled.
setInterval(() => {
  const purged = gmAuthSessions.purgeExpired();
  if (purged > 0) log.debug("purged expired gm sessions", { count: purged });
  sweepLimiters();
}, 60 * 60 * 1000).unref();

export { server };
