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

/**
 * The font, when the deployment asked for one and both halves of it were usable.
 *
 * `@import` has to come before every other rule in a stylesheet, which is why
 * this is prepended rather than written into the block below. Both values are
 * safe to interpolate: `config` has already put the URL through `new URL()` and
 * an https-plus-known-host check, and held the family to letters, digits, spaces
 * and hyphens — which cannot close a `font-family` value or open a new rule.
 */
const font =
  config.cardFontUrl && config.cardFontFamily
    ? { atImport: `@import url("${config.cardFontUrl}");\n`, family: config.cardFontFamily }
    : null;

const css =
  (font?.atImport ?? "") +
  `:root {\n` +
  `  --sheet-size: ${config.sheetWidthPct};\n` +
  // A multiplier rather than a percentage: the strengths the sheen was tuned at
  // stay in the stylesheet, and this only scales them.
  `  --card-sheen-strength: ${config.cardSheenPct / 100};\n` +
  // Where the cards' artwork lives — the PC frame, the NPC frame and the campaign
  // one, each in both themes. Not a deployment choice like the rest of this — the
  // files ship with the app — but it has to be written here all the same: Bun's
  // bundler resolves every `url()` it can see in the stylesheet, inlining the
  // frames as base64 when pointed at the files and refusing to build when
  // pointed at these paths. This response is the server's own, so nothing
  // rewrites it. `styles.css` picks a theme's cut of each.
  `  --card-frame-pc-light: url("/frames/character-pc-light.webp");\n` +
  `  --card-frame-pc-dark: url("/frames/character-pc-dark.webp");\n` +
  `  --card-frame-npc-light: url("/frames/character-npc-light.webp");\n` +
  `  --card-frame-npc-dark: url("/frames/character-npc-dark.webp");\n` +
  `  --campaign-frame-light: url("/frames/campaign-light.webp");\n` +
  `  --campaign-frame-dark: url("/frames/campaign-dark.webp");\n` +
  // And the foil the well blends over a picture, which is one sheet for both
  // themes and is written here for the same reason the frames are.
  `  --card-foil: url("/frames/sheen.webp");\n` +
  // Only when there is one. Unset, `styles.css` falls back to `inherit` and a
  // card's name keeps the interface font.
  //
  // The tail is what the name falls back to if the font is configured but never
  // arrives, and getting it wrong is silent, so it is worth being exact about.
  // Not `inherit`: a CSS-wide keyword is only legal as a whole value, never as one
  // item in a font list, and one here makes the whole declaration invalid. Not
  // `var(--font-sans)` either: Tailwind inlines its theme values in this build
  // rather than emitting that property, so at run time it resolves to nothing —
  // and an unresolvable `var()` makes *this* custom property invalid in turn,
  // which is the same silent nothing by a longer route. A plain generic always
  // resolves, and the app's own stack ends in it anyway.
  (font ? `  --card-font-family: "${font.family}", sans-serif;\n` : "") +
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
