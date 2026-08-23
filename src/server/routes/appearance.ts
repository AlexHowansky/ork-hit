/**
 * The handful of settings the browser has to know about, delivered as CSS.
 *
 * Card size is a deployment choice, and the client is a bundle built when the
 * server starts — so the value cannot be baked into it, and fetching it as JSON
 * would draw the first cards at the wrong size and then resize them. A stylesheet
 * is the natural carrier: it is a custom property the layout already reads, the
 * browser blocks the first paint on it, and no script is involved at all.
 *
 * `styles.css` declares the same property with the default, so the page is still
 * laid out correctly if this never arrives.
 */

import { config } from "../../lib/config.ts";

const css = `:root { --card-image-size: ${config.cardImagePx}px; }\n`;

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
