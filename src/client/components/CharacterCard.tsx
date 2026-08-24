/** A character in the library, presented as a card with its background image. */

import type { HTMLAttributes } from "react";
import type { Character } from "../types.ts";
import { CARD_BASE, CARD_CAPTION, CardActions, KindBadge } from "./ui.tsx";

export function CharacterCard({
  character,
  actions,
  onOpen,
  dragProps,
}: {
  character: Character;
  actions?: React.ReactNode;
  onOpen?: () => void;
  /** Makes the card something that can be picked up — see `GmLibrary`. */
  dragProps?: HTMLAttributes<HTMLElement> & { draggable?: boolean };
}) {
  return (
    <article
      {...dragProps}
      className={`${CARD_BASE} border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-900`}
    >
      <div className="relative aspect-square w-full shrink-0 overflow-hidden bg-stone-200 dark:bg-stone-800">
        {character.backgroundUrl ? (
          <img
            src={character.backgroundUrl}
            alt=""
            // An image is draggable in its own right, and would otherwise start a
            // drag carrying the picture's URL instead of the card's own.
            draggable={false}
            className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-105 group-focus-within:scale-105"
            loading="lazy"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-4xl opacity-30" aria-hidden>
            {character.kind === "pc" ? "🛡" : "🐉"}
          </div>
        )}
        <div className="absolute top-2 left-2">
          <KindBadge kind={character.kind} />
        </div>
        {actions ? <CardActions>{actions}</CardActions> : null}
      </div>

      <div className={CARD_CAPTION}>
        {onOpen ? (
          <button
            type="button"
            onClick={onOpen}
            className="block w-full truncate text-left font-medium text-stone-900 hover:underline dark:text-stone-100"
          >
            {character.name}
          </button>
        ) : (
          <h3 className="truncate font-medium text-stone-900 dark:text-stone-100">
            {character.name}
          </h3>
        )}
      </div>
    </article>
  );
}
