/**
 * The segment panel: everybody on the stage, in the order they act.
 *
 * The same component serves both audiences: the game master can click a row to
 * hand it the turn, while players get the same list as a read-only view. That
 * keeps the two screens honestly in agreement about what the order is.
 *
 * The two rows are not identical under the name, though, and `editable` is what
 * decides: the game master's carries the four looked-up characteristics, since
 * this is where the order is worked out and those are what it is worked out
 * from, and a player's carries who is playing what, which is what their scene is
 * asked for. Neither is missing the other for want of room.
 *
 * Nothing here decides the order. It arrives already sorted — SPD says which
 * segments a character acts in, DEX+INIT says who goes first inside one — and
 * this only draws it, dimming the characters who have no phase in the segment
 * the fight is on, or hiding them outright when the reader asks for that.
 */

import type { SessionCharacter } from "../types.ts";
import { faPlay, faUserMinus } from "@fortawesome/free-solid-svg-icons";
import { actsIn } from "../../lib/hero.ts";
import { StatLine } from "./StatLine.tsx";
import {
  CharacterThumb,
  CountBadge,
  EmptyState,
  Icon,
  KindBadge,
  TEXT_BODY,
  TEXT_MUTED,
} from "./ui.tsx";
import { Vitals, type VitalsPatch } from "./Vitals.tsx";

/**
 * What to call one slot, given the whole stage.
 *
 * The copy number only appears while there is another copy to tell this one
 * apart from — a lone goblin is just "Goblin". Shared so the turn banner and the
 * segment row never disagree about what the monster on turn is called.
 */
export function stageLabel(characters: SessionCharacter[], slot: SessionCharacter): string {
  const copies = characters.filter((entry) => entry.characterId === slot.characterId).length;
  return copies > 1 ? `${slot.name} ${slot.copyNumber}` : slot.name;
}

interface RowProps {
  character: SessionCharacter;
  index: number;
  /** How many copies of this character are on the stage, counting this one. */
  copies: number;
  isActive: boolean;
  /** Whether this character has a phase in the segment the fight is on. */
  isActing: boolean;
  editable: boolean;
  /** Marks the viewing player's own character in the association line. */
  isYours: boolean;
  /**
   * Absent where this reader may read the numbers but not write them. Separate
   * from `editable`, which is the game master's remove: on the player's screen
   * the whole list is read-only, and on the game master's every row is writable,
   * but the two are different questions.
   */
  onSetVitals?: (patch: VitalsPatch) => void;
  onRecover?: () => void;
  onRest?: () => void;
  onSetTurn?: () => void;
  onRemove?: () => void;
}

function Row({
  character,
  index,
  copies,
  isActive,
  isActing,
  editable,
  isYours,
  onSetVitals,
  onRecover,
  onRest,
  onSetTurn,
  onRemove,
}: RowProps) {
  // A player character nobody has taken yet: an open seat at the table, and the
  // one thing both audiences want to spot without reading.
  const isUnclaimed = character.kind === "pc" && character.claimedByPlayerId === null;

  // The number only earns its place while there is another copy to tell this one
  // apart from; a lone goblin is just the goblin. Spoken names take it too, or
  // two rows of "Remove Goblin" would be the same instruction twice.
  const copyLabel = copies > 1 ? `${character.name} ${character.copyNumber}` : character.name;

  return (
    <li
      // The active turn is marked by a heavy left border and bolder text as well
      // as colour, so it reads in both themes and without colour vision. The
      // turn keeps the border when a row is both on turn and unclaimed — the
      // badge below carries the unclaimed cue in that case.
      //
      // Every colour here names the *left* border rather than the border: the
      // hairline between rows is the list's own `divide-y`, drawn on each row's
      // bottom edge, and a bare `border-transparent` would paint that out along
      // with the three sides it was meant for.
      //
      // A character with no phase this segment is dimmed rather than removed, so
      // the game master can still see and reach them — their STUN is still theirs
      // to change on a segment they are not acting in. The filter button above
      // takes them out of the list entirely for a reader who would rather that.
      className={`flex flex-col gap-1 border-l-4 px-3 py-2.5 ${
        isActive
          ? "border-l-amber-500 bg-amber-50 dark:bg-amber-950/40"
          : isUnclaimed
            ? "border-l-rose-400 bg-rose-50 hover:bg-rose-100 dark:border-l-rose-500/70 dark:bg-rose-950/40 dark:hover:bg-rose-950/60"
            : "border-l-transparent hover:bg-stone-50 dark:hover:bg-stone-800/50"
      } ${isActing ? "" : "opacity-60"}`}
      aria-current={isActive ? "true" : undefined}
    >
      {/*
        The controls fall onto their own line rather than squeezing the name out
        of existence: three labelled buttons and a name cannot both have the room
        they want in the game master's narrow column, and a name clipped to
        nothing is worse than a row one line taller. `basis-40` is what makes the
        wrap happen — without a width to fall below, the name column would shrink
        to zero first and never trigger it.
      */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <span
        className="w-5 text-center text-xs tabular-nums text-stone-400 dark:text-stone-500"
        aria-hidden="true"
      >
        {index + 1}
      </span>

      <CharacterThumb kind={character.kind} backgroundUrl={character.backgroundUrl} />

      <div className="min-w-0 flex-1 basis-40">
        {/* Badges wrap below the name rather than crowding it out: with a picture
            and three of them, the game master's narrower column runs out of room. */}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span
            className={`max-w-full truncate ${
              isActive
                ? "font-semibold text-stone-900 dark:text-stone-50"
                : isActing
                  ? TEXT_BODY
                  : TEXT_MUTED
            }`}
          >
            {character.name}
          </span>
          {copies > 1 ? (
            // Read as part of the name above rather than as a badge of its own.
            <CountBadge hidden>{character.copyNumber}</CountBadge>
          ) : null}
          <KindBadge kind={character.kind} />
          {isActive ? (
            <span className="rounded bg-amber-500 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-white uppercase dark:text-stone-950">
              Turn
            </span>
          ) : null}
          {isUnclaimed ? (
            <span className="rounded bg-rose-100 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-rose-800 uppercase dark:bg-rose-950 dark:text-rose-200">
              Unclaimed
            </span>
          ) : null}
        </div>

        {/*
          The game master gets the four looked-up characteristics under the name,
          in the same line a player reads on their own character panel: this is
          the panel where the order is worked out, so the numbers it is worked
          out from belong in it.

          A player gets who is playing what instead, which is what the spec asks
          of their scene. The trade is deliberate rather than a want of room —
          another table's DEX is the game master's to give out, and who holds
          which character is already on the game master's players panel, so
          neither screen is carrying the other's line as well as its own.
        */}
        {editable ? (
          <StatLine character={character} className="mt-0.5" />
        ) : character.kind === "pc" ? (
          <p
            className={`mt-0.5 truncate text-xs ${
              isUnclaimed
                ? "font-medium text-rose-700 dark:text-rose-300"
                : TEXT_MUTED
            }`}
          >
            {character.claimedByPlayerName
              ? `Played by ${character.claimedByPlayerName}${isYours ? " (you)" : ""}`
              : "No player has claimed this character"}
          </p>
        ) : null}
      </div>

      <div className="flex shrink-0 items-center gap-1">
        {editable && onSetTurn ? (
          <button
            type="button"
            onClick={onSetTurn}
            className="rounded px-2 py-1 text-xs text-stone-600 hover:bg-stone-200 dark:text-stone-400 dark:hover:bg-stone-700"
          >
            <Icon icon={faPlay} /> Go now
          </button>
        ) : null}
        {editable && onRemove ? (
          <button
            type="button"
            onClick={onRemove}
            className="rounded px-2 py-1 text-xs text-red-600 hover:bg-red-100 dark:text-red-400 dark:hover:bg-red-950"
            aria-label={`Remove ${copyLabel} from the session`}
          >
            <Icon icon={faUserMinus} /> Remove
          </button>
        ) : null}
      </div>
      </div>

      {/*
        What a character has left is the game master's to see. How badly the
        monster is hurt is theirs to give out or hold back, and reading another
        player's STUN off the screen is not the same as being told — so the same
        thing that decides who may write these decides who may read them:
        `onSetVitals`, which only the game master's list is given.

        A player's own numbers are not repeated here either. They have a panel of
        their own, `My character`, which is where that player edits them; a
        second copy in the scene would be the same three numbers twice on one
        screen.

        A band of its own under the row rather than a column beside the name:
        three labelled boxes, a name and a control cannot all have the room they
        need in the game master's narrow panel, and across the full width they
        fit on one line. Only slightly indented — the width is what keeps the
        Recovery control on the same line as the numbers it changes, so there is
        none to give away to lining up with the name above.
      */}
      {onSetVitals ? (
        <Vitals
          character={character}
          onChange={onSetVitals}
          onRecover={onRecover}
          onRest={onRest}
          className="pl-2"
        />
      ) : null}
    </li>
  );
}

export function InitiativeList({
  characters,
  segment,
  showActingOnly = false,
  activeSlotId,
  editable = false,
  yourCharacterId = null,
  onSetVitals,
  onRecover,
  onRest,
  onSetTurn,
  onRemove,
}: {
  characters: SessionCharacter[];
  /** Which of the twelve segments the fight is on: what decides who is acting. */
  segment: number;
  /** Drop the characters who have no phase this segment instead of dimming them. */
  showActingOnly?: boolean;
  /** The slot whose turn it is. A slot, not a character: one may fill two. */
  activeSlotId: string | null;
  editable?: boolean;
  /** The viewing player's character, matched on the character rather than the slot. */
  yourCharacterId?: string | null;
  /**
   * Lets this reader write what a slot has left. The game master passes it; a
   * player does not — their own numbers are theirs to change, but they change
   * them on their own character panel rather than in a list of everybody.
   */
  onSetVitals?: (slotId: string, patch: VitalsPatch) => void;
  /** Gives each row a Recovery control, beside the numbers it changes. */
  onRecover?: (slotId: string) => void;
  /** And a rest, which puts both back to full. */
  onRest?: (slotId: string) => void;
  onSetTurn?: (slotId: string) => void;
  onRemove?: (slotId: string) => void;
}) {
  // Counted once here rather than per row, which would be a scan of the list
  // inside a scan of the list.
  const copies = new Map<string, number>();
  for (const character of characters) {
    copies.set(character.characterId, (copies.get(character.characterId) ?? 0) + 1);
  }

  // Numbered against the whole stage rather than against what survives the
  // filter, so a character keeps the same number whichever way the filter button
  // is set and the two views can be read against each other.
  const rows = characters
    .map((character, index) => ({
      character,
      index,
      isActing: actsIn(character.speed, segment),
    }))
    .filter((row) => row.isActing || !showActingOnly)
    .map(({ character, index, isActing }) => (
      <Row
        key={character.id}
        character={character}
        index={index}
        copies={copies.get(character.characterId) ?? 1}
        isActive={character.id === activeSlotId}
        isActing={isActing}
        editable={editable}
        // On the character: a player's own PC is theirs wherever it stands.
        isYours={character.characterId === yourCharacterId}
        onSetVitals={onSetVitals ? (patch) => onSetVitals(character.id, patch) : undefined}
        onRecover={onRecover ? () => onRecover(character.id) : undefined}
        onRest={onRest ? () => onRest(character.id) : undefined}
        onSetTurn={onSetTurn ? () => onSetTurn(character.id) : undefined}
        onRemove={onRemove ? () => onRemove(character.id) : undefined}
      />
    ));

  // Only reachable with the filter on: an empty stage is answered by the panels
  // above, which know whether the session has anyone in it at all.
  if (rows.length === 0) {
    return <EmptyState>Nobody acts in segment {segment}.</EmptyState>;
  }

  return <ul className="divide-y divide-stone-100 dark:divide-stone-800">{rows}</ul>;
}
