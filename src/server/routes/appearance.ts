/**
 * The handful of settings the browser has to know about, delivered as CSS.
 *
 * How large a card is drawn, how much of the window a sheet opens over, and how
 * brightly a card catches the light are deployment choices, and the client is a
 * bundle built when the server starts — so the values cannot be baked into it,
 * and fetching them as JSON would draw the first cards at the wrong size and then
 * resize them. A stylesheet is the natural carrier: they are custom properties
 * the layout already reads, the browser blocks the first paint on it, and no
 * script is involved at all.
 *
 * `styles.css` declares the same properties with their defaults, so the page is
 * still laid out correctly if this never arrives.
 */

import { config } from "../../lib/config.ts";

const css =
  `:root {\n` +
  `  --card-image-size: ${config.cardImagePx}px;\n` +
  `  --sheet-size: ${config.sheetWidthPct};\n` +
  // A multiplier rather than a percentage: the strengths the sheen was tuned at
  // stay in the stylesheet, and this only scales them.
  `  --card-sheen-strength: ${config.cardSheenPct / 100};\n` +
  // Where the character card's artwork lives. Not a deployment choice like the
  // rest of this — the files ship with the app — but it has to be written here
  // all the same: Bun's bundler resolves every `url()` it can see in the
  // stylesheet, inlining the two frames as base64 when pointed at the files and
  // refusing to build when pointed at these paths. This response is the server's
  // own, so nothing rewrites it. `styles.css` picks between the two by theme.
  `  --card-frame-light: url("/frames/character-light.png");\n` +
  `  --card-frame-dark: url("/frames/character-dark.png");\n` +
  `}\n`;

export const appearanceRoutes = {
  "/appearance.css": () =>
    new Response(css, {
      headers: {
        "Content-Type": "text/css; charset=utf-8",
        // Read once per page load, and it changes when the server restarts, so
        // revalidating costs nothing worth saving.
        "Cache-Control": "no-cache",
        "X-Content-Type-Options": "nosniff",
      },
    }),
};
