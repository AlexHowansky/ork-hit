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
import { Button } from "./ui.tsx";

export function TurnControls({
  round,
  activeCharacterName,
  editable,
  onAdvance,
  disabled = false,
}: {
  round: number;
  activeCharacterName: string | null;
  editable: boolean;
  onAdvance?: (direction: "next" | "prev") => void;
  disabled?: boolean;
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
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-stone-200 bg-white px-4 py-3 dark:border-stone-800 dark:bg-stone-900">
      <div>
        <p className="text-xs font-semibold tracking-wide text-stone-500 uppercase dark:text-stone-400">
          Round {round}
        </p>
        <p className="mt-0.5 text-sm text-stone-800 dark:text-stone-200" aria-live="polite">
          {activeCharacterName ? (
            <>
              <span className="text-stone-500 dark:text-stone-400">Up now: </span>
              <span className="font-semibold">{activeCharacterName}</span>
            </>
          ) : (
            <span className="text-stone-500 dark:text-stone-400">No turn set yet</span>
          )}
        </p>
      </div>

      {editable && onAdvance ? (
        <div className="flex items-center gap-2">
          <Button
            type="button"
            onClick={() => onAdvance("prev")}
            disabled={disabled}
            title="Previous turn (left arrow)"
          >
            ← Previous
          </Button>
          <Button
            variant="primary"
            type="button"
            onClick={() => onAdvance("next")}
            disabled={disabled}
            title="Next turn (right arrow)"
          >
            Next →
          </Button>
        </div>
      ) : null}
    </div>
  );
}
