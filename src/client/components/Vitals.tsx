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
 * Each box is coloured by how much of the total is left — see `toneFor` — so the
 * state of a fight reads off the panel before any of the numbers do.
 *
 * The two buttons at the end are the only arithmetic here, and it is the
 * server's: a Recovery puts RECOVERY back into ENDURANCE and STUN without going
 * over the character's total, and a rest sets both to it.
 *
 * Values are signed on purpose: a HERO character at -8 STUN is unconscious, not
 * a mistake, and nothing here clamps to the total either, since a Recovery can
 * take a character back up to it but a temporary boost can take them past it.
 */

import { useEffect, useRef, useState } from "react";
import type { IconDefinition } from "@fortawesome/fontawesome-svg-core";
import { faBed, faHeartPulse } from "@fortawesome/free-solid-svg-icons";
import { Icon } from "./ui.tsx";
import {
  HERO_STAT_LABELS,
  HERO_VITAL_FIELDS,
  bandFor,
  type HeroVitalField,
  type VitalBand,
} from "../../lib/hero.ts";
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

/**
 * What each band looks like: red when a character is nearly out, yellow while
 * they are wearing down, green while they are holding up — the reading a fuel
 * gauge gives, so a game master glancing down the initiative order sees who is
 * in trouble without reading a single number. `bandFor` decides which is which.
 *
 * Border, number and a faint wash together, because the boxes are small: a
 * border alone at this size is a hairline. The number is always there to read,
 * which is what a reader who cannot separate red from green goes by, and the
 * wash stays faint enough to keep it legible in both themes.
 */
const TONES: Record<VitalBand, string> = {
  low: "border-rose-400 bg-rose-50 text-rose-900 dark:border-rose-500/70 dark:bg-rose-950/50 dark:text-rose-100",
  middling:
    "border-amber-400 bg-amber-50 text-amber-900 dark:border-amber-500/70 dark:bg-amber-950/50 dark:text-amber-100",
  full: "border-emerald-400 bg-emerald-50 text-emerald-900 dark:border-emerald-500/70 dark:bg-emerald-950/50 dark:text-emerald-100",
  // No total is no reading, rather than a good one or a bad one.
  unknown: "border-stone-300 bg-white text-stone-900 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100",
};

const toneFor = (current: number, max: number) => TONES[bandFor(current, max)];

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
          className={`w-11 rounded border px-1 py-0.5 text-center text-xs font-medium tabular-nums focus:border-amber-500 ${toneFor(current, max)}`}
        />
      ) : (
        <span className={`rounded border px-1 py-0.5 text-xs font-medium tabular-nums ${toneFor(current, max)}`}>
          {current}
        </span>
      )}
      <span className="text-xs tabular-nums text-stone-400 dark:text-stone-500">/{max}</span>
    </div>
  );
}

/**
 * The two controls that put numbers back: a Recovery, and a rest.
 *
 * Icons rather than words because they sit at the end of a row of small boxes in
 * a narrow panel, where "Take a Recovery" would be wider than the three numbers
 * it follows. What each does is spelled out in the label and the tooltip, which
 * is where a control with a picture on it says what it means.
 */
function VitalAction({ icon, label, title, onClick }: {
  icon: IconDefinition;
  label: string;
  title: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      // A row in the initiative order is draggable, and a press here is a press.
      onPointerDown={(event) => event.stopPropagation()}
      title={title}
      aria-label={label}
      className="flex h-6 w-6 items-center justify-center rounded text-stone-500 hover:bg-stone-200 hover:text-stone-800 dark:text-stone-400 dark:hover:bg-stone-700 dark:hover:text-stone-100"
    >
      <Icon icon={icon} />
    </button>
  );
}

export function Vitals({
  character,
  onChange,
  onRecover,
  onRest,
  className = "",
}: {
  character: SessionCharacter;
  /** Absent where this reader may look but not touch. */
  onChange?: (patch: VitalsPatch) => void;
  /** Both absent for the same reason: this reader may look but not touch. */
  onRecover?: () => void;
  onRest?: () => void;
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
      {onRecover ? (
        <VitalAction
          icon={faHeartPulse}
          label={`Take a Recovery for ${character.name}`}
          title={`Take a Recovery: +${character.recovery} to END and STUN, up to full`}
          onClick={onRecover}
        />
      ) : null}
      {onRest ? (
        <VitalAction
          icon={faBed}
          label={`Rest ${character.name}`}
          title="Rest: END and STUN back to full"
          onClick={onRest}
        />
      ) : null}
    </div>
  );
}
