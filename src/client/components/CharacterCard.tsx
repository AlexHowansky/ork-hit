/** A character in the library, presented as a card with its background image. */

import type { Character } from "../types.ts";
import { KindBadge } from "./ui.tsx";

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
    <article className="group relative overflow-hidden rounded-xl border border-stone-200 bg-white shadow-sm transition-shadow hover:shadow-md dark:border-stone-800 dark:bg-stone-900">
      <div className="relative h-32 bg-stone-200 dark:bg-stone-800">
        {character.backgroundUrl ? (
          <img
            src={character.backgroundUrl}
            alt=""
            className="h-full w-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-3xl opacity-30" aria-hidden>
            {character.kind === "pc" ? "🛡" : "🐉"}
          </div>
        )}
        <div className="absolute top-2 left-2">
          <KindBadge kind={character.kind} />
        </div>
      </div>

      <div className="p-3">
        {onOpen ? (
          <button
            type="button"
            onClick={onOpen}
            className="text-left font-medium text-stone-900 hover:underline dark:text-stone-100"
          >
            {character.name}
          </button>
        ) : (
          <h3 className="font-medium text-stone-900 dark:text-stone-100">{character.name}</h3>
        )}
        {actions ? <div className="mt-3 flex flex-wrap gap-2">{actions}</div> : null}
      </div>
    </article>
  );
}
