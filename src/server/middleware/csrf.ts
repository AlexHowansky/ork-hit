/**
 * CSRF defence.
 *
 * Session cookies are SameSite=Lax, which already blocks cross-site POSTs from
 * another origin. This adds a second, explicit check: a mutating request must
 * either declare a same-origin fetch metadata header, or carry an Origin that
 * matches where the app is served from. Requests with neither are refused.
 *
 * The app never submits a plain <form>, so there is no legitimate cross-site
 * navigation that mutates state.
 */

import { config } from "../../lib/config.ts";
import { errors } from "../../lib/errors.ts";

export function checkOrigin(request: Request): void {
  // Sec-Fetch-Site is set by every current browser and cannot be forged by page
  // script, so when it's present it is the most reliable signal available.
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite) {
    if (fetchSite === "same-origin" || fetchSite === "none") return;
    throw errors.forbidden("That request came from an unexpected place and was blocked.");
  }

  const origin = request.headers.get("origin");
  if (origin && isAllowedOrigin(origin, request)) return;

  throw errors.forbidden("That request came from an unexpected place and was blocked.");
}

function isAllowedOrigin(origin: string, request: Request): boolean {
  if (origin === config.appOrigin) return true;
  // Behind a proxy the configured origin is authoritative; without one, accept an
  // Origin that matches the Host the request actually arrived on.
  if (config.trustedProxy) return false;
  const host = request.headers.get("host");
  if (!host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
