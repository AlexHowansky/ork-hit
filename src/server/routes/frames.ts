/**
 * The artwork a card is printed in.
 *
 * Six files — a PC frame, an NPC frame and a campaign frame, each in a light and
 * a dark cut — laid over a card by `styles.css`; see `--card-frame-pc`,
 * `--card-frame-npc` and `--campaign-frame` there, which decide between them.
 * A seventh, `sheen.webp`, is the foil: a sheet of soft rainbow the well blends
 * over a picture as the card tilts (`--card-foil`). It has no light and dark cut
 * because it is not painted on the card — it is light caught by it, and the same
 * light in either theme.
 *
 * WebP rather than PNG: the window has to stay transparent and WebP carries the
 * alpha, at roughly a third of the bytes the PNGs cost.
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
  pc: {
    light: await load("character-pc-card-template-light.webp"),
    dark: await load("character-pc-card-template-dark.webp"),
  },
  npc: {
    light: await load("character-npc-card-template-light.webp"),
    dark: await load("character-npc-card-template-dark.webp"),
  },
  campaign: {
    light: await load("campaign-card-template-light.webp"),
    dark: await load("campaign-card-template-dark.webp"),
  },
};

/** The foil, which is one sheet rather than a pair. */
const sheen = await load("sheen.webp");

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
      "Content-Type": "image/webp",
      ETag: frame.etag,
      "Cache-Control": "public, max-age=3600",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export const frameRoutes = {
  "/frames/character-pc-light.webp": {
    GET: handler(async (request: Request) => serve(frames.pc.light, request)),
  },
  "/frames/character-pc-dark.webp": {
    GET: handler(async (request: Request) => serve(frames.pc.dark, request)),
  },
  "/frames/character-npc-light.webp": {
    GET: handler(async (request: Request) => serve(frames.npc.light, request)),
  },
  "/frames/character-npc-dark.webp": {
    GET: handler(async (request: Request) => serve(frames.npc.dark, request)),
  },
  "/frames/campaign-light.webp": {
    GET: handler(async (request: Request) => serve(frames.campaign.light, request)),
  },
  "/frames/campaign-dark.webp": {
    GET: handler(async (request: Request) => serve(frames.campaign.dark, request)),
  },
  "/frames/sheen.webp": {
    GET: handler(async (request: Request) => serve(sheen, request)),
  },
};
