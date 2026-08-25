/**
 * The initiative order.
 *
 * The same component serves both audiences: the game master gets drag handles and
 * can click a row to hand it the turn, while players get the identical list as a
 * read-only view. That keeps the two screens honestly in agreement about what the
 * order is.
 *
 * Reordering is applied locally the moment a drop lands, then written to the
 * server. If the write fails, the broadcast snapshot puts the truth back.
 */

import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { restrictToVerticalAxis } from "@dnd-kit/modifiers";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { SessionCharacter } from "../types.ts";
import {
  faEye,
  faGripVertical,
  faPlay,
  faUserMinus,
} from "@fortawesome/free-solid-svg-icons";
import { CharacterThumb, Icon, KindBadge } from "./ui.tsx";
import { Vitals, type VitalsPatch } from "./Vitals.tsx";

/**
 * What to call one slot, given the whole stage.
 *
 * The copy number only appears while there is another copy to tell this one
 * apart from — a lone goblin is just "Goblin". Shared so the turn banner and the
 * initiative row never disagree about what the monster on turn is called.
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
  editable: boolean;
  /** Highlights the viewing player's own character. */
  isYours: boolean;
  /**
   * Absent where this reader may read the numbers but not write them. Separate
   * from `editable`, which is the game master's drag-and-remove: on the player's
   * screen the whole list is read-only, and on the game master's every row is
   * writable, but the two are different questions.
   */
  onSetVitals?: (patch: VitalsPatch) => void;
  onRecover?: () => void;
  onRest?: () => void;
  onSetTurn?: () => void;
  onRemove?: () => void;
  onOpenSheet?: () => void;
}

function Row({
  character,
  index,
  copies,
  isActive,
  editable,
  isYours,
  onSetVitals,
  onRecover,
  onRest,
  onSetTurn,
  onRemove,
  onOpenSheet,
}: RowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: character.id,
    disabled: !editable,
  });

  // A player character nobody has taken yet: an open seat at the table, and the
  // one thing both audiences want to spot without reading.
  const isUnclaimed = character.kind === "pc" && character.claimedByPlayerId === null;

  // The number only earns its place while there is another copy to tell this one
  // apart from; a lone goblin is just the goblin. Spoken names take it too, or
  // two rows of "Reorder Goblin" would be the same instruction twice.
  const copyLabel = copies > 1 ? `${character.name} ${character.copyNumber}` : character.name;

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      // The active turn is marked by a heavy left border and bolder text as well
      // as colour, so it reads in both themes and without colour vision. The
      // turn keeps the border when a row is both on turn and unclaimed — the
      // badge below carries the unclaimed cue in that case.
      className={`flex flex-col gap-1 border-l-4 px-3 py-2.5 ${
        isActive
          ? "border-amber-500 bg-amber-50 dark:bg-amber-950/40"
          : isUnclaimed
            ? "border-rose-400 bg-rose-50 hover:bg-rose-100 dark:border-rose-500/70 dark:bg-rose-950/40 dark:hover:bg-rose-950/60"
            : "border-transparent hover:bg-stone-50 dark:hover:bg-stone-800/50"
      } ${isDragging ? "relative z-10 opacity-80 shadow-lg" : ""}`}
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
      {editable ? (
        <button
          type="button"
          {...attributes}
          {...listeners}
          className="cursor-grab touch-none px-1 text-stone-400 hover:text-stone-700 active:cursor-grabbing dark:hover:text-stone-200"
          aria-label={`Reorder ${copyLabel}. Press space, then use the arrow keys.`}
        >
          <Icon icon={faGripVertical} />
        </button>
      ) : (
        <span
          className="w-5 text-center text-xs tabular-nums text-stone-400 dark:text-stone-500"
          aria-hidden="true"
        >
          {index + 1}
        </span>
      )}

      <CharacterThumb kind={character.kind} backgroundUrl={character.backgroundUrl} />

      <div className="min-w-0 flex-1 basis-40">
        {/* Badges wrap below the name rather than crowding it out: with a picture
            and three of them, the game master's narrower column runs out of room. */}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span
            className={`max-w-full truncate ${
              isActive
                ? "font-semibold text-stone-900 dark:text-stone-50"
                : "text-stone-800 dark:text-stone-200"
            }`}
          >
            {character.name}
          </span>
          {copies > 1 ? (
            <span
              className="rounded bg-stone-200 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-stone-700 dark:bg-stone-700 dark:text-stone-200"
              // Read as part of the name above rather than as a badge of its own.
              aria-hidden="true"
            >
              {character.copyNumber}
            </span>
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

        {/* Only player characters carry an association, per the spec. */}
        {character.kind === "pc" ? (
          <p
            className={`mt-0.5 truncate text-xs ${
              isUnclaimed
                ? "font-medium text-rose-700 dark:text-rose-300"
                : "text-stone-500 dark:text-stone-400"
            }`}
          >
            {character.claimedByPlayerName
              ? `Played by ${character.claimedByPlayerName}${isYours ? " (you)" : ""}`
              : "No player has claimed this character"}
          </p>
        ) : null}
      </div>

      <div className="flex shrink-0 items-center gap-1">
        {onOpenSheet ? (
          <button
            type="button"
            onClick={onOpenSheet}
            className="rounded px-2 py-1 text-xs text-stone-600 hover:bg-stone-200 dark:text-stone-400 dark:hover:bg-stone-700"
          >
            <Icon icon={faEye} /> Sheet
          </button>
        ) : null}
        {editable && onSetTurn ? (
          <button
            type="button"
            onClick={onSetTurn}
            className="rounded px-2 py-1 text-xs text-stone-600 hover:bg-stone-200 dark:text-stone-400 dark:hover:bg-stone-700"
          >
            <Icon icon={faPlay} /> Set turn
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
  activeSlotId,
  editable = false,
  yourCharacterId = null,
  onReorder,
  onSetVitals,
  onRecover,
  onRest,
  onSetTurn,
  onRemove,
  onOpenSheet,
}: {
  characters: SessionCharacter[];
  /** The slot whose turn it is. A slot, not a character: one may fill two. */
  activeSlotId: string | null;
  editable?: boolean;
  /** The viewing player's character, matched on the character rather than the slot. */
  yourCharacterId?: string | null;
  onReorder?: (orderedSlotIds: string[]) => void;
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
  /**
   * Gives every row a "Sheet" button. The game master passes it; a player's list
   * has none, since the only sheet they may open is their own and "My sheet"
   * above the list is where they open it.
   */
  onOpenSheet?: (character: SessionCharacter) => void;
}) {
  const sensors = useSensors(
    // A small activation distance so a click on a row button isn't read as a drag.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id || !onReorder) return;

    const from = characters.findIndex((character) => character.id === active.id);
    const to = characters.findIndex((character) => character.id === over.id);
    if (from === -1 || to === -1) return;

    onReorder(arrayMove(characters, from, to).map((character) => character.id));
  };

  // Counted once here rather than per row, which would be a scan of the list
  // inside a scan of the list.
  const copies = new Map<string, number>();
  for (const character of characters) {
    copies.set(character.characterId, (copies.get(character.characterId) ?? 0) + 1);
  }

  const rows = characters.map((character, index) => (
    <Row
      key={character.id}
      character={character}
      index={index}
      copies={copies.get(character.characterId) ?? 1}
      isActive={character.id === activeSlotId}
      editable={editable}
      // On the character: a player's own PC is theirs wherever it stands.
      isYours={character.characterId === yourCharacterId}
      onSetVitals={onSetVitals ? (patch) => onSetVitals(character.id, patch) : undefined}
      onRecover={onRecover ? () => onRecover(character.id) : undefined}
      onRest={onRest ? () => onRest(character.id) : undefined}
      onSetTurn={onSetTurn ? () => onSetTurn(character.id) : undefined}
      onRemove={onRemove ? () => onRemove(character.id) : undefined}
      onOpenSheet={onOpenSheet ? () => onOpenSheet(character) : undefined}
    />
  ));

  const list = (
    <ul className="divide-y divide-stone-100 dark:divide-stone-800">{rows}</ul>
  );

  if (!editable) return list;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={[restrictToVerticalAxis]}
      onDragEnd={handleDragEnd}
    >
      <SortableContext
        items={characters.map((character) => character.id)}
        strategy={verticalListSortingStrategy}
      >
        {list}
      </SortableContext>
    </DndContext>
  );
}
