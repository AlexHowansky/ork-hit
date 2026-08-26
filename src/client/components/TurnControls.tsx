/**
 * The turn tracker.
 *
 * The game master gets the round counter and the controls that walk the
 * initiative order; players get the same counter with no controls, so both
 * screens read the same round at the same time.
 *
 * Stepping past the end of the order wraps to the top and advances the round —
 * that arithmetic lives on the server, so two open game master tabs can't
 * disagree about it.
 */

import { useEffect } from "react";
import { faArrowLeft, faArrowRight, faRotateLeft } from "@fortawesome/free-solid-svg-icons";
import { Button, Icon, PANEL_CAPTION, SURFACE, TEXT_BODY, TEXT_MUTED } from "./ui.tsx";

export function TurnControls({
  round,
  activeCharacterName,
  editable,
  onAdvance,
  onRestart,
  disabled = false,
  className = "",
}: {
  round: number;
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
      className={`flex flex-wrap items-center justify-between gap-3 px-4 py-3 ${SURFACE} ${className}`}
    >
      <div>
        <p className={`text-xs ${PANEL_CAPTION}`}>Round {round}</p>
        <p className={`mt-0.5 text-sm ${TEXT_BODY}`} aria-live="polite">
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
              disabled={disabled || (round === 1 && activeCharacterName === null)}
              title="Back to round 1, with no turn set"
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
