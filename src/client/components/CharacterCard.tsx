/** A character in the library, presented as a card with its background image. */

import type { HTMLAttributes } from "react";
import { faDragon, faShieldHalved } from "@fortawesome/free-solid-svg-icons";
import type { Character } from "../types.ts";
import {
  CARD_BASE,
  CARD_CAPTION,
  CARD_NAME,
  CardActions,
  CardPicture,
  CardWell,
  KindBadge,
} from "./ui.tsx";

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
      <CardWell>
        <CardPicture
          src={character.backgroundUrl}
          icon={character.kind === "pc" ? faShieldHalved : faDragon}
          draggable={false}
        />
        <div className="absolute top-2 left-2">
          <KindBadge kind={character.kind} />
        </div>
        {actions ? <CardActions>{actions}</CardActions> : null}
      </CardWell>

      <div className={CARD_CAPTION}>
        {onOpen ? (
          <button
            type="button"
            onClick={onOpen}
            className={`block w-full text-left hover:underline ${CARD_NAME}`}
          >
            {character.name}
          </button>
        ) : (
          <h3 className={CARD_NAME}>{character.name}</h3>
        )}
      </div>
    </article>
  );
}
