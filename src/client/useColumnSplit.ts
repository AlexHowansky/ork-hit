/**
 * The boundary between two side-by-side columns, as something the reader can drag.
 *
 * A wide layout splits a page into columns whose widths the app chooses — equal
 * thirds on the session console, and on the GM library a campaign panel trimmed to
 * a whole number of card columns with the character panel taking what is left
 * (`useCardFit`). Those are good defaults and poor rules: a table with twenty
 * campaigns and three characters wants the opposite balance, and only the person
 * looking at it knows which.
 *
 * One of these drives one handle, and sizes the column to its left; the column at
 * the far end of the split has no handle and absorbs whatever the others give up.
 * Two of them side by side is what makes the console's three columns draggable.
 *
 * Where a column also has an automatic width — the library's card fit — the two
 * take turns writing the same custom property. Until the handle is touched the fit
 * has it; from the first drag `manual` is set and the caller stands the fit down
 * (`useCardFit`'s `enabled`); a double-click or Enter on the handle removes the
 * width and hands it back. The choice lasts for the visit and is not stored — a
 * reload is the other way back to the automatic width.
 *
 * The drag writes the width straight to the container's inline style rather than
 * through React state. A pointer-move fires at the screen's refresh rate, and every
 * one of them would otherwise re-render the whole screen; the only state here is
 * which writer is in charge, which changes twice per gesture.
 *
 * Nothing here assumes a pixel size or a column count. Both are read back from the
 * layout on screen — see `limits`.
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type RefObject,
} from "react";

/**
 * The floor a column may be dragged to, and how far a key-press moves the split,
 * for a split whose caller has nothing better to offer. Fractions of the room the
 * columns share rather than pixel sizes, so they mean the same thing on a laptop
 * and on a dashboard: no column may be squeezed below a sixth of the split, and a
 * key-press moves it by a twentieth.
 */
const FLOOR = 1 / 6;
const STEP = 1 / 20;

export function useColumnSplit<Column extends HTMLElement = HTMLElement>({
  containerRef,
  variable,
  measure,
}: {
  /** The grid holding every column of this split, handles included. */
  containerRef: RefObject<HTMLDivElement | null>;
  /** The custom property this handle writes its column's width to. */
  variable: string;
  /**
   * How narrow this column may go, and how far a key-press moves it, where the
   * caller can do better than the fractions above — the library measures a whole
   * card so a panel is never dragged to show part of one. `null` falls back.
   */
  measure?: (panel: Column) => { min: number; step: number } | null;
}) {
  // Typed by the caller, so the ref goes onto the element the column actually is
  // — a `<section>` on the library, a wrapper `<div>` on the console.
  const panelRef = useRef<Column | null>(null);
  const handleRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ pointer: number; from: number; at: number } | null>(null);

  const [manual, setManual] = useState(false);

  /**
   * How far this split may travel, and how far a key-press moves it.
   *
   * Worked out from the handles on screen rather than from a column count the hook
   * is told: every handle in this container is one gutter and marks one boundary,
   * so the ones to the right of this column are exactly the columns that still
   * have to fit after it. Their rects are also the only reliable reading of which
   * column is where — the console orders its columns with `order`, so their
   * position in the DOM is not their position on the page.
   *
   * Holding every column to the right at its floor is what stops a drag to the
   * edge crushing them, and taking the columns to the *left* at the width they
   * currently have is what keeps this handle's arithmetic about its own boundary.
   */
  const limits = useCallback(() => {
    const container = containerRef.current;
    const panel = panelRef.current;
    const handle = handleRef.current;
    if (!container || !panel || !handle) return null;

    const box = container.getBoundingClientRect();
    const mine = panel.getBoundingClientRect();
    // A hidden handle has no box, and neither has a column that is `display:
    // contents` on this layout — there is nothing to size on either count.
    const handles = Array.from(container.querySelectorAll<HTMLElement>('[role="separator"]'))
      .map((element) => element.getBoundingClientRect())
      .filter((rect) => rect.width > 0)
      .sort((a, b) => a.left - b.left);
    if (mine.width <= 0 || handles.length === 0) return null;

    const gutters = handles.reduce((total, rect) => total + rect.width, 0);
    const room = box.width - gutters;
    const before =
      mine.left -
      box.left -
      handles.reduce((total, rect) => (rect.right <= mine.left ? total + rect.width : total), 0);
    const after = handles.filter((rect) => rect.left >= mine.right).length;

    const measured = measure?.(panel) ?? null;
    const min = Math.min(measured?.min ?? room * FLOOR, room);
    return {
      room,
      min,
      // A first guess at the far end, on the assumption that every column beyond
      // this one can be squeezed to its floor. Some cannot — a column another
      // handle has pinned does not give up anything — so `apply` checks the
      // result and gives room back where it has to.
      max: Math.max(min, room - before - after * min),
      step: measured?.step ?? room * STEP,
    };
  }, [containerRef, measure]);

  /**
   * The narrowest column to the right of this one, or `null` where there is none
   * to measure.
   *
   * Read off the handles rather than the columns: a column runs from one handle to
   * the next, so the boundaries on screen describe every column between them
   * without having to find the elements — which is just as well, since on the
   * console a column may be a `display: contents` wrapper's child rather than a
   * box of the container's own.
   */
  const smallestBeyond = useCallback(() => {
    const container = containerRef.current;
    const panel = panelRef.current;
    if (!container || !panel) return null;

    const box = container.getBoundingClientRect();
    const mine = panel.getBoundingClientRect();
    const handles = Array.from(container.querySelectorAll<HTMLElement>('[role="separator"]'))
      .map((element) => element.getBoundingClientRect())
      .filter((rect) => rect.width > 0 && rect.left >= mine.right)
      .sort((a, b) => a.left - b.left);
    if (handles.length === 0) return null;

    // From this panel's own handle to the next one, and from the last handle to
    // the end of the split.
    const widths = handles.map((rect, index) =>
      (index + 1 < handles.length ? handles[index + 1]!.left : box.right) - rect.right,
    );
    return Math.min(...widths);
  }, [containerRef]);

  /**
   * Tells a screen reader where the split is, as a percentage of the room the
   * columns share. Written to the DOM rather than rendered, for the same reason
   * the width is.
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

  /** Puts the split at `width`, or as close to it as the columns can bear. */
  const apply = useCallback(
    (width: number) => {
      const container = containerRef.current;
      const bounds = limits();
      if (!container || !bounds) return;

      let wanted = Math.min(bounds.max, Math.max(bounds.min, width));
      // Then check the far end and give room back where the guess was too
      // generous. How the columns beyond share what this one leaves is the
      // browser's business — one may be pinned by another handle and give up
      // nothing, two fluid ones shrink together — so rather than model it, put the
      // width on the page and read what happened. Each pass hands back what the
      // narrowest column is short by, which brings it at least halfway there, so a
      // few passes settle it; the common case is one, because the guess is only
      // wrong near the edge.
      for (let pass = 0; pass < 5; pass += 1) {
        container.style.setProperty(variable, `${wanted}px`);
        const smallest = smallestBeyond();
        if (smallest === null || smallest >= bounds.min - 0.5) break;
        wanted = Math.max(bounds.min, wanted - (bounds.min - smallest));
      }
      describe();
    },
    [containerRef, limits, smallestBeyond, describe, variable],
  );

  /** Hands the width back to whatever sets it when nobody has dragged it. */
  const reset = useCallback(() => {
    containerRef.current?.style.removeProperty(variable);
    setManual(false);
  }, [containerRef, variable]);

  const nudge = useCallback(
    (direction: -1 | 1, fine: boolean) => {
      const panel = panelRef.current;
      const bounds = limits();
      if (!panel || !bounds) return;
      setManual(true);
      // A whole step at a time — on the library a whole card column, so the panel
      // lands where the automatic fit would have put it; with a modifier, a tenth
      // of that for a nudge.
      const step = fine ? bounds.step / 10 : bounds.step;
      apply(panel.getBoundingClientRect().width + direction * step);
    },
    [limits, apply],
  );

  const onPointerDown = useCallback((event: PointerEvent<HTMLDivElement>) => {
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
  }, []);

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

  // After the render that changed hands: a reset has just been re-pinned by
  // whatever sets the width automatically, and a drag's first move has not landed
  // yet — either way the description is of a width that is now on screen.
  useLayoutEffect(describe, [describe, manual]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver(() => {
      // A window that has narrowed can leave a width the columns can no longer
      // bear, so the reader's own width is re-clamped rather than merely
      // re-described.
      const panel = panelRef.current;
      if (manual && panel) apply(panel.getBoundingClientRect().width);
      else describe();
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [containerRef, manual, apply, describe]);

  return {
    /** Goes on the column this handle sizes: the one to its left. */
    panelRef,
    /** Whether the reader's own width is in force. */
    manual,
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
