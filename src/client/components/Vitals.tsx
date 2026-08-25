/**
 * What a character has left: ENDURANCE, STUN and BODY.
 *
 * The same three boxes serve every screen that shows them — the game master's
 * initiative order, a player's own character panel — so a number is written the
 * same way wherever it is read: what this copy has left, over the total the
 * character carries in the library.
 *
 * Editing is deliberately unfussy, because it happens mid-fight: type over the
 * number and it is saved when you leave the box or press Enter, Escape puts it
 * back. Nothing is sent per keystroke — a half-typed "-" or "1" on the way to
 * "12" is not a value anyone should see on the other screens.
 *
 * Values are signed on purpose: a HERO character at -8 STUN is unconscious, not
 * a mistake, and nothing here clamps to the total either, since a Recovery can
 * take a character back up to it but a temporary boost can take them past it.
 */

import { useEffect, useRef, useState } from "react";
import { HERO_STAT_LABELS, HERO_VITAL_FIELDS, type HeroVitalField } from "../../lib/hero.ts";
import type { SessionCharacter } from "../types.ts";

/** The two numbers one box shows: what is left, and what it is out of. */
function pairFor(
  character: SessionCharacter,
  field: HeroVitalField,
): { current: number; max: number } {
  if (field === "endurance") {
    return { current: character.currentEndurance, max: character.endurance };
  }
  if (field === "stun") return { current: character.currentStun, max: character.stun };
  return { current: character.currentBody, max: character.body };
}

export type VitalsPatch = Partial<Record<HeroVitalField, number>>;

function Box({
  label,
  current,
  max,
  onCommit,
  name,
}: {
  label: string;
  current: number;
  max: number;
  /** Absent for a read-only box. */
  onCommit?: (value: number) => void;
  /** Who this belongs to, for the accessible label — a list needs telling apart. */
  name: string;
}) {
  // While a box is being typed into it holds the typing; the rest of the time it
  // follows the snapshot, so a value someone else changed arrives here too.
  const [draft, setDraft] = useState<string | null>(null);
  const committed = useRef(current);
  committed.current = current;

  // A snapshot that changes this number out from under an open box wins: the
  // alternative is a player quietly overwriting a game master's correction with
  // whatever was half-typed when it arrived.
  useEffect(() => {
    setDraft(null);
  }, [current]);

  const commit = () => {
    if (draft === null) return;
    setDraft(null);
    const parsed = Number.parseInt(draft, 10);
    if (Number.isNaN(parsed) || parsed === committed.current) return;
    onCommit?.(Math.max(-999, Math.min(999, parsed)));
  };

  return (
    <div className="flex items-center gap-1">
      <span className="text-[10px] font-semibold tracking-wide text-stone-500 uppercase dark:text-stone-400">
        {label}
      </span>
      {onCommit ? (
        <input
          type="text"
          inputMode="numeric"
          value={draft ?? String(current)}
          aria-label={`${label} left for ${name}`}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              event.currentTarget.blur();
            } else if (event.key === "Escape") {
              setDraft(null);
            }
          }}
          // A row in the initiative order is draggable, and a drag started on a
          // box would be a drag instead of a caret.
          onPointerDown={(event) => event.stopPropagation()}
          className="w-11 rounded border border-stone-300 bg-white px-1 py-0.5 text-center text-xs tabular-nums text-stone-900 focus:border-amber-500 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100"
        />
      ) : (
        <span className="text-xs font-medium tabular-nums text-stone-800 dark:text-stone-200">
          {current}
        </span>
      )}
      <span className="text-xs tabular-nums text-stone-400 dark:text-stone-500">/{max}</span>
    </div>
  );
}

export function Vitals({
  character,
  onChange,
  className = "",
}: {
  character: SessionCharacter;
  /** Absent where this reader may look but not touch. */
  onChange?: (patch: VitalsPatch) => void;
  className?: string;
}) {
  return (
    <div className={`flex flex-wrap items-center gap-x-3 gap-y-1 ${className}`}>
      {HERO_VITAL_FIELDS.map((field) => {
        const { current, max } = pairFor(character, field);
        return (
          <Box
            key={field}
            label={HERO_STAT_LABELS[field]}
            current={current}
            max={max}
            name={character.name}
            onCommit={onChange ? (value) => onChange({ [field]: value }) : undefined}
          />
        );
      })}
    </div>
  );
}
