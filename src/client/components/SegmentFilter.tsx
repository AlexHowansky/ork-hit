/**
 * The clock button on the segment panel, and the setting behind it.
 *
 * A segment is often two characters out of nine, and the seven who are not
 * acting are the ones a game master keeps scrolling past. This narrows the panel
 * to whoever has a phase right now.
 *
 * It is one setting rather than one per segment: turned on it stays on as the
 * fight walks from segment to segment, so the panel is always showing the people
 * who are up. Nothing about it is shared — every reader has their own, the game
 * master's does not reach the players, and a player's does not reach anyone.
 * That is why it lives in the browser rather than on the session.
 *
 * `sessionStorage` rather than `localStorage`, keyed by session: it should
 * survive a reload mid-fight, and it should not still be set months later at a
 * different table. Every access is guarded, because a browser told to block site
 * data throws on the property itself rather than returning nothing.
 */

import { useCallback, useState } from "react";
import { faClock } from "@fortawesome/free-solid-svg-icons";
import { Icon } from "./ui.tsx";

function storageKey(sessionId: string): string {
  return `segment-filter:${sessionId}`;
}

function read(sessionId: string): boolean {
  try {
    return window.sessionStorage.getItem(storageKey(sessionId)) === "acting";
  } catch {
    return false;
  }
}

/**
 * Whether to show only the characters acting this segment, and a way to change
 * it. Remembered for as long as this browser tab has the session open.
 */
export function useSegmentFilter(sessionId: string): [boolean, () => void] {
  const [showActingOnly, setShowActingOnly] = useState(() => read(sessionId));

  const toggle = useCallback(() => {
    setShowActingOnly((was) => {
      const now = !was;
      try {
        window.sessionStorage.setItem(storageKey(sessionId), now ? "acting" : "all");
      } catch {
        // A remembered preference is a convenience; the toggle still works
        // without it, for this visit at least.
      }
      return now;
    });
  }, [sessionId]);

  return [showActingOnly, toggle];
}

/** The control itself, for the `actions` slot of the segment panel. */
export function SegmentFilterToggle({
  showActingOnly,
  onToggle,
}: {
  showActingOnly: boolean;
  onToggle: () => void;
}) {
  // The label says what pressing it will do rather than what state it is in,
  // since the icon and `aria-pressed` already say the latter.
  const label = showActingOnly
    ? "Show every character on the stage"
    : "Show only the characters acting this segment";

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={showActingOnly}
      title={label}
      aria-label={label}
      className={`rounded-md px-2 py-1 transition-colors ${
        showActingOnly
          ? "bg-amber-500 text-white dark:text-stone-950"
          : "text-stone-500 hover:bg-stone-200 hover:text-stone-900 dark:text-stone-400 dark:hover:bg-stone-700 dark:hover:text-stone-100"
      }`}
    >
      <Icon icon={faClock} />
    </button>
  );
}
