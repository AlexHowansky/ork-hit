/**
 * The turn tracker.
 *
 * The game master gets the Turn counter and the controls that walk the HERO
 * clock; players get the same counter with no controls, so both screens read the
 * same turn at the same time. Which segment of that turn the fight is on heads
 * the segment panel below rather than sitting here — the counter answers "how
 * long has this fight been going", the panel answers "who is up".
 *
 * Stepping off the end of a segment walks to the next segment anybody acts in,
 * and arriving at segment 1 advances the turn — that arithmetic lives on the
 * server, so two open game master tabs can't disagree about it.
 */

import { useEffect } from "react";
import { faArrowLeft, faArrowRight, faRotateLeft } from "@fortawesome/free-solid-svg-icons";
import { Button, Icon, PANEL_CAPTION, SURFACE, TEXT_MUTED } from "./ui.tsx";

export function TurnControls({
  turn,
  activeCharacterName,
  editable,
  onAdvance,
  onRestart,
  disabled = false,
  className = "",
}: {
  turn: number;
  activeCharacterName: string | null;
  editable: boolean;
  onAdvance?: (direction: "next" | "prev") => void;
  /** Omitted where there is nothing to restart — the player screens. */
  onRestart?: () => void;
  disabled?: boolean;
  className?: string;
}) {
  // Arrow keys drive the tracker, so the game master can run turns without
  // hunting for the buttons. Ignored while typing into a field.
  useEffect(() => {
    if (!editable || !onAdvance || disabled) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable=true]")) return;

      if (event.key === "ArrowRight") {
        event.preventDefault();
        onAdvance("next");
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        onAdvance("prev");
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [editable, onAdvance, disabled]);

  return (
    <div
      // `flex-row` explicitly: `SURFACE` is daisyUI's `card`, which is a flex
      // *column*, and `flex` alone would leave that direction in place — the
      // counter and the buttons would stack up the middle instead of sitting at
      // either end of the bar.
      className={`flex flex-row flex-wrap items-center justify-between gap-3 px-4 py-3 ${SURFACE} ${className}`}
    >
      <div>
        <p className={`text-xs ${PANEL_CAPTION}`}>Turn {turn}</p>
        <p className="mt-0.5 text-sm" aria-live="polite">
          {activeCharacterName ? (
            <>
              <span className={TEXT_MUTED}>Up now: </span>
              <span className="font-semibold">{activeCharacterName}</span>
            </>
          ) : (
            <span className={TEXT_MUTED}>No turn set yet</span>
          )}
        </p>
      </div>

      {editable && onAdvance ? (
        <div className="flex items-center gap-2">
          {onRestart ? (
            <Button
              type="button"
              variant="ghost"
              onClick={onRestart}
              // Nothing to go back to at the very start, and the disabled state
              // says so more usefully than a dialog asking about a no-op would.
              disabled={disabled || (turn === 1 && activeCharacterName === null)}
              title="Back to turn 1, segment 12, with no turn set"
              className="mr-1"
            >
              <Icon icon={faRotateLeft} /> Restart
            </Button>
          ) : null}
          <Button
            type="button"
            onClick={() => onAdvance("prev")}
            disabled={disabled}
            title="Previous turn (left arrow)"
          >
            <Icon icon={faArrowLeft} /> Previous
          </Button>
          <Button
            variant="primary"
            type="button"
            onClick={() => onAdvance("next")}
            disabled={disabled}
            title="Next turn (right arrow)"
          >
            Next <Icon icon={faArrowRight} />
          </Button>
        </div>
      ) : null}
    </div>
  );
}
