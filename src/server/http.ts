/**
 * Request plumbing shared by every route.
 *
 * `handler()` wraps a route function with the things that must never be forgotten:
 * a request id for the logs, an Origin check on mutating requests, security
 * headers on the way out, and an error boundary that turns anything unexpected
 * into a single generic message rather than leaking internals.
 */

import type { BunRequest, Server } from "bun";
import { AppError, GENERIC_ERROR_MESSAGE, errors } from "../lib/errors.ts";
import { config } from "../lib/config.ts";
import { log, type Logger } from "../lib/log.ts";
import { checkOrigin } from "./middleware/csrf.ts";

export interface RequestContext {
  readonly requestId: string;
  readonly logger: Logger;
  /** Client IP, taken from the proxy header when one is trusted. */
  readonly ip: string;
}

export type RouteHandler<P extends string = string> = (
  request: BunRequest<P>,
  context: RequestContext,
) => Response | Promise<Response>;

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** Headers applied to every response the app produces. */
function securityHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "same-origin",
    "X-Frame-Options": "DENY",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Permissions-Policy": "geolocation=(), microphone=(), camera=(), payment=()",
  };
  if (!config.insecureCookies) {
    headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains";
  }
  return headers;
}

/**
 * The address to attribute a request to for rate limiting and logs.
 *
 * A forwarded header is honoured only when a proxy is configured as trusted —
 * otherwise anyone could set it and hop between buckets at will. Without a proxy
 * the socket address is used, which still gives each client its own bucket; the
 * last resort keeps limiting working (as one shared bucket) rather than failing open.
 */
function clientIp(request: Request, server: Server<unknown> | undefined): string {
  if (config.trustedProxy) {
    const forwarded = request.headers.get("x-forwarded-for");
    // Left-most entry is the original client; the rest are proxies.
    const first = forwarded?.split(",")[0]?.trim();
    if (first) return first;
    const real = request.headers.get("x-real-ip");
    if (real) return real.trim();
  }
  return server?.requestIP(request)?.address ?? "unknown";
}

export function json(body: unknown, init?: ResponseInit): Response {
  return Response.json(body, init);
}

export function noContent(): Response {
  return new Response(null, { status: 204 });
}

function errorResponse(error: AppError): Response {
  return Response.json(
    { error: { code: error.code, message: error.message } },
    { status: error.status },
  );
}

function applyHeaders(response: Response, extra?: Record<string, string>): Response {
  // A route may set its own value for one of these (the sheet route replaces the
  // CSP), so only fill in what isn't already present.
  for (const [key, value] of Object.entries({ ...securityHeaders(), ...extra })) {
    if (!response.headers.has(key)) response.headers.set(key, value);
  }
  return response;
}

export function handler<P extends string = string>(
  route: RouteHandler<P>,
  options: { headers?: Record<string, string> } = {},
): (request: BunRequest<P>, server: Server<unknown>) => Promise<Response> {
  return async (request: BunRequest<P>, server: Server<unknown>): Promise<Response> => {
    const requestId = crypto.randomUUID();
    const started = performance.now();
    const url = new URL(request.url);
    const ip = clientIp(request, server);
    const logger = log.child({ reqId: requestId, method: request.method, route: url.pathname });
    const context: RequestContext = { requestId, logger, ip };

    let response: Response;
    try {
      if (!SAFE_METHODS.has(request.method)) checkOrigin(request);
      response = await route(request, context);
    } catch (error) {
      // A uniqueness check that loses a race with a concurrent write lands here.
      // The handlers check first and give a specific message; this is the net
      // that keeps a lost race from looking like a server fault.
      const failure = error instanceof Error && /UNIQUE constraint failed/i.test(error.message)
        ? errors.conflict("That name is already taken. Please choose another.")
        : error;

      if (failure instanceof AppError) {
        // Expected, handled failures: log at a level matching how alarming they are.
        const level = failure.status >= 500 ? "error" : "warn";
        logger[level]("request failed", { code: failure.code, ...(failure.context ?? {}) });
        response = errorResponse(failure);
      } else {
        // Unexpected: keep the full detail server-side, tell the client nothing.
        logger.error("unhandled error", { error });
        response = Response.json(
          { error: { code: "internal", message: GENERIC_ERROR_MESSAGE } },
          { status: 500 },
        );
      }
    }

    response.headers.set("X-Request-Id", requestId);
    applyHeaders(response, options.headers);

    logger.info("request", {
      status: response.status,
      ms: Math.round(performance.now() - started),
    });
    return response;
  };
}
