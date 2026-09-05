/**
 * The client as production serves it.
 *
 * The document used to be handed to Bun's bundler, which put it outside
 * `handler()` and so outside `securityHeaders()`: the page went out with no
 * `X-Frame-Options`, and a `<meta>` CSP cannot carry `frame-ancestors`, so
 * nothing in the app refused to be framed. In production the client is built at
 * startup and served by the app instead, which is what these tests hold in
 * place. Development still uses the bundler, so `buildClientRoutes` is called
 * directly rather than through `serverOptions` — a test run is not production,
 * and this is the arrangement that carries the headers.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { buildClientRoutes } from "../src/server/client.ts";

let server: ReturnType<typeof Bun.serve>;
let base: string;

beforeAll(async () => {
  server = Bun.serve({
    routes: await buildClientRoutes(),
    port: 0,
    fetch: () => new Response("not found", { status: 404 }),
  });
  base = server.url.origin.replace(/\/$/, "");
});

afterAll(() => server?.stop(true));

describe("the client carries the app's security headers", () => {
  const pages = ["/", "/join", "/gm", "/gm/sessions/some-id", "/play"];

  test.each(pages)("%s is served with the headers a page needs", async (path) => {
    const response = await fetch(base + path);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    // The one that matters: without it the game master's console can be framed,
    // and `frame-ancestors` has no `<meta>` equivalent to fall back on.
    expect(response.headers.get("x-frame-options")).toBe("DENY");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("referrer-policy")).toBe("same-origin");
    expect(response.headers.get("cross-origin-opener-policy")).toBe("same-origin");
  });

  /**
   * A page nested more than one deep is the reason the build sets `publicPath`.
   * Left relative, `./chunk-abc.js` resolves against `/gm/sessions/` and the
   * browser asks for a script that was never there — a blank page, and nothing
   * in the server log to say why.
   */
  test("the document loads its assets from an absolute path", async () => {
    const html = await (await fetch(`${base}/gm/sessions/some-id`)).text();
    const assets = [...html.matchAll(/(?:src|href)="([^"]+)"/g)]
      .map((match) => match[1]!)
      .filter((url) => !url.startsWith("data:"));

    expect(assets.length).toBeGreaterThan(0);
    for (const asset of assets) {
      expect(asset.startsWith("/")).toBe(true);
      const response = await fetch(base + asset);
      expect(response.status).toBe(200);
      // Hashed in the name, so it can be held onto indefinitely.
      expect(response.headers.get("cache-control")).toContain("immutable");
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    }
  });

  test("the document itself is revalidated, so a deployment takes effect", async () => {
    const response = await fetch(base + "/");
    expect(response.headers.get("cache-control")).toBe("no-cache");
  });
});
