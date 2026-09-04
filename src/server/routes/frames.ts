/**
 * The artwork a card is printed in.
 *
 * Three files — a PC frame, an NPC frame and a campaign frame — laid over a card
 * by `styles.css`; see `--card-frame-pc`, `--card-frame-npc` and
 * `--campaign-frame` there. Each is one cut rather than a light and a dark twin:
 * the art is painted stock, and stock does not change colour when the room does.
 * The name drawn on it is what has to stay legible, and it does by being drawn in
 * the light theme's ink in either theme (see `CARD_CAPTION_FRAMED` in `ui.tsx`).
 * A fourth, `sheen.webp`, is the foil: a sheet of soft rainbow the well blends
 * over a picture as the card tilts (`--card-foil`). It is not painted on the card
 * either — it is light caught by it, and the same light in either theme.
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
  pc: await load("character-pc-card-template.webp"),
  npc: await load("character-npc-card-template.webp"),
  campaign: await load("campaign-card-template.webp"),
};

/** The foil, which lies over a picture rather than framing it. */
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
  "/frames/character-pc.webp": {
    GET: handler(async (request: Request) => serve(frames.pc, request)),
  },
  "/frames/character-npc.webp": {
    GET: handler(async (request: Request) => serve(frames.npc, request)),
  },
  "/frames/campaign.webp": {
    GET: handler(async (request: Request) => serve(frames.campaign, request)),
  },
  "/frames/sheen.webp": {
    GET: handler(async (request: Request) => serve(sheen, request)),
  },
};
