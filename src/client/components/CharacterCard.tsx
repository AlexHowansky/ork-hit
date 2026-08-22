/** A character in the library, presented as a card with its background image. */

import type { Character } from "../types.ts";
import { CARD_BASE, KindBadge } from "./ui.tsx";

export function CharacterCard({
  character,
  actions,
  onOpen,
}: {
  character: Character;
  actions?: React.ReactNode;
  onOpen?: () => void;
}) {
  return (
    <article
      className={`${CARD_BASE} border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-900`}
    >
      <div className="relative min-h-0 flex-1 bg-stone-200 dark:bg-stone-800">
        {character.backgroundUrl ? (
          <img
            src={character.backgroundUrl}
            alt=""
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
      </div>

      <div className="shrink-0 p-3">
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
        {actions ? <div className="mt-3 flex flex-wrap gap-2">{actions}</div> : null}
      </div>
    </article>
  );
}
