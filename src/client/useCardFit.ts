/**
 * Trims a card panel to a whole number of card columns.
 *
 * Every library lays its cards on a fixed-width track (`CARD_GRID`), so that a card
 * is the same size in the campaign panel as in the character panel. The cost is
 * slack: the panel is a fraction of the viewport, the track is a pixel size the
 * deployment chooses, and the two rarely divide evenly, leaving part of a column's
 * worth of empty space at the end of every row.
 *
 * This hands that slack to the panel next door. It measures how many whole columns
 * the panel's natural width holds and pins the panel to exactly that, writing the
 * width into `--campaign-col` (see `styles.css`). The pin only ever narrows: what
 * the panel gives up, the `1.4fr` beside it takes.
 *
 * Nothing here assumes a card size, a gap, or a padding. All of them are read back
 * from the rendered layout, so a deployment that draws larger cards, or a change to
 * the panel's chrome, needs no matching change here.
 */

import { useCallback, useEffect, useLayoutEffect, useRef } from "react";

/** The `wide` variant from `styles.css`: the only layout with a panel to trim. */
const WIDE = "(min-width: 1024px) and (min-aspect-ratio: 3/2)";

/** Below this the pin is not worth writing, and rounding noise could flip it. */
const EPSILON = 0.5;

export function useCardFit({ count }: { count: number }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLElement | null>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);

  const measure = useCallback(() => {
    const container = containerRef.current;
    const panel = panelRef.current;
    const grid = gridRef.current;
    if (!container) return;

    // Anything but the wide two-panel layout is left to the stylesheet: stacked, the
    // panel is full width, and with no cards there is no grid to measure.
    if (!grid || !panel || count < 1 || !window.matchMedia(WIDE).matches) {
      container.style.removeProperty("--campaign-col");
      return;
    }

    // Release the pin before measuring, so what we read is the panel's natural share
    // rather than the width we gave it last time. Reading the rects below forces the
    // layout, but no paint happens in between, so nothing flickers.
    container.style.removeProperty("--campaign-col");

    const style = getComputedStyle(grid);
    // The computed value is the *used* track list, so the first entry is the real
    // track width — `--card-image-size` plus its two borders, already resolved.
    const track = Number.parseFloat(style.gridTemplateColumns);
    const gap = Number.parseFloat(style.columnGap);
    const natural = panel.getBoundingClientRect().width;
    const available = grid.getBoundingClientRect().width;
    if (!Number.isFinite(track) || !Number.isFinite(gap) || track <= 0) return;

    // Everything the panel spends on itself: its border, its body's padding, and the
    // scrollbar. Measured rather than known, and stable because the scrollbar keeps
    // its gutter whether or not it is showing.
    const overhead = natural - available;

    // A row of n cards is n tracks and the n-1 gaps between them. Never more columns
    // than there are campaigns to fill them, and never fewer than one.
    const fits = Math.floor((available + gap) / (track + gap));
    const columns = Math.max(1, Math.min(count, fits));
    const wanted = columns * track + (columns - 1) * gap + overhead;

    // Already flush — leave the panel fluid rather than freezing it at its own width.
    if (natural - wanted < EPSILON) return;
    container.style.setProperty("--campaign-col", `${wanted}px`);
  }, [count]);

  // Before paint, so the first frame is already trimmed and the panel is never seen
  // to jump. Re-runs when `count` changes, which is what caps the column count.
  useLayoutEffect(measure);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // The container is the split as a whole, which is not affected by the width we
    // write into one of its columns — so observing it cannot feed back on itself.
    const observer = new ResizeObserver(measure);
    observer.observe(container);

    // A resize can cross the `wide` boundary without changing the container's width,
    // and turning the page portrait need not change it either.
    const query = window.matchMedia(WIDE);
    query.addEventListener("change", measure);

    return () => {
      observer.disconnect();
      query.removeEventListener("change", measure);
    };
  }, [measure]);

  return { containerRef, panelRef, gridRef };
}
