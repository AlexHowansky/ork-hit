/**
 * The client, and the headers it is served with.
 *
 * The document is the one response the app could not previously put its own
 * headers on. Bun's HTML import is served by the bundler itself — an opaque
 * value in the routes table rather than a handler — so `handler()` never ran for
 * it, and the page went out without `X-Frame-Options`, HSTS or any of the rest
 * of `securityHeaders()`. A `<meta>` CSP covers most of what the page needs, but
 * `frame-ancestors` is header-only and has no meta equivalent, so nothing in the
 * app refused to be framed: clickjacking of the game master's console was held
 * off only by a reverse proxy the README asks an operator to configure.
 *
 * So in production the client is built once here, at startup, and served through
 * the same `handler()` as everything else — which is all it takes for the
 * document to carry `X-Frame-Options: DENY` and the rest without a proxy in the
 * picture at all.
 *
 * Development keeps the bundler, deliberately. It is what rebuilds the client as
 * a file is saved, and losing that to gain headers on a page nobody is serving
 * over the internet is a poor trade. The proxy remains the belt to this braces
 * in production — the README's `frame-ancestors 'none'` still covers a browser
 * old enough to ignore `X-Frame-Options`.
 */

import { join } from "node:path";
import type { BunRequest } from "bun";
import { config } from "../lib/config.ts";
import { log } from "../lib/log.ts";
import { handler } from "./http.ts";

/**
 * Client-side routes, each served the same document. Listed explicitly rather
 * than as a catch-all, so an unknown path still returns a 404.
 */
export const PAGES = ["/", "/join", "/gm", "/gm/sessions/:id", "/play"];

const ENTRY = join(import.meta.dir, "..", "client", "index.html");

/** A built file, held in memory: there are three of them and they never change. */
interface Asset {
  bytes: ArrayBuffer;
  type: string;
}

function serveAsset(asset: Asset, cacheControl: string) {
  return handler(() =>
    new Response(asset.bytes, {
      headers: { "Content-Type": asset.type, "Cache-Control": cacheControl },
    })
  );
}

/**
 * Builds the client and returns a route for the document at every page path,
 * plus one for each hashed asset it references.
 *
 * Exported so a test can mount the production path on its own server whatever
 * `NODE_ENV` says — this is the arrangement that carries the headers, and it is
 * not the one a test run otherwise exercises.
 *
 * `publicPath` is what makes those references absolute. Left to itself the
 * bundler writes them relative — `./chunk-abc.js` — which resolves correctly
 * from `/` and to nothing at all from `/gm/sessions/:id`, where the browser
 * would look for `/gm/sessions/chunk-abc.js`.
 */
export async function buildClientRoutes() {
  const started = performance.now();
  const built = await Bun.build({
    entrypoints: [ENTRY],
    plugins: [(await import("bun-plugin-tailwind")).default],
    minify: true,
    publicPath: "/",
  });

  if (!built.success) {
    // Nothing to serve, so there is no point starting: a server that answers
    // every page with a 500 is worse than one that says why it stopped.
    for (const issue of built.logs) log.error("client build failed", { issue: String(issue) });
    throw new Error("the client could not be built");
  }

  const routes: Record<string, ReturnType<typeof serveAsset>> = {};
  let document: Asset | null = null;

  for (const output of built.outputs) {
    const asset: Asset = { bytes: await output.arrayBuffer(), type: output.type };
    if (output.path.endsWith(".html")) {
      document = asset;
      continue;
    }
    // "./chunk-abc.js" is served at "/chunk-abc.js", which is what `publicPath`
    // has already written into the document.
    const path = output.path.replace(/^\./, "");
    // Hashed in the name, so a cached copy can never be the wrong one.
    routes[path] = serveAsset(asset, "public, max-age=31536000, immutable");
  }

  if (!document) throw new Error("the client build produced no document");

  // Revalidated rather than cached: it is the thing that names which hashed
  // assets are current, so a deployment has to be able to change it.
  const page = serveAsset(document, "no-cache");
  for (const path of PAGES) routes[path] = page;

  log.info("client built", {
    ms: Math.round(performance.now() - started),
    assets: built.outputs.length,
  });
  return routes;
}

/**
 * The routes that serve the client: built and header-wrapped in production, and
 * handed to Bun's bundler in development.
 */
export async function clientRoutes() {
  if (config.isProduction) return await buildClientRoutes();
  const { default: bundle } = await import("../client/index.html");
  return Object.fromEntries(PAGES.map((path) => [path, bundle])) as Record<
    string,
    unknown
  > as Record<string, (request: BunRequest, server: never) => Promise<Response>>;
}
