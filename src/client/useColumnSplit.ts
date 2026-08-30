/**
 * The boundary between two side-by-side panels, as something the reader can drag.
 *
 * The wide layout splits a page into columns whose widths the app chooses — on the
 * GM library, the campaign panel is trimmed to a whole number of card columns and
 * the character panel takes what is left (`useCardFit`). That is a good default and
 * a poor rule: a table with twenty campaigns and three characters wants the
 * opposite balance, and only the person looking at it knows which.
 *
 * So this owns the same width `useCardFit` writes, and the two take turns. Until
 * the handle is touched the automatic fit has it; from the first drag the reader's
 * width is in force and the fit stands down (`enabled`); a double-click or Enter on
 * the handle gives it back. The choice lasts for the visit and is not stored — a
 * reload is the other way back to the automatic fit.
 *
 * The drag writes the width straight to the container's inline style rather than
 * through React state. A pointer-move fires at the screen's refresh rate, and every
 * one of them would otherwise re-render both libraries and every card in them; the
 * only state here is which of the two writers is in charge, which changes twice per
 * gesture.
 *
 * Nothing here assumes a pixel size. How far a key-press moves the split, and how
 * narrow a panel may be squeezed, are both read back from the card track
 * (`measureTrack`), so neither panel can be dragged narrower than one whole card
 * and a deployment drawing larger cards needs no change here.
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import { measureTrack, useCardFit, type SplitRefs } from "./useCardFit.ts";

/** Fallbacks for a split with no cards in it yet to measure. */
const FALLBACK_STEP = 64;

export function useColumnSplit({ count, variable }: { count: number; variable: string }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLElement | null>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const handleRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ pointer: number; from: number; at: number } | null>(null);

  const [manual, setManual] = useState(false);

  const refs: SplitRefs = { containerRef, panelRef, gridRef };
  useCardFit({ count, enabled: !manual, variable, refs });

  /**
   * How far the split may travel, and how far a key-press moves it.
   *
   * Both panels lay their cards on the same track, so one panel's smallest useful
   * width is also the other's: a single card column plus what the panel spends on
   * its own chrome. Holding the far side to that as well is what stops a drag to
   * the edge crushing the panel it is dragged towards.
   */
  const limits = useCallback(() => {
    const container = containerRef.current;
    const panel = panelRef.current;
    if (!container || !panel) return null;

    const total = container.getBoundingClientRect().width;
    const gutter = handleRef.current?.getBoundingClientRect().width ?? 0;
    const grid = gridRef.current;
    const measured = grid ? measureTrack(panel, grid) : null;

    // With no cards to measure, a third of the split each way is a reasonable
    // guess at "not crushed" and nothing else here depends on it being exact.
    const smallest = measured ? measured.track + measured.overhead : total / 3;
    const room = Math.max(0, total - gutter);
    const min = Math.min(smallest, room);
    return {
      room,
      min,
      max: Math.max(min, room - smallest),
      step: measured ? measured.track + measured.gap : FALLBACK_STEP,
    };
  }, []);

  /**
   * Tells a screen reader where the split is, as a percentage of the room the two
   * panels share. Written to the DOM rather than rendered, for the same reason the
   * width is.
   */
  const describe = useCallback(() => {
    const handle = handleRef.current;
    const panel = panelRef.current;
    const bounds = limits();
    if (!handle || !panel || !bounds || bounds.room <= 0) return;

    const percent = (value: number) => String(Math.round((value / bounds.room) * 100));
    handle.setAttribute("aria-valuenow", percent(panel.getBoundingClientRect().width));
    handle.setAttribute("aria-valuemin", percent(bounds.min));
    handle.setAttribute("aria-valuemax", percent(bounds.max));
  }, [limits]);

  /** Puts the split at `width`, or as close to it as both panels can bear. */
  const apply = useCallback(
    (width: number) => {
      const container = containerRef.current;
      const bounds = limits();
      if (!container || !bounds) return;

      container.style.setProperty(
        variable,
        `${Math.min(bounds.max, Math.max(bounds.min, width))}px`,
      );
      describe();
    },
    [limits, describe, variable],
  );

  /** Hands the width back to the automatic fit, which re-pins on the next render. */
  const reset = useCallback(() => {
    containerRef.current?.style.removeProperty(variable);
    setManual(false);
  }, [variable]);

  const nudge = useCallback(
    (direction: -1 | 1, fine: boolean) => {
      const panel = panelRef.current;
      const bounds = limits();
      if (!panel || !bounds) return;
      setManual(true);
      // A whole card column at a time, so the panel lands where the automatic fit
      // would have put it; with a modifier, a tenth of that for a nudge.
      const step = fine ? bounds.step / 10 : bounds.step;
      apply(panel.getBoundingClientRect().width + direction * step);
    },
    [limits, apply],
  );

  const onPointerDown = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      // Primary button only: a right-click on the gutter is not a drag, and a
      // context menu opening mid-gesture would leave the pointer captured.
      if (event.button !== 0) return;
      const panel = panelRef.current;
      if (!panel) return;

      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      dragRef.current = {
        pointer: event.pointerId,
        from: event.clientX,
        at: panel.getBoundingClientRect().width,
      };
      setManual(true);
    },
    [],
  );

  const onPointerMove = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag || drag.pointer !== event.pointerId) return;
      apply(drag.at + (event.clientX - drag.from));
    },
    [apply],
  );

  const onPointerUp = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointer !== event.pointerId) return;
    dragRef.current = null;
    // Releasing capture on an element that has already lost it throws in no browser
    // we support, but the check keeps a cancelled gesture honest.
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, []);

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      const bounds = limits();
      if (!bounds) return;

      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        nudge(event.key === "ArrowLeft" ? -1 : 1, event.shiftKey);
      } else if (event.key === "Home" || event.key === "End") {
        event.preventDefault();
        setManual(true);
        apply(event.key === "Home" ? bounds.min : bounds.max);
      } else if (event.key === "Enter") {
        event.preventDefault();
        reset();
      }
    },
    [limits, nudge, apply, reset],
  );

  // After the render that changed hands: a reset has just been re-pinned by the
  // automatic fit, and a drag's first move has not landed yet — either way the
  // description is of a width that is now on screen.
  useLayoutEffect(describe, [describe, manual]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver(() => {
      // A window that has narrowed can leave a width the panels can no longer bear,
      // so the reader's own width is re-clamped rather than merely re-described.
      const panel = panelRef.current;
      if (manual && panel) apply(panel.getBoundingClientRect().width);
      else describe();
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [manual, apply, describe]);

  return {
    ...refs,
    /** Spread onto `ColumnHandle`. */
    handleProps: {
      ref: handleRef,
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel: onPointerUp,
      onDoubleClick: reset,
      onKeyDown,
    },
  };
}
