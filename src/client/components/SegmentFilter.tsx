/**
 * The button on the segment panel that narrows it to whoever is acting, and the
 * setting behind it.
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
import { faUserGroup, faUsers } from "@fortawesome/free-solid-svg-icons";
import { Button, Icon } from "./ui.tsx";

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

/**
 * The control itself, for the `actions` slot of the segment panel.
 *
 * The label names what pressing it will do rather than what state it is in, and
 * that is the whole of the state readout: a button that says `Show All` is a
 * button on a list that is already narrowed. So there is no pressed tint and no
 * `aria-pressed` — a toggle either changes its accessible name or reports itself
 * pressed, and doing both would have it announce "Show All, pressed" on a screen
 * showing anything but.
 */
export function SegmentFilterToggle({
  showActingOnly,
  onToggle,
}: {
  showActingOnly: boolean;
  onToggle: () => void;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      onClick={onToggle}
      // The whole sentence, for anyone who wants it; two words on the button
      // itself is as much as a panel heading has room for.
      title={
        showActingOnly
          ? "Show every character on the stage"
          : "Show only the characters acting this segment"
      }
    >
      {/* The icon says the same thing as the words beside it: a crowd for the
          whole stage, a handful for the few with a phase this segment. */}
      <Icon icon={showActingOnly ? faUsers : faUserGroup} />{" "}
      {showActingOnly ? "Show All" : "Show Acting"}
    </Button>
  );
}
