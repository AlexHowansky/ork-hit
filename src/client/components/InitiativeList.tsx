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
import { CharacterThumb, KindBadge } from "./ui.tsx";

interface RowProps {
  character: SessionCharacter;
  index: number;
  isActive: boolean;
  editable: boolean;
  /** Highlights the viewing player's own character. */
  isYours: boolean;
  onSetTurn?: () => void;
  onRemove?: () => void;
  onOpenSheet?: () => void;
}

function Row({
  character,
  index,
  isActive,
  editable,
  isYours,
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

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      // The active turn is marked by a heavy left border and bolder text as well
      // as colour, so it reads in both themes and without colour vision. The
      // turn keeps the border when a row is both on turn and unclaimed — the
      // badge below carries the unclaimed cue in that case.
      className={`flex items-center gap-3 border-l-4 px-3 py-2.5 ${
        isActive
          ? "border-amber-500 bg-amber-50 dark:bg-amber-950/40"
          : isUnclaimed
            ? "border-rose-400 bg-rose-50 hover:bg-rose-100 dark:border-rose-500/70 dark:bg-rose-950/40 dark:hover:bg-rose-950/60"
            : "border-transparent hover:bg-stone-50 dark:hover:bg-stone-800/50"
      } ${isDragging ? "relative z-10 opacity-80 shadow-lg" : ""}`}
      aria-current={isActive ? "true" : undefined}
    >
      {editable ? (
        <button
          type="button"
          {...attributes}
          {...listeners}
          className="cursor-grab touch-none px-1 text-stone-400 hover:text-stone-700 active:cursor-grabbing dark:hover:text-stone-200"
          aria-label={`Reorder ${character.name}. Press space, then use the arrow keys.`}
        >
          <span aria-hidden="true">⠿</span>
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

      <div className="min-w-0 flex-1">
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
            Sheet
          </button>
        ) : null}
        {editable && onSetTurn ? (
          <button
            type="button"
            onClick={onSetTurn}
            className="rounded px-2 py-1 text-xs text-stone-600 hover:bg-stone-200 dark:text-stone-400 dark:hover:bg-stone-700"
          >
            Set turn
          </button>
        ) : null}
        {editable && onRemove ? (
          <button
            type="button"
            onClick={onRemove}
            className="rounded px-2 py-1 text-xs text-red-600 hover:bg-red-100 dark:text-red-400 dark:hover:bg-red-950"
            aria-label={`Remove ${character.name} from the session`}
          >
            Remove
          </button>
        ) : null}
      </div>
    </li>
  );
}

export function InitiativeList({
  characters,
  activeCharacterId,
  editable = false,
  yourCharacterId = null,
  onReorder,
  onSetTurn,
  onRemove,
  onOpenSheet,
  canOpenSheet,
}: {
  characters: SessionCharacter[];
  activeCharacterId: string | null;
  editable?: boolean;
  yourCharacterId?: string | null;
  onReorder?: (orderedIds: string[]) => void;
  onSetTurn?: (characterId: string) => void;
  onRemove?: (characterId: string) => void;
  onOpenSheet?: (character: SessionCharacter) => void;
  /** Which rows offer a "Sheet" button; players may only open their own. */
  canOpenSheet?: (character: SessionCharacter) => boolean;
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

  const rows = characters.map((character, index) => (
    <Row
      key={character.id}
      character={character}
      index={index}
      isActive={character.id === activeCharacterId}
      editable={editable}
      isYours={character.id === yourCharacterId}
      onSetTurn={onSetTurn ? () => onSetTurn(character.id) : undefined}
      onRemove={onRemove ? () => onRemove(character.id) : undefined}
      onOpenSheet={
        onOpenSheet && (canOpenSheet?.(character) ?? true)
          ? () => onOpenSheet(character)
          : undefined
      }
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
