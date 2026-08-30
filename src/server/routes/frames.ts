/**
 * The artwork a character card is printed in.
 *
 * Two files, one per theme, laid over a card by `styles.css` — see `--card-frame`
 * there, which is what decides between them.
 *
 * They are served from here rather than imported by the stylesheet because Bun's
 * bundler inlines a `url()` it can resolve on disk: the two together turned a
 * 60KB stylesheet into a 448KB one, render-blocking and re-fetched in full every
 * time an unrelated rule changes. Behind a route they are ordinary images, cached
 * on their own terms and revalidated with an ETag, and the stylesheet goes back
 * to being small. `index.html` notes the same gap — no static asset route — which
 * is why the favicon is a data URI.
 *
 * Read once at startup: they ship with the app, so a running server can no more
 * be handed a new one than it can a new component. The ETag is their content, so
 * a deployment that changes the art invalidates the caches that hold the old one.
 */

import { join } from "node:path";
import { handler } from "../http.ts";

const ASSETS = join(import.meta.dir, "..", "..", "..", "assets");

/** A frame, its bytes and its ETag, loaded before the first request arrives. */
async function load(name: string): Promise<{ bytes: ArrayBuffer; etag: string }> {
  const bytes = await Bun.file(join(ASSETS, name)).arrayBuffer();
  const digest = new Bun.CryptoHasher("sha256").update(new Uint8Array(bytes)).digest("hex");
  return { bytes, etag: `"${digest.slice(0, 16)}"` };
}

const frames = {
  light: await load("character-card-template-light.png"),
  dark: await load("character-card-template-dark.png"),
};

/**
 * Answers 304 when the browser already holds this exact image, and the bytes
 * otherwise. Public rather than private: a frame is the same for everyone and
 * says nothing about who is looking at it.
 */
function serve(frame: { bytes: ArrayBuffer; etag: string }, request: Request): Response {
  if (request.headers.get("if-none-match") === frame.etag) {
    return new Response(null, { status: 304, headers: { ETag: frame.etag } });
  }
  return new Response(frame.bytes, {
    headers: {
      "Content-Type": "image/png",
      ETag: frame.etag,
      "Cache-Control": "public, max-age=3600",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export const frameRoutes = {
  "/frames/character-light.png": {
    GET: handler(async (request: Request) => serve(frames.light, request)),
  },
  "/frames/character-dark.png": {
    GET: handler(async (request: Request) => serve(frames.dark, request)),
  },
};
