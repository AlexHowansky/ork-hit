/**
 * How big this reader wants cards drawn.
 *
 * The theme's counterpart, and deliberately not built like it. A theme is
 * remembered in `localStorage`, because whether a room is dark is a fact about
 * the room the browser is sitting in; a card size is a fact about the game master
 * themselves, so it is kept on their row in the database and arrives with their
 * identity (`/api/auth/me`). This module is only the part that puts it on the
 * page and hands it to the control that changes it.
 *
 * It is written as an *inline* custom property on the document element rather
 * than into a stylesheet. That is what makes it beat the `:root` default in
 * `styles.css` without a specificity argument, and it is the same move
 * `useColumnSplit` makes when a reader drags a column — a value that belongs to
 * this page view, set on the page rather than described in a rule.
 *
 * Only a game master ever has one applied. Players have no account to keep a
 * setting on, so their screens draw at the default, which is exactly what an
 * unset property gives them.
 */

import { useCallback, useSyncExternalStore } from "react";
import { CARD_IMAGE_PX } from "../lib/cards.ts";

const PROPERTY = "--card-image-size";

/**
 * The size in force right now, or null while nobody has asked for one.
 *
 * Module state rather than a context, so the drawer that draws the slider can
 * ask for it without the value being threaded down through two page components
 * that have no interest in it.
 */
let current: number | null = null;

const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Puts a size on the page, or takes one off.
 *
 * `null` removes the property, which drops the page back to the default in
 * `styles.css` — what a signed-out browser and a player's screen should show.
 */
export function applyCardSize(px: number | null): void {
  current = px;
  const root = document.documentElement;
  if (px === null) root.style.removeProperty(PROPERTY);
  else root.style.setProperty(PROPERTY, `${px}px`);
  for (const listener of listeners) listener();
}

/**
 * The size, and a way to change it, for the control that draws the slider.
 *
 * Reads back the default when nothing has been applied, so the slider has a
 * thumb position on a page that has not been told a size yet rather than
 * starting at zero.
 */
export function useCardSize(): [number, (px: number) => void] {
  const size = useSyncExternalStore(
    subscribe,
    () => current ?? CARD_IMAGE_PX.default,
    () => CARD_IMAGE_PX.default,
  );
  return [size, useCallback((px: number) => applyCardSize(px), [])];
}
