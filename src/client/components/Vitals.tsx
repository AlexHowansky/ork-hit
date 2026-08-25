/**
 * What a character has left: ENDURANCE, STUN and BODY.
 *
 * The same three boxes serve every screen that shows them — the game master's
 * initiative order, a player's own character panel — so a number is written the
 * same way wherever it is read: what this copy has left, over the total the
 * character carries in the library.
 *
 * Editing is deliberately unfussy, because it happens mid-fight: press the
 * number and pick how much came off or went back on, and the app does the sum.
 * An exact value is still reachable in the same dialog, for setting a monster up
 * or putting right a mistake.
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

import { useState } from "react";
import type { IconDefinition } from "@fortawesome/fontawesome-svg-core";
import { faBed, faHeartPulse } from "@fortawesome/free-solid-svg-icons";
import { Button, Field, Icon, Modal } from "./ui.tsx";
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

/**
 * The picker a box opens: how much to take, or how much to recover.
 *
 * Mid-fight the number in hand is never the total, it is the change — "that's
 * eleven STUN" — so this asks for the change and does the sum. Taking and
 * recovering are separate blocks rather than one long run through zero, because
 * a misread sign in a fight is a character knocked out by a heal.
 *
 * The small numbers come first in each block: most of what a die roll produces
 * is single figures, and the fifties are there for the bad round.
 *
 * An exact value is still reachable at the bottom, because a game master setting
 * a monster up, or correcting a mistake, knows the number they want rather than
 * the difference to it.
 */
const STEPS = Array.from({ length: 50 }, (_, index) => index + 1);

function DeltaPicker({
  label,
  name,
  current,
  max,
  onPick,
  onSet,
  onClose,
}: {
  label: string;
  name: string;
  current: number;
  max: number;
  onPick: (delta: number) => void;
  onSet: (value: number) => void;
  onClose: () => void;
}) {
  const [exact, setExact] = useState(String(current));

  const grid = (sign: 1 | -1) => (
    <div className="grid grid-cols-10 gap-1">
      {STEPS.map((step) => (
        <button
          key={step}
          type="button"
          onClick={() => onPick(sign * step)}
          className={`rounded py-1 text-xs font-medium tabular-nums ${
            sign < 0
              ? "bg-rose-50 text-rose-900 hover:bg-rose-200 dark:bg-rose-950/50 dark:text-rose-100 dark:hover:bg-rose-900"
              : "bg-emerald-50 text-emerald-900 hover:bg-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-100 dark:hover:bg-emerald-900"
          }`}
        >
          {sign < 0 ? "−" : "+"}
          {step}
        </button>
      ))}
    </div>
  );

  return (
    <Modal title={`${label} — ${name}`} onClose={onClose}>
      <p className="mb-4 text-sm text-stone-600 dark:text-stone-400">
        <span className="font-semibold tabular-nums text-stone-900 dark:text-stone-100">
          {current}
        </span>
        {max > 0 ? <span className="tabular-nums"> of {max}</span> : null}. Choose how much to
        take or recover.
      </p>

      <p className="mb-1 text-xs font-semibold tracking-wide text-stone-500 uppercase dark:text-stone-400">
        Take
      </p>
      {grid(-1)}

      <p className="mt-4 mb-1 text-xs font-semibold tracking-wide text-stone-500 uppercase dark:text-stone-400">
        Recover
      </p>
      {grid(1)}

      <form
        className="mt-5 flex items-end gap-2 border-t border-stone-200 pt-4 dark:border-stone-800"
        onSubmit={(event) => {
          event.preventDefault();
          const parsed = Number.parseInt(exact, 10);
          if (!Number.isNaN(parsed)) onSet(parsed);
        }}
      >
        <Field
          label="Or set it exactly"
          value={exact}
          inputMode="numeric"
          onChange={(event) => setExact(event.target.value)}
          className="w-24"
        />
        <Button type="submit" className="mb-px">
          Set
        </Button>
      </form>
    </Modal>
  );
}

/**
 * One characteristic: what is left, over the total.
 *
 * Where it may be changed the number is a button rather than a field. Typing a
 * new total into a box means doing the subtraction in your head first, and doing
 * it at the table, in a hurry, is where the mistakes are — so a press opens the
 * picker above and the arithmetic is the app's.
 */
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
  const [picking, setPicking] = useState(false);

  // Bounded to what the API takes, so a run of presses on a nearly-dead monster
  // cannot walk the number off the end of what can be saved.
  const clamp = (value: number) => Math.max(-999, Math.min(999, value));

  const shared = `w-11 rounded border px-1 py-0.5 text-center text-xs font-medium tabular-nums ${toneFor(current, max)}`;

  return (
    <div className="flex items-center gap-1">
      <span className="text-[10px] font-semibold tracking-wide text-stone-500 uppercase dark:text-stone-400">
        {label}
      </span>
      {onCommit ? (
        <>
          <button
            type="button"
            aria-label={`${label} left for ${name}`}
            title={`${label} left for ${name} — press to change`}
            onClick={() => setPicking(true)}
            // A row in the initiative order is draggable, and a press here is a
            // press rather than the start of a drag.
            onPointerDown={(event) => event.stopPropagation()}
            className={`${shared} cursor-pointer hover:brightness-95 dark:hover:brightness-125`}
          >
            {current}
          </button>
          {picking ? (
            <DeltaPicker
              label={label}
              name={name}
              current={current}
              max={max}
              onPick={(delta) => {
                setPicking(false);
                onCommit(clamp(current + delta));
              }}
              onSet={(value) => {
                setPicking(false);
                if (value !== current) onCommit(clamp(value));
              }}
              onClose={() => setPicking(false)}
            />
          ) : null}
        </>
      ) : (
        <span className={shared}>{current}</span>
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
